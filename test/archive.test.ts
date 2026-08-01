import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { boardColumnSlugs, countArchived, readArchive, readBoard } from '../src/core/board.js';
import { defaultConfig } from '../src/core/config.js';
import { ARCHIVE_SLUG } from '../src/core/layout.js';
import { archiveCard, createCard, moveCard, restoreCard, restoreTarget } from '../src/core/mutations.js';
import type { Card, ProjectConfig } from '../src/core/types.js';
import { tempDir } from './helpers.js';

const config = defaultConfig('T');
const TODAY = '2026-07-23';
const at = (hhmm: string): string => `2026-07-23T${hhmm}:00.000Z`;
// Engineering's first column, read off the config the tests share. A card created in a folder no
// column maps to never reaches the board at all, so every assertion below about what readBoard
// returns would pass on an empty list instead.
const [FIRST] = boardColumnSlugs(config, 'engineering');

const make = (root: string, columnSlug: string, title: string): Promise<Card> =>
  createCard(root, config, { board: 'engineering', columnSlug, title }, TODAY);

describe('archiveCard', () => {
  it('records when it was archived and which column it left', async () => {
    const root = await tempDir();
    const card = await make(root, 'in-progress', 'Wire the thing');

    const archived = await archiveCard(root, card, at('10:00'));

    expect(archived.columnSlug).toBe(ARCHIVE_SLUG);
    expect(archived.archived).toBe(at('10:00'));
    expect(archived.archivedFrom).toBe('in-progress');
    // The stamp is on disk, not just in the returned object.
    const raw = await readFile(archived.filePath, 'utf8');
    expect(raw).toContain('archivedFrom: in-progress');
  });

  it('leaves a live card free of archive frontmatter', async () => {
    const root = await tempDir();
    const card = await make(root, FIRST, 'Still live');
    const raw = await readFile(card.filePath, 'utf8');
    expect(raw).not.toContain('archived');
  });
});

describe('readArchive', () => {
  it('lists newest first, with untimestamped cards last', async () => {
    const root = await tempDir();
    const a = await make(root, FIRST, 'A');
    const b = await make(root, FIRST, 'B');
    const c = await make(root, FIRST, 'C');
    await archiveCard(root, a, at('09:00'));
    await archiveCard(root, b, at('11:00'));
    // A card archived before this feature existed: in the folder, no stamp in its frontmatter.
    await moveCard(root, c, ARCHIVE_SLUG);

    expect((await readArchive(root, 'engineering')).map((x) => x.title)).toEqual(['B', 'A', 'C']);
  });

  it('counts without reading the files', async () => {
    const root = await tempDir();
    expect(await countArchived(root, 'engineering')).toBe(0);
    await archiveCard(root, await make(root, FIRST, 'A'), at('09:00'));
    await archiveCard(root, await make(root, FIRST, 'B'), at('09:01'));
    expect(await countArchived(root, 'engineering')).toBe(2);
    expect(await countArchived(root, 'features')).toBe(0);
  });
});

describe('restoreTarget', () => {
  const card = (archivedFrom?: string): Card =>
    ({ board: 'engineering', archivedFrom, columnSlug: ARCHIVE_SLUG }) as Card;

  it('is the column the card left', () => {
    expect(restoreTarget(config, card('in-progress'))).toBe('in-progress');
  });

  it('falls back to the first column when that one is gone', () => {
    // A column rename leaves the old slug pointing at nothing; landing the card in a folder
    // no column maps to would hide it entirely.
    expect(restoreTarget(config, card('was-renamed-away'))).toBe(
      config.boards.engineering.columns[0].toLowerCase(),
    );
  });

  it('falls back for cards archived before archivedFrom was recorded', () => {
    expect(restoreTarget(config, card(undefined))).toBe(config.boards.engineering.columns[0].toLowerCase());
  });
});

describe('restoreCard', () => {
  it('puts the card back in its original column and clears the archive stamp', async () => {
    const root = await tempDir();
    const archived = await archiveCard(root, await make(root, 'in-progress', 'Back'), at('10:00'));

    const restored = await restoreCard(root, config, archived);

    expect(restored).not.toBe('unknown-column');
    const card = restored as Card;
    expect(card.columnSlug).toBe('in-progress');
    expect(card.archived).toBeUndefined();
    expect(card.archivedFrom).toBeUndefined();
    expect(await readFile(card.filePath, 'utf8')).not.toContain('archived');
    expect(await readArchive(root, 'engineering')).toEqual([]);
  });

  it('lands at the end of the target column', async () => {
    const root = await tempDir();
    const first = await make(root, FIRST, 'first');
    await make(root, FIRST, 'second'); // stays put; only its position relative to `first` matters
    const archived = await archiveCard(root, first, at('10:00'));

    await restoreCard(root, config, archived);

    const column = (await readBoard(root, 'engineering', config)).filter((c) => c.columnSlug === FIRST);
    expect(column.map((c) => c.title)).toEqual(['second', 'first']);
    // placeCard renumbers, so the restored card can't collide with `second`.
    expect(column.map((c) => c.order)).toEqual([10, 20]);
  });

  it('honours an explicit target column', async () => {
    const root = await tempDir();
    const archived = await archiveCard(root, await make(root, 'in-progress', 'Elsewhere'), at('10:00'));

    // Explicitly asking for a column other than the one it was archived from is what makes the
    // argument observable — restoreTarget would have sent it back to 'in-progress'.
    const restored = await restoreCard(root, config, archived, FIRST);

    expect((restored as Card).columnSlug).toBe(FIRST);
  });

  it('refuses a column the board does not have', async () => {
    const root = await tempDir();
    const archived = await archiveCard(root, await make(root, 'in-progress', 'Nope'), at('10:00'));

    expect(await restoreCard(root, config, archived, 'not-a-column')).toBe('unknown-column');
    // Refused means untouched: still archived, stamp intact.
    expect((await readArchive(root, 'engineering'))[0].archivedFrom).toBe('in-progress');
  });

  it('restores into a renamed board when the original column vanished', async () => {
    const root = await tempDir();
    const archived = await archiveCard(root, await make(root, 'in-progress', 'Orphan'), at('10:00'));
    // Simulate the column having been renamed since: 'in-progress' is no longer configured.
    const renamed: ProjectConfig = {
      ...config,
      boards: { ...config.boards, engineering: { columns: ['Todo', 'Active', 'Done'] } },
    };

    const restored = await restoreCard(root, renamed, archived);

    expect((restored as Card).columnSlug).toBe('todo');
  });
});
