import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCardContent } from './card.js';
import { ARCHIVE_SLUG, boardRel } from './layout.js';
import { slugify } from './slug.js';
import type { BoardName, Card, ProjectConfig } from './types.js';

export function boardColumnSlugs(config: ProjectConfig, board: BoardName): string[] {
  return config.boards[board].columns.map(slugify);
}

async function readCardsFromFolder(
  projectRoot: string,
  board: BoardName,
  columnSlug: string,
): Promise<Card[]> {
  const dir = join(projectRoot, boardRel(board, columnSlug));
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const cards: Card[] = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const filePath = join(dir, name);
    const parsed = parseCardContent(await readFile(filePath, 'utf8'));
    if (!parsed) continue;
    cards.push({ ...parsed.data, board, columnSlug, body: parsed.body, filePath });
  }
  return cards;
}

export async function readBoard(
  projectRoot: string,
  board: BoardName,
  config: ProjectConfig,
): Promise<Card[]> {
  const cards: Card[] = [];
  for (const slug of boardColumnSlugs(config, board)) {
    cards.push(...(await readCardsFromFolder(projectRoot, board, slug)));
  }
  cards.sort((a, b) => a.order - b.order);
  return cards;
}

// Newest first: the drawer's job is answering "what did I just throw away". Cards archived
// before this was recorded have no timestamp and sort to the bottom.
export async function readArchive(projectRoot: string, board: BoardName): Promise<Card[]> {
  const cards = await readCardsFromFolder(projectRoot, board, ARCHIVE_SLUG);
  return cards.sort((a, b) => (b.archived ?? '').localeCompare(a.archived ?? '') || b.id.localeCompare(a.id));
}

// Counted rather than read, so it can ride along on every snapshot without opening files —
// the archive is the one folder that only ever grows.
export async function countArchived(projectRoot: string, board: BoardName): Promise<number> {
  try {
    const entries = await readdir(join(projectRoot, boardRel(board, ARCHIVE_SLUG)));
    return entries.filter((n) => n.endsWith('.md')).length;
  } catch {
    return 0;
  }
}
