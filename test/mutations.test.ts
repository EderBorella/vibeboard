import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardColumnSlugs, readArchive, readBoard } from '../src/core/board.js';
import { defaultConfig } from '../src/core/config.js';
import { ARCHIVE_SLUG, boardRel } from '../src/core/layout.js';
import {
  archiveCard,
  type CreateCardInput,
  createCard,
  placeCard,
  updateCard,
} from '../src/core/mutations.js';
import type { Card } from '../src/core/types.js';
import { cardFrom, tempDir } from './helpers.js';

const config = defaultConfig('T');
const TODAY = '2026-07-23';
const NOW = '2026-07-23T10:00:00.000Z';
// Engineering's first column, from the config these tests pass in. The next id counts what
// readBoard returns, so a card created in an unconfigured folder is not counted — and the second
// card then gets the first one's id.
const [ENG_FIRST] = boardColumnSlugs(config, 'engineering');

// Setup for tests about something else, where the column is always a configured one.
const create = async (root: string, input: CreateCardInput): Promise<Card> =>
  cardFrom(await createCard(root, config, input, TODAY));

describe('mutations', () => {
  it('creates a card with the next id and a file on disk', async () => {
    const root = await tempDir();
    const card = await create(root, {
      board: 'engineering',
      columnSlug: ENG_FIRST,
      title: 'First',
      links: ['P-001'],
    });
    expect(card.id).toBe('E-001');
    expect(card.created).toBe(TODAY);
    expect(card.links).toEqual(['P-001']);
    await expect(access(card.filePath)).resolves.toBeUndefined();

    const second = await create(root, { board: 'engineering', columnSlug: ENG_FIRST, title: 'Second' });
    expect(second.id).toBe('E-002');
    expect(second.order).toBeGreaterThan(card.order);
  });

  it('does not reuse an archived id', async () => {
    const root = await tempDir();
    const c1 = await create(root, { board: 'product', columnSlug: 'todo', title: 'A' });
    await archiveCard(root, c1, NOW);
    const c2 = await create(root, { board: 'product', columnSlug: 'todo', title: 'B' });
    expect(c2.id).toBe('P-002');
  });

  it('updates fields and rewrites the file', async () => {
    const root = await tempDir();
    const card = await create(root, { board: 'product', columnSlug: 'todo', title: 'A' });
    const updated = await updateCard(root, card, { title: 'Renamed', tags: ['x'] });
    expect(updated.title).toBe('Renamed');
    const onDisk = await readFile(card.filePath, 'utf8');
    expect(onDisk).toContain('title: Renamed');
    expect(onDisk).toContain('- x');
  });

  it('moves a card to another column (file relocates, id unchanged)', async () => {
    const root = await tempDir();
    const card = await create(root, { board: 'product', columnSlug: 'todo', title: 'A' });
    const moved = cardFrom(await placeCard(root, config, card, 'in-progress', null));
    expect(moved.columnSlug).toBe('in-progress');
    expect(moved.id).toBe(card.id);
    const board = await readBoard(root, 'product', config);
    expect(board.find((c) => c.id === card.id)?.columnSlug).toBe('in-progress');
  });

  // A column is a folder, so an unconfigured slug never failed — it created a folder no column
  // maps to, and the card in it was invisible to readBoard while still holding its id.
  it('refuses to create a card in a column the board does not have', async () => {
    const root = await tempDir();
    // Deliberately not the `create` helper: this test wants the sentinel, not a thrown fixture.
    const result = await createCard(
      root,
      config,
      { board: 'engineering', columnSlug: 'not-a-column', title: 'Phantom' },
      TODAY,
    );
    expect(result).toBe('unknown-column');
    // Creating the folder is the bug, not a side effect of it: the next card would then be
    // numbered against a board that cannot see this one.
    await expect(access(join(root, boardRel('engineering', 'not-a-column')))).rejects.toThrow();
  });

  it('refuses to place a card into a column the board does not have', async () => {
    const root = await tempDir();
    const card = await create(root, { board: 'product', columnSlug: 'todo', title: 'A' });
    expect(await placeCard(root, config, card, 'not-a-column', null)).toBe('unknown-column');
  });

  // The id allocator must see FILENAMES, not parsed cards. Deriving it from readBoard meant an
  // unparseable card released its id, and the next create overwrote the file — the loud failure
  // this codebase deliberately traded away came back as silent data loss instead.
  it('does not reuse the id of a card whose frontmatter will not parse', async () => {
    const root = await tempDir();
    const dir = join(root, boardRel('engineering', ENG_FIRST));
    await mkdir(dir, { recursive: true });
    const victim = join(dir, 'E-001.md');
    await writeFile(victim, '---\nid: E-001\ntitle: "oops\n---\nIRREPLACEABLE\n', 'utf8');
    // The premise: it really is invisible to the board. Without this the test could pass because
    // the card parsed fine after all.
    expect(await readBoard(root, 'engineering', config)).toEqual([]);

    const made = await create(root, { board: 'engineering', columnSlug: ENG_FIRST, title: 'New' });

    expect(made.id).toBe('E-002');
    expect(await readFile(victim, 'utf8')).toContain('IRREPLACEABLE');
  });

  it('counts an archived card that will not parse as spent too', async () => {
    // Same hazard, the folder readBoard never looks in.
    const root = await tempDir();
    const dir = join(root, boardRel('engineering', ARCHIVE_SLUG));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'E-001.md'), '---\ntitle: "oops\n---\n', 'utf8');

    const made = await create(root, { board: 'engineering', columnSlug: ENG_FIRST, title: 'New' });
    expect(made.id).toBe('E-002');
  });

  it('archives a card (moves it out of the board into archive)', async () => {
    const root = await tempDir();
    const card = await create(root, { board: 'engineering', columnSlug: ENG_FIRST, title: 'A' });
    // "Leaves the board" is only observable if it was on the board to begin with: created in a
    // folder no column maps to, it never was, and the empty list below would prove nothing.
    expect((await readBoard(root, 'engineering', config)).map((c) => c.id)).toEqual([card.id]);

    const archived = await archiveCard(root, card, NOW);
    expect(archived.columnSlug).toBe(ARCHIVE_SLUG);
    expect((await readBoard(root, 'engineering', config)).length).toBe(0);
    expect((await readArchive(root, 'engineering')).map((c) => c.id)).toEqual([card.id]);
  });
});
