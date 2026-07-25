import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { serializeCard, toFrontmatter } from './card.js';
import { nextId } from './ids.js';
import { readBoard, readArchive, boardColumnSlugs, ARCHIVE_SLUG } from './board.js';
import type { Card, CardFrontmatter, BoardName, ProjectConfig } from './types.js';

const ORDER_STEP = 10;

export interface CreateCardInput {
  board: BoardName;
  columnSlug: string;
  title: string;
  description?: string;
  tags?: string[];
  links?: string[];
  group?: string;
  body?: string;
}

async function writeCardFile(card: Card): Promise<void> {
  await writeFile(card.filePath, serializeCard(toFrontmatter(card), card.body), 'utf8');
}

export async function createCard(
  projectRoot: string,
  config: ProjectConfig,
  input: CreateCardInput,
  today: string,
): Promise<Card> {
  const [live, archived] = await Promise.all([
    readBoard(projectRoot, input.board, config),
    readArchive(projectRoot, input.board),
  ]);
  const id = nextId(
    input.board,
    [...live, ...archived].map((c) => c.id),
    config.idPadding,
  );
  const maxOrder = live
    .filter((c) => c.columnSlug === input.columnSlug)
    .reduce((m, c) => Math.max(m, c.order), 0);
  const dir = join(projectRoot, input.board, input.columnSlug);
  await mkdir(dir, { recursive: true });
  const card: Card = {
    id,
    title: input.title,
    description: input.description,
    order: maxOrder + ORDER_STEP,
    tags: input.tags ?? [],
    links: input.links ?? [],
    group: input.group,
    created: today,
    board: input.board,
    columnSlug: input.columnSlug,
    body: input.body ?? '',
    filePath: join(dir, `${id}.md`),
  };
  await writeCardFile(card);
  return card;
}

// `projectRoot` is unused — a card's file path is absolute (Card.filePath) — but every other
// mutation takes it, and breaking that symmetry for one function costs more than it saves.
export async function updateCard(
  _projectRoot: string,
  card: Card,
  patch: Partial<CardFrontmatter> & { body?: string },
): Promise<Card> {
  const updated: Card = { ...card, ...patch };
  await writeCardFile(updated);
  return updated;
}

export async function moveCard(projectRoot: string, card: Card, toColumnSlug: string): Promise<Card> {
  const dir = join(projectRoot, card.board, toColumnSlug);
  await mkdir(dir, { recursive: true });
  const newPath = join(dir, basename(card.filePath));
  await rename(card.filePath, newPath);
  return { ...card, columnSlug: toColumnSlug, filePath: newPath };
}

// Put a card in a column at a specific position: move the file if the column changed, then
// renumber that column's `order` fields to even multiples of ORDER_STEP.
//
// Position is expressed as "before this card" rather than an index, because the card being moved
// occupies an index itself — dragging downward with a raw index is off by one — and because an id
// still means the same thing if an agent changed the board while the drag was in flight. A
// `beforeId` of null (or one not in the column) means the end.
export async function placeCard(
  projectRoot: string,
  config: ProjectConfig,
  card: Card,
  toColumnSlug: string,
  beforeId: string | null,
): Promise<Card> {
  // "Before itself" means stay put. Worth handling here rather than trusting the caller: the
  // card is excluded from the sequence below, so its own id would look like an unknown
  // beforeId and send it to the end of the column instead.
  if (beforeId === card.id && card.columnSlug === toColumnSlug) return card;

  const moved = card.columnSlug === toColumnSlug ? card : await moveCard(projectRoot, card, toColumnSlug);

  // Re-read so we sequence against what is actually on disk, not a stale snapshot.
  const live = await readBoard(projectRoot, moved.board, config);
  const others = live.filter((c) => c.columnSlug === toColumnSlug && c.id !== moved.id);
  const at = beforeId === null ? -1 : others.findIndex((c) => c.id === beforeId);
  const ordered = at === -1 ? [...others, moved] : [...others.slice(0, at), moved, ...others.slice(at)];

  // Write only the cards whose order actually changes — fewer writes means fewer watcher events.
  await Promise.all(
    ordered.map((c, i) => {
      const order = (i + 1) * ORDER_STEP;
      return c.order === order ? undefined : updateCard(projectRoot, c, { order });
    }),
  );
  const finalIndex = ordered.findIndex((c) => c.id === moved.id);
  return { ...moved, order: (finalIndex + 1) * ORDER_STEP };
}

// Stamp before moving: `archivedFrom` is the only record of where the card came from, and
// once the file is in archive/ its path no longer says.
export async function archiveCard(projectRoot: string, card: Card, now: string): Promise<Card> {
  const stamped = await updateCard(projectRoot, card, { archived: now, archivedFrom: card.columnSlug });
  return moveCard(projectRoot, stamped, ARCHIVE_SLUG);
}

// Where a restore would land: the column it left, or the board's first column if that one has
// since been renamed or removed. Never returns a folder no column maps to — an unreachable
// card is worse than one in the wrong place.
export function restoreTarget(config: ProjectConfig, card: Card): string {
  const slugs = boardColumnSlugs(config, card.board);
  return card.archivedFrom && slugs.includes(card.archivedFrom) ? card.archivedFrom : slugs[0];
}

// Put an archived card back on the board, at the end of the target column. `'unknown-column'`
// when an explicitly requested column isn't configured for this board.
export async function restoreCard(
  projectRoot: string,
  config: ProjectConfig,
  card: Card,
  toColumnSlug?: string,
): Promise<Card | 'unknown-column'> {
  if (toColumnSlug !== undefined && !boardColumnSlugs(config, card.board).includes(toColumnSlug)) {
    return 'unknown-column';
  }
  const target = toColumnSlug ?? restoreTarget(config, card);
  const cleared = await updateCard(projectRoot, card, { archived: undefined, archivedFrom: undefined });
  return placeCard(projectRoot, config, cleared, target, null);
}
