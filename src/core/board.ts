import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCardContent } from './card.js';
import { slugify } from './slug.js';
import type { Card, BoardName, ProjectConfig } from './types.js';

export const ARCHIVE_SLUG = 'archive';

export function boardColumnSlugs(config: ProjectConfig, board: BoardName): string[] {
  return config.boards[board].columns.map(slugify);
}

async function readCardsFromFolder(
  projectRoot: string,
  board: BoardName,
  columnSlug: string,
): Promise<Card[]> {
  const dir = join(projectRoot, board, columnSlug);
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
    const { data, body } = parseCardContent(await readFile(filePath, 'utf8'));
    cards.push({ ...data, board, columnSlug, body, filePath });
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

export async function readArchive(projectRoot: string, board: BoardName): Promise<Card[]> {
  return readCardsFromFolder(projectRoot, board, ARCHIVE_SLUG);
}
