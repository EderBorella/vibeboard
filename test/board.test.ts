import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  boardColumnSlugs,
  type CardProblem,
  countArchived,
  readArchive,
  readBoard,
} from '../src/core/board.js';
import { defaultConfig } from '../src/core/config.js';
import { ARCHIVE_SLUG, boardRel } from '../src/core/layout.js';
import { tempDir } from './helpers.js';

async function writeCard(root: string, rel: string, body: string) {
  const path = join(root, rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, body, 'utf8');
}

describe('readBoard', () => {
  it('reads cards from column folders, sorted by order, excluding archive', async () => {
    const root = await tempDir();
    const config = defaultConfig('T');
    // Taken from the config rather than typed in: readBoard only reads the folders the config
    // names, so a fixture in any other folder would prove nothing about the sort.
    const [column] = boardColumnSlugs(config, 'engineering');
    await writeCard(
      root,
      boardRel('engineering', column, 'E-002.md'),
      '---\nid: E-002\ntitle: second\norder: 20\ncreated: 2026-07-23\n---\nbody',
    );
    await writeCard(
      root,
      boardRel('engineering', column, 'E-001.md'),
      '---\nid: E-001\ntitle: first\norder: 10\ncreated: 2026-07-23\n---\nbody',
    );
    await writeCard(
      root,
      boardRel('engineering', ARCHIVE_SLUG, 'E-009.md'),
      '---\nid: E-009\ntitle: gone\norder: 5\ncreated: 2026-07-23\n---\nbody',
    );

    const cards = await readBoard(root, 'engineering', config);
    expect(cards.map((c) => c.id)).toEqual(['E-001', 'E-002']);
    expect(cards[0].board).toBe('engineering');
    expect(cards[0].columnSlug).toBe(column);
  });

  it('returns [] for a board with no folders yet', async () => {
    const root = await tempDir();
    expect(await readBoard(root, 'product', defaultConfig('T'))).toEqual([]);
  });

  it('reads archived cards separately', async () => {
    const root = await tempDir();
    await writeCard(
      root,
      boardRel('engineering', ARCHIVE_SLUG, 'E-009.md'),
      '---\nid: E-009\ntitle: gone\norder: 5\ncreated: 2026-07-23\n---\nbody',
    );
    const arch = await readArchive(root, 'engineering');
    expect(arch.map((c) => c.id)).toEqual(['E-009']);
    expect(arch[0].columnSlug).toBe(ARCHIVE_SLUG);
  });

  it('maps configured column names to slugs', () => {
    const slugs = boardColumnSlugs(defaultConfig('T'), 'product');
    expect(slugs).toEqual(['backlog', 'todo', 'in-progress', 'done']);
  });

  // Cards are markdown files, but a column folder is an ordinary directory the user can drop
  // anything into — editor litter must not surface as a card with an empty id.
  it('ignores anything that is not markdown in a column folder', async () => {
    const root = await tempDir();
    await writeCard(
      root,
      boardRel('product', 'todo', 'P-001.md'),
      '---\nid: P-001\ntitle: real\norder: 10\n---\nbody',
    );
    await writeCard(root, boardRel('product', 'todo', '.DS_Store'), '');
    await writeCard(root, boardRel('product', 'todo', 'notes.txt'), 'scratch');

    const cards = await readBoard(root, 'product', defaultConfig('T'));
    expect(cards.map((c) => c.id)).toEqual(['P-001']);
  });

  // One hand-edited file used to take the whole board down, and with it the snapshot, every
  // mutation and dispatch. Unterminated quote: gray-matter throws here, it does not return {}.
  it('skips a card whose frontmatter will not parse, and reads the rest', async () => {
    const root = await tempDir();
    const config = defaultConfig('T');
    const [column] = boardColumnSlugs(config, 'engineering');
    await writeCard(
      root,
      boardRel('engineering', column, 'E-001.md'),
      '---\nid: E-001\ntitle: good\norder: 10\ncreated: 2026-07-23\n---\nbody',
    );
    await writeCard(root, boardRel('engineering', column, 'E-999.md'), '---\ntitle: "oops\n---\nbody\n');

    const cards = await readBoard(root, 'engineering', config);
    expect(cards.map((c) => c.id)).toEqual(['E-001']);
  });

  it('sorts the archive newest first, leaving undated cards at the bottom', async () => {
    const root = await tempDir();
    const card = (id: string, archived?: string): string =>
      `---\nid: ${id}\ntitle: ${id}\norder: 10\ncreated: 2026-07-01\n${archived ? `archived: '${archived}'\n` : ''}---\nbody`;
    // Two undated cards, and one of them read first: the comparator only ever receives an
    // already-sorted element as its second argument, so a single undated card written last
    // never exercises the missing-timestamp path at all.
    await writeCard(root, boardRel('engineering', ARCHIVE_SLUG, 'E-000.md'), card('E-000'));
    await writeCard(
      root,
      boardRel('engineering', ARCHIVE_SLUG, 'E-001.md'),
      card('E-001', '2026-07-20T10:00:00Z'),
    );
    await writeCard(
      root,
      boardRel('engineering', ARCHIVE_SLUG, 'E-002.md'),
      card('E-002', '2026-07-25T10:00:00Z'),
    );
    await writeCard(root, boardRel('engineering', ARCHIVE_SLUG, 'E-003.md'), card('E-003'));

    // Dated newest first, then the undated ones by descending id.
    expect((await readArchive(root, 'engineering')).map((c) => c.id)).toEqual([
      'E-002',
      'E-001',
      'E-003',
      'E-000',
    ]);
  });
});

