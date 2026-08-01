import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { boardColumnSlugs, readArchive, readBoard } from '../src/core/board.js';
import { defaultConfig } from '../src/core/config.js';
import { ARCHIVE_SLUG } from '../src/core/layout.js';
import { archiveCard, createCard, moveCard, updateCard } from '../src/core/mutations.js';
import { tempDir } from './helpers.js';

const config = defaultConfig('T');
const TODAY = '2026-07-23';
const NOW = '2026-07-23T10:00:00.000Z';
// Engineering's first column, from the config these tests pass in. The next id counts what
// readBoard returns, so a card created in an unconfigured folder is not counted — and the second
// card then gets the first one's id.
const [ENG_FIRST] = boardColumnSlugs(config, 'engineering');

describe('mutations', () => {
  it('creates a card with the next id and a file on disk', async () => {
    const root = await tempDir();
    const card = await createCard(
      root,
      config,
      { board: 'engineering', columnSlug: ENG_FIRST, title: 'First', links: ['P-001'] },
      TODAY,
    );
    expect(card.id).toBe('E-001');
    expect(card.created).toBe(TODAY);
    expect(card.links).toEqual(['P-001']);
    await expect(access(card.filePath)).resolves.toBeUndefined();

    const second = await createCard(
      root,
      config,
      { board: 'engineering', columnSlug: ENG_FIRST, title: 'Second' },
      TODAY,
    );
    expect(second.id).toBe('E-002');
    expect(second.order).toBeGreaterThan(card.order);
  });

  it('does not reuse an archived id', async () => {
    const root = await tempDir();
    const c1 = await createCard(root, config, { board: 'product', columnSlug: 'todo', title: 'A' }, TODAY);
    await archiveCard(root, c1, NOW);
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

  it('archives a card (moves it out of the board into archive)', async () => {
    const root = await tempDir();
    const card = await createCard(
      root,
      config,
      { board: 'engineering', columnSlug: ENG_FIRST, title: 'A' },
      TODAY,
    );
    // "Leaves the board" is only observable if it was on the board to begin with: created in a
    // folder no column maps to, it never was, and the empty list below would prove nothing.
    expect((await readBoard(root, 'engineering', config)).map((c) => c.id)).toEqual([card.id]);

    const archived = await archiveCard(root, card, NOW);
    expect(archived.columnSlug).toBe(ARCHIVE_SLUG);
    expect((await readBoard(root, 'engineering', config)).length).toBe(0);
    expect((await readArchive(root, 'engineering')).map((c) => c.id)).toEqual([card.id]);
  });
});
