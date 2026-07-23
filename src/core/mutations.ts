import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { serializeCard, toFrontmatter } from './card.js';
import { nextId } from './ids.js';
import { readBoard, readArchive, ARCHIVE_SLUG } from './board.js';
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
  const id = nextId(input.board, [...live, ...archived].map((c) => c.id), config.idPadding);
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

export async function updateCard(
  projectRoot: string,
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

export async function reorderCard(projectRoot: string, card: Card, order: number): Promise<Card> {
  return updateCard(projectRoot, card, { order });
}

export async function archiveCard(projectRoot: string, card: Card): Promise<Card> {
  return moveCard(projectRoot, card, ARCHIVE_SLUG);
}
