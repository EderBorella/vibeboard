import { mkdir, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { serializeCard, toFrontmatter } from '../../core/card.js';
import { nextId } from '../../core/ids.js';
import { ARCHIVE_SLUG, boardRel } from '../../core/layout.js';
import type { BoardName, Card, CardFrontmatter, ProjectConfig } from '../../core/types.js';
import { boardColumnSlugs, readBoard, spentIds } from './board.js';

const ORDER_STEP = 10;

export interface CreateCardInput {
  board: BoardName;
  columnSlug: string;
  title: string;
  description?: string;
  tags?: string[];
  // NO `links` (ruling 65). It was here, and `createCard` wrote it straight into the new card's frontmatter —
  // an asymmetric write nothing inspects, because `childrenOf` and `parentOf` both read the PARENT's list. A
  // create that carries links goes through `createLinkedCard`, which is the only door onto `setCardLinks`.
  group?: string;
  body?: string;
  // The run that created this card (ruling 58). Stamped by the endpoint from the credential it already
  // holds, never accepted from a caller — but it has to travel through here, because `createCard` builds
  // its `Card` field by field rather than spreading its input, so a field absent from this interface is
  // one the stamp loses on the floor.
  createdBy?: string;
}

// `exclusive` is for the create path: `wx` fails with EEXIST rather than replacing a file that is
// already there. Belt and braces behind the id allocator — if a new card's path is ever occupied,
// something upstream is wrong, and a loud error is worth more than a silently overwritten card.
async function writeCardFile(card: Card, exclusive = false): Promise<void> {
  const body = serializeCard(toFrontmatter(card), card.body);
  await writeFile(card.filePath, body, exclusive ? { encoding: 'utf8', flag: 'wx' } : 'utf8');
}

// Because a column IS a folder, an unconfigured slug never failed — it created a folder no column
// maps to, leaving the card invisible to readBoard while still holding its id. Every write that
// names a column asks here first, so there is one answer to "is this a real column" rather than
// one per call site: restoreCard checked, create and move did not, and that gap has produced
// invisible cards twice (see the comments on `DEFAULT_COLUMNS` in `project/config.ts` and above
// `assistCredentialSection` in `server/prompt/credential.ts`). Named by symbol, not by line: the old
// citation here read `run-prompt.ts:56`, and that file is now a 14-line barrel.
function knownColumn(config: ProjectConfig, board: BoardName, columnSlug: string): boolean {
  return boardColumnSlugs(config, board).includes(columnSlug);
}

export async function createCard(
  projectRoot: string,
  config: ProjectConfig,
  input: CreateCardInput,
  today: string,
): Promise<Card | 'unknown-column'> {
  if (!knownColumn(config, input.board, input.columnSlug)) return 'unknown-column';
  const [live, spent] = await Promise.all([
    readBoard(projectRoot, input.board, config),
    spentIds(projectRoot, input.board, config),
  ]);
  const id = nextId(input.board, spent, config.idPadding);
  const maxOrder = live
    .filter((c) => c.columnSlug === input.columnSlug)
    .reduce((m, c) => Math.max(m, c.order), 0);
  const dir = join(projectRoot, boardRel(input.board, input.columnSlug));
  await mkdir(dir, { recursive: true });
  const card: Card = {
    id,
    title: input.title,
    description: input.description,
    order: maxOrder + ORDER_STEP,
    tags: input.tags ?? [],
    // Always empty: a link is written after the card exists, by the one writer that also writes the far side.
    links: [],
    group: input.group,
    created: today,
    createdBy: input.createdBy,
    board: input.board,
    columnSlug: input.columnSlug,
    body: input.body ?? '',
    filePath: join(dir, `${id}.md`),
  };
  await writeCardFile(card, true);
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

// Unvalidated on purpose, and private: the archive is a real destination that no column maps to,
// so archiveCard cannot go through the guard the public movers use.
async function moveCardFile(projectRoot: string, card: Card, toColumnSlug: string): Promise<Card> {
  const dir = join(projectRoot, boardRel(card.board, toColumnSlug));
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
): Promise<Card | 'unknown-column'> {
  if (!knownColumn(config, card.board, toColumnSlug)) return 'unknown-column';

  // "Before itself" means stay put. Worth handling here rather than trusting the caller: the
  // card is excluded from the sequence below, so its own id would look like an unknown
  // beforeId and send it to the end of the column instead.
  if (beforeId === card.id && card.columnSlug === toColumnSlug) return card;

  const moved = card.columnSlug === toColumnSlug ? card : await moveCardFile(projectRoot, card, toColumnSlug);

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
  return moveCardFile(projectRoot, stamped, ARCHIVE_SLUG);
}

// Where a restore would land: the column it left, or the board's first column if that one has
// since been renamed or removed. Never returns a folder no column maps to — an unreachable
// card is worse than one in the wrong place.
export function restoreTarget(config: ProjectConfig, card: Card): string {
  const slugs = boardColumnSlugs(config, card.board);
  return card.archivedFrom && slugs.includes(card.archivedFrom) ? card.archivedFrom : slugs[0];
}

// Put an archived card back on the board, at the end of the target column.
export async function restoreCard(
  projectRoot: string,
  config: ProjectConfig,
  card: Card,
  toColumnSlug?: string,
): Promise<Card | 'unknown-column'> {
  if (toColumnSlug !== undefined && !knownColumn(config, card.board, toColumnSlug)) {
    return 'unknown-column';
  }
  const target = toColumnSlug ?? restoreTarget(config, card);
  const cleared = await updateCard(projectRoot, card, { archived: undefined, archivedFrom: undefined });
  return placeCard(projectRoot, config, cleared, target, null);
}
