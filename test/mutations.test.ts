import { describe, it, expect } from 'vitest';
import { readFile, access } from 'node:fs/promises';
import { tempDir } from './helpers.js';
import { defaultConfig } from '../src/core/config.js';
import { readBoard, readArchive, ARCHIVE_SLUG } from '../src/core/board.js';
import {
  createCard, updateCard, moveCard, reorderCard, archiveCard,
} from '../src/core/mutations.js';

const config = defaultConfig('T');
const TODAY = '2026-07-23';

describe('mutations', () => {
  it('creates a card with the next id and a file on disk', async () => {
    const root = await tempDir();
    const card = await createCard(root, config,
      { board: 'engineering', columnSlug: 'todo', title: 'First', links: ['P-001'] }, TODAY);
    expect(card.id).toBe('E-001');
    expect(card.created).toBe(TODAY);
    expect(card.links).toEqual(['P-001']);
    await expect(access(card.filePath)).resolves.toBeUndefined();

    const second = await createCard(root, config,
      { board: 'engineering', columnSlug: 'todo', title: 'Second' }, TODAY);
    expect(second.id).toBe('E-002');
    expect(second.order).toBeGreaterThan(card.order);
  });

  it('does not reuse an archived id', async () => {
    const root = await tempDir();
    const c1 = await createCard(root, config, { board: 'product', columnSlug: 'todo', title: 'A' }, TODAY);
    await archiveCard(root, c1);
    const c2 = await createCard(root, config, { board: 'product', columnSlug: 'todo', title: 'B' }, TODAY);
    expect(c2.id).toBe('P-002');
  });

  it('updates fields and rewrites the file', async () => {
    const root = await tempDir();
    const card = await createCard(root, config, { board: 'product', columnSlug: 'todo', title: 'A' }, TODAY);
    const updated = await updateCard(root, card, { title: 'Renamed', tags: ['x'] });
    expect(updated.title).toBe('Renamed');
    const onDisk = await readFile(card.filePath, 'utf8');
    expect(onDisk).toContain('title: Renamed');
    expect(onDisk).toContain('- x');
  });

  it('moves a card to another column (file relocates, id unchanged)', async () => {
    const root = await tempDir();
    const card = await createCard(root, config, { board: 'product', columnSlug: 'todo', title: 'A' }, TODAY);
    const moved = await moveCard(root, card, 'in-progress');
    expect(moved.columnSlug).toBe('in-progress');
    expect(moved.id).toBe(card.id);
    const board = await readBoard(root, 'product', config);
    expect(board.find((c) => c.id === card.id)?.columnSlug).toBe('in-progress');
  });

  it('reorders a card by rewriting order', async () => {
    const root = await tempDir();
    const card = await createCard(root, config, { board: 'product', columnSlug: 'todo', title: 'A' }, TODAY);
    const reordered = await reorderCard(root, card, 999);
    expect(reordered.order).toBe(999);
  });

  it('archives a card (moves it out of the board into archive)', async () => {
    const root = await tempDir();
    const card = await createCard(root, config, { board: 'engineering', columnSlug: 'todo', title: 'A' }, TODAY);
    const archived = await archiveCard(root, card);
    expect(archived.columnSlug).toBe(ARCHIVE_SLUG);
    expect((await readBoard(root, 'engineering', config)).length).toBe(0);
    expect((await readArchive(root, 'engineering')).map((c) => c.id)).toEqual([card.id]);
  });
});
