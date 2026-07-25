import { describe, it, expect } from 'vitest';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers.js';
import { validateColumns, reconcileColumns } from '../src/core/columns.js';

async function board(root: string, slugs: string[], cards: Record<string, string[]> = {}): Promise<void> {
  for (const slug of [...slugs, 'archive']) {
    await mkdir(join(root, 'product', slug), { recursive: true });
    for (const id of cards[slug] ?? []) {
      await writeFile(join(root, 'product', slug, `${id}.md`), `---\nid: ${id}\ntitle: t\norder: 10\ntags: []\nlinks: []\ncreated: 2026-07-25\n---\n`, 'utf8');
    }
  }
}

const dirs = async (root: string): Promise<string[]> =>
  (await readdir(join(root, 'product'), { withFileTypes: true }))
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();

describe('validateColumns', () => {
  it('accepts a normal list', () => {
    expect(validateColumns(['Backlog', 'Todo', 'In Progress'])).toBeNull();
  });

  it('rejects an empty list', () => {
    expect(validateColumns([])).toMatch(/at least one/i);
  });

  it('rejects names that collide once slugged', () => {
    expect(validateColumns(['Todo', 'todo'])).toMatch(/duplicate/i);
    expect(validateColumns(['In Progress', 'in-progress'])).toMatch(/duplicate/i);
  });

  it('rejects "Archive", which would collide with the archive folder', () => {
    expect(validateColumns(['Todo', 'Archive'])).toMatch(/archive/i);
  });

  it('rejects a name that slugs to nothing', () => {
    expect(validateColumns(['Todo', '!!!'])).toMatch(/valid/i);
  });
});

describe('reconcileColumns — rename', () => {
  it('renames the folder so cards follow the column', async () => {
    const root = await tempDir();
    await board(root, ['backlog', 'todo', 'done'], { todo: ['P-001', 'P-002'] });

    const result = await reconcileColumns(root, 'product', ['Backlog', 'Todo', 'Done'], ['Backlog', 'Next', 'Done']);
    expect(result).toEqual({ renamed: [{ from: 'todo', to: 'next' }] });
    expect(await dirs(root)).toEqual(['archive', 'backlog', 'done', 'next']);
    // both cards came with it
    expect((await readdir(join(root, 'product', 'next'))).sort()).toEqual(['P-001.md', 'P-002.md']);
  });

  it('handles two renames at once', async () => {
    const root = await tempDir();
    await board(root, ['todo', 'done'], { todo: ['P-001'] });
    const result = await reconcileColumns(root, 'product', ['Todo', 'Done'], ['Next', 'Shipped']);
    expect(result).toEqual({ renamed: [{ from: 'todo', to: 'next' }, { from: 'done', to: 'shipped' }] });
    expect(await dirs(root)).toEqual(['archive', 'next', 'shipped']);
  });

  it('is a no-op when nothing changed', async () => {
    const root = await tempDir();
    await board(root, ['todo', 'done']);
    expect(await reconcileColumns(root, 'product', ['Todo', 'Done'], ['Todo', 'Done'])).toEqual({ renamed: [] });
  });

  it('treats an identical set in a new order as a pure reorder — no folder touched', async () => {
    const root = await tempDir();
    await board(root, ['backlog', 'todo'], { todo: ['P-001'] });
    const result = await reconcileColumns(root, 'product', ['Backlog', 'Todo'], ['Todo', 'Backlog']);
    expect(result).toEqual({ renamed: [] });
    expect(await dirs(root)).toEqual(['archive', 'backlog', 'todo']);
    expect(await readdir(join(root, 'product', 'todo'))).toEqual(['P-001.md']);
  });

  it('refuses to guess when a rename is mixed with a reorder', async () => {
    const root = await tempDir();
    await board(root, ['backlog', 'todo'], { todo: ['P-001'] });
    // Todo -> Next AND the two swapped position: intent is ambiguous.
    const result = await reconcileColumns(root, 'product', ['Backlog', 'Todo'], ['Next', 'Backlog']);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/one change at a time|ambiguous/i);
    expect(await dirs(root)).toEqual(['archive', 'backlog', 'todo']); // untouched
  });
});

describe('reconcileColumns — add and remove', () => {
  it('allows adding a column (folder is created lazily by the first card)', async () => {
    const root = await tempDir();
    await board(root, ['todo']);
    expect(await reconcileColumns(root, 'product', ['Todo'], ['Todo', 'Review'])).toEqual({ renamed: [] });
  });

  it('allows removing an EMPTY column', async () => {
    const root = await tempDir();
    await board(root, ['todo', 'review']);
    expect(await reconcileColumns(root, 'product', ['Todo', 'Review'], ['Todo'])).toEqual({ renamed: [] });
  });

  it('refuses to remove a column that still holds cards, naming it and the count', async () => {
    const root = await tempDir();
    await board(root, ['todo', 'review'], { review: ['P-001', 'P-002'] });
    const result = await reconcileColumns(root, 'product', ['Todo', 'Review'], ['Todo']);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/Review/);
    expect((result as { error: string }).error).toMatch(/2 card/);
    // nothing moved or lost
    expect((await readdir(join(root, 'product', 'review'))).sort()).toEqual(['P-001.md', 'P-002.md']);
  });

  it('refuses a rename whose target folder already exists', async () => {
    const root = await tempDir();
    await board(root, ['todo', 'next'], { todo: ['P-001'], next: ['P-002'] });
    // "Todo" -> "Next" would merge into an existing folder.
    const result = await reconcileColumns(root, 'product', ['Todo', 'Next'], ['Next', 'Next 2']);
    expect(result).toHaveProperty('error');
    expect((await readdir(join(root, 'product', 'todo'))).sort()).toEqual(['P-001.md']);
  });
});