describe('countArchived', () => {
  it('counts only markdown, and zero for a board that has never archived', async () => {
    const root = await tempDir();
    expect(await countArchived(root, 'product')).toBe(0);

    await writeCard(
      root,
      boardRel('product', ARCHIVE_SLUG, 'P-001.md'),
      '---\nid: P-001\ntitle: a\norder: 10\n---\n',
    );
    await writeCard(
      root,
      boardRel('product', ARCHIVE_SLUG, 'P-002.md'),
      '---\nid: P-002\ntitle: b\norder: 20\n---\n',
    );
    await writeCard(root, boardRel('product', ARCHIVE_SLUG, '.DS_Store'), '');
    expect(await countArchived(root, 'product')).toBe(2);
  });
});

// The plan asked for "skip an unparseable card WITH A REASON", and the first implementation gave
// only the skip. A card that vanishes with no explanation is indistinguishable from one the user
// only thinks they wrote, and they will go looking in the wrong place.
describe('reporting what could not be read', () => {
  it('reports the path and a reason for a card whose frontmatter will not parse', async () => {
    const root = await tempDir();
    const config = defaultConfig('T');
    const [column] = boardColumnSlugs(config, 'engineering');
    await writeCard(root, boardRel('engineering', column, 'E-001.md'), '---\ntitle: "oops\n---\nbody\n');

    const problems: CardProblem[] = [];
    await readBoard(root, 'engineering', config, problems);

    expect(problems).toHaveLength(1);
    expect(problems[0].path).toContain('E-001.md');
    expect(problems[0].reason).toBeTruthy();
  });

  // A folder that is ABSENT is ordinary — a column's folder is created by the first card written into
  // it. A folder that cannot be READ is not, and both used to answer with an empty list. Auto-pilot's
  // one success reason is "no non-terminal card exists anywhere", so a permission error, a bad mount or
  // an interrupted rename silently became a finished project.
  it('reports a column folder it cannot read, and says nothing about one that is merely absent', async () => {
    const root = await tempDir();
    const config = defaultConfig('T');
    const [column] = boardColumnSlugs(config, 'engineering');
    await writeCard(
      root,
      boardRel('engineering', column, 'E-001.md'),
      '---\nid: E-001\ntitle: real work\norder: 10\n---\nbody',
    );
    const dir = join(root, boardRel('engineering', column));

    // Proof the card is genuinely there first, so the assertion below is about readability rather than
    // about a fixture that was never written.
    expect((await readBoard(root, 'engineering', config, [])).map((c) => c.id)).toEqual(['E-001']);

    await chmod(dir, 0o000);
    try {
      const problems: CardProblem[] = [];
      expect(await readBoard(root, 'engineering', config, problems)).toEqual([]);
      expect(problems).toHaveLength(1);
      expect(problems[0].path).toBe(dir);
      expect(problems[0].reason).toMatch(/could not be read/);
    } finally {
      // Restored whatever happens, or the run's temp root cannot be removed at the end — and this suite
      // has already exhausted a filesystem's inode table once by leaving things behind.
      await chmod(dir, 0o755);
    }

    // The other columns have no folders at all, and none of them is a problem.
    const absent: CardProblem[] = [];
    await readBoard(root, 'product', config, absent);
    expect(absent).toEqual([]);
  });

  it('reports nothing for a board it could read in full', async () => {
    const root = await tempDir();
    const config = defaultConfig('T');
    const [column] = boardColumnSlugs(config, 'engineering');
    await writeCard(
      root,
      boardRel('engineering', column, 'E-001.md'),
      '---\nid: E-001\ntitle: fine\norder: 10\n---\nbody',
    );

    const problems: CardProblem[] = [];
    expect((await readBoard(root, 'engineering', config, problems)).map((c) => c.id)).toEqual(['E-001']);
    expect(problems).toEqual([]);
  });
});

// The badge counts FILES and the drawer lists CARDS, which are the same number until one will not
// parse. They used to disagree in silence: a badge reading 1 opened an empty drawer.
describe('the archive badge and the archive list', () => {
  it('reports the file the list cannot show, so the two account for each other', async () => {
    const root = await tempDir();
    await writeCard(root, boardRel('engineering', ARCHIVE_SLUG, 'E-001.md'), '---\ntitle: "oops\n---\nx\n');

    const problems: CardProblem[] = [];
    const cards = await readArchive(root, 'engineering', problems);

    expect(await countArchived(root, 'engineering')).toBe(1);
    expect(cards).toEqual([]);
    expect(problems.map((p) => p.path.endsWith('E-001.md'))).toEqual([true]);
  });
});
