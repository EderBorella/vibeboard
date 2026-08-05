import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCardContent } from './card.js';
import { ARCHIVE_SLUG, boardRel } from './layout.js';
import { slugify } from './slug.js';
import type { BoardName, Card, ProjectConfig } from './types.js';

export function boardColumnSlugs(config: ProjectConfig, board: BoardName): string[] {
  return config.boards[board].columns.map(slugify);
}

// Every id this board has spent, taken from FILENAMES rather than from parsed cards. A card is
// `<id>.md` by construction, so the filename is the id — and it is still the id when the card's
// frontmatter will not parse. Deriving from readBoard instead meant an unparseable card released
// its id back to the allocator, and the next create overwrote the file: silent data loss, in the
// one place the product promises the files are canonical.
export async function spentIds(
  projectRoot: string,
  board: BoardName,
  config: ProjectConfig,
): Promise<string[]> {
  const folders = [...boardColumnSlugs(config, board), ARCHIVE_SLUG];
  const ids: string[] = [];
  for (const slug of folders) {
    let entries: string[];
    try {
      entries = await readdir(join(projectRoot, boardRel(board, slug)));
    } catch {
      continue; // a column with no folder yet has spent nothing
    }
    for (const name of entries) {
      if (name.endsWith('.md')) ids.push(name.slice(0, -3));
    }
  }
  return ids;
}

// A file that will not parse is reported, never merely dropped. The same rule the skill reader
// already follows: an invisible card with no explanation is indistinguishable from a card the user
// imagines they wrote, and they will go looking for it in the wrong place.
export type CardProblem = { path: string; reason: string };

async function readCardsFromFolder(
  projectRoot: string,
  board: BoardName,
  columnSlug: string,
  problems?: CardProblem[],
): Promise<Card[]> {
  const dir = join(projectRoot, boardRel(board, columnSlug));
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    // ABSENT is ordinary: a column's folder is created by the first card written into it, so an empty
    // column has no folder and never did. UNREADABLE is not — and returning `[]` for both made a column
    // nobody can read indistinguishable from a column with nothing in it. Auto-pilot's `complete` is
    // "no non-terminal card exists anywhere", so a permission error, a bad mount or an interrupted
    // rename silently became the project's only success reason.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      problems?.push({ path: dir, reason: `the folder could not be read (${String(err)})` });
    }
    return [];
  }
  const cards: Card[] = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const filePath = join(dir, name);
    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (err) {
      // The same reasoning one level down, and it also stops a card deleted between the `readdir` and
      // this line from throwing out of every caller that reads a board.
      problems?.push({ path: filePath, reason: `the file could not be read (${String(err)})` });
      continue;
    }
    const parsed = parseCardContent(content);
    if (!parsed) {
      problems?.push({ path: filePath, reason: 'the YAML frontmatter could not be parsed' });
      continue;
    }
    cards.push({ ...parsed.data, board, columnSlug, body: parsed.body, filePath });
  }
  return cards;
}

export async function readBoard(
  projectRoot: string,
  board: BoardName,
  config: ProjectConfig,
  problems?: CardProblem[],
): Promise<Card[]> {
  const cards: Card[] = [];
  for (const slug of boardColumnSlugs(config, board)) {
    cards.push(...(await readCardsFromFolder(projectRoot, board, slug, problems)));
  }
  cards.sort((a, b) => a.order - b.order);
  return cards;
}

// Newest first: the drawer's job is answering "what did I just throw away". Cards archived
// before this was recorded have no timestamp and sort to the bottom.
export async function readArchive(
  projectRoot: string,
  board: BoardName,
  problems?: CardProblem[],
): Promise<Card[]> {
  const cards = await readCardsFromFolder(projectRoot, board, ARCHIVE_SLUG, problems);
  return cards.sort((a, b) => (b.archived ?? '').localeCompare(a.archived ?? '') || b.id.localeCompare(a.id));
}

// Counted rather than read, so it can ride along on every snapshot without opening files — the
// archive is the one folder that only ever grows.
//
// This counts FILES, which is deliberately not the same as the number of cards readArchive returns:
// a file it cannot parse is in the drawer but not in the list. They used to disagree in silence, so
// a badge reading 1 opened an empty drawer. readArchive now reports what it could not read, and the
// drawer says so — the count stays cheap and the gap stops being invisible.
export async function countArchived(projectRoot: string, board: BoardName): Promise<number> {
  try {
    const entries = await readdir(join(projectRoot, boardRel(board, ARCHIVE_SLUG)));
    return entries.filter((n) => n.endsWith('.md')).length;
  } catch {
    return 0;
  }
}
