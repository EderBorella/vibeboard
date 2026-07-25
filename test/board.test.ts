import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers.js';
import { defaultConfig } from '../src/core/config.js';
import { readBoard, readArchive, boardColumnSlugs, ARCHIVE_SLUG } from '../src/core/board.js';

async function writeCard(root: string, rel: string, body: string) {
  const path = join(root, rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, body, 'utf8');
}

describe('readBoard', () => {
  it('reads cards from column folders, sorted by order, excluding archive', async () => {
    const root = await tempDir();
    const config = defaultConfig('T');
    await writeCard(
      root,
      'engineering/todo/E-002.md',
      '---\nid: E-002\ntitle: second\norder: 20\ncreated: 2026-07-23\n---\nbody',
    );
    await writeCard(
      root,
      'engineering/todo/E-001.md',
      '---\nid: E-001\ntitle: first\norder: 10\ncreated: 2026-07-23\n---\nbody',
    );
    await writeCard(
      root,
      'engineering/archive/E-009.md',
      '---\nid: E-009\ntitle: gone\norder: 5\ncreated: 2026-07-23\n---\nbody',
    );

    const cards = await readBoard(root, 'engineering', config);
    expect(cards.map((c) => c.id)).toEqual(['E-001', 'E-002']);
    expect(cards[0].board).toBe('engineering');
    expect(cards[0].columnSlug).toBe('todo');
  });

  it('returns [] for a board with no folders yet', async () => {
    const root = await tempDir();
    expect(await readBoard(root, 'product', defaultConfig('T'))).toEqual([]);
  });

  it('reads archived cards separately', async () => {
    const root = await tempDir();
    await writeCard(
      root,
      'engineering/archive/E-009.md',
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
});
