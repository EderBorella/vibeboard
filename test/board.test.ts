import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardColumnSlugs, countArchived, readArchive, readBoard } from '../src/core/board.js';
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
