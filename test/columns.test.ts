import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARCHIVE_SLUG, boardRel } from '../src/core/layout.js';
import { reconcileColumns, validateColumns } from '../src/store/cards/columns.js';
import { tempDir } from './helpers.js';

async function board(root: string, slugs: string[], cards: Record<string, string[]> = {}): Promise<void> {
  for (const slug of [...slugs, ARCHIVE_SLUG]) {
    await mkdir(join(root, boardRel('product', slug)), { recursive: true });
    for (const id of cards[slug] ?? []) {
      await writeFile(
        join(root, boardRel('product', slug, `${id}.md`)),
        `---\nid: ${id}\ntitle: t\norder: 10\ntags: []\nlinks: []\ncreated: 2026-07-25\n---\n`,
        'utf8',
      );
    }
  }
}

const dirs = async (root: string): Promise<string[]> =>
  (await readdir(join(root, boardRel('product')), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

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

    const result = await reconcileColumns(
      root,
      'product',
      ['Backlog', 'Todo', 'Done'],
      ['Backlog', 'Next', 'Done'],
    );
    expect(result).toEqual({ renamed: [{ from: 'todo', to: 'next' }] });
    expect(await dirs(root)).toEqual(['archive', 'backlog', 'done', 'next']);
    // both cards came with it
    expect((await readdir(join(root, boardRel('product', 'next')))).sort()).toEqual(['P-001.md', 'P-002.md']);
  });

  it('handles two renames at once', async () => {
    const root = await tempDir();
    await board(root, ['todo', 'done'], { todo: ['P-001'] });
    const result = await reconcileColumns(root, 'product', ['Todo', 'Done'], ['Next', 'Shipped']);
    expect(result).toEqual({
      renamed: [
        { from: 'todo', to: 'next' },
        { from: 'done', to: 'shipped' },
      ],
    });
    expect(await dirs(root)).toEqual(['archive', 'next', 'shipped']);
  });

  it('is a no-op when nothing changed', async () => {
    const root = await tempDir();
    await board(root, ['todo', 'done']);
    expect(await reconcileColumns(root, 'product', ['Todo', 'Done'], ['Todo', 'Done'])).toEqual({
      renamed: [],
    });
  });

  it('treats an identical set in a new order as a pure reorder — no folder touched', async () => {
    const root = await tempDir();
    await board(root, ['backlog', 'todo'], { todo: ['P-001'] });
    const result = await reconcileColumns(root, 'product', ['Backlog', 'Todo'], ['Todo', 'Backlog']);
    expect(result).toEqual({ renamed: [] });
    expect(await dirs(root)).toEqual(['archive', 'backlog', 'todo']);
    expect(await readdir(join(root, boardRel('product', 'todo')))).toEqual(['P-001.md']);
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
    expect((await readdir(join(root, boardRel('product', 'review')))).sort()).toEqual([
      'P-001.md',
      'P-002.md',
    ]);
  });

  it('refuses a rename whose target folder already exists', async () => {
    const root = await tempDir();
    await board(root, ['todo', 'next'], { todo: ['P-001'], next: ['P-002'] });
    // "Todo" -> "Next" would merge into an existing folder.
    const result = await reconcileColumns(root, 'product', ['Todo', 'Next'], ['Next', 'Next 2']);
    expect(result).toHaveProperty('error');
    expect((await readdir(join(root, boardRel('product', 'todo')))).sort()).toEqual(['P-001.md']);
  });

  // The case above is actually refused earlier, as a rename/reorder mix, so it never reaches the
  // occupied-target check. Getting there needs a target folder that exists on disk WITHOUT being
  // a configured column — a leftover from a column removed earlier, which is exactly when
  // silently merging two columns' cards would be worst.
  it('refuses to merge into a stray folder left behind by an earlier removal', async () => {
    const root = await tempDir();
    await board(root, ['todo'], { todo: ['P-001'] });
    await mkdir(join(root, boardRel('product', 'review')), { recursive: true });

    const result = await reconcileColumns(root, 'product', ['Todo'], ['Review']);
    expect(result).toEqual({
      error:
        'A folder for "Review" already exists. Rename it to something else, or merge the cards yourself.',
    });
    // The cards stay exactly where they were.
    expect((await readdir(join(root, boardRel('product', 'todo')))).sort()).toEqual(['P-001.md']);
  });

  it('says "1 card", not "1 cards", when refusing to remove a column holding one', async () => {
    const root = await tempDir();
    await board(root, ['todo', 'review'], { review: ['P-001'] });
    const result = await reconcileColumns(root, 'product', ['Todo', 'Review'], ['Todo']);
    expect(result).toEqual({
      error: '"Review" still has 1 card. Move or archive them before removing the column.',
    });
  });

  it('names the column and an exact count when refusing to remove a populated one', async () => {
    const root = await tempDir();
    await board(root, ['todo', 'review'], { review: ['P-001', 'P-002'] });
    const result = await reconcileColumns(root, 'product', ['Todo', 'Review'], ['Todo']);
    expect(result).toEqual({
      error: '"Review" still has 2 cards. Move or archive them before removing the column.',
    });
  });

  it('counts only markdown when deciding whether a column is empty', async () => {
    const root = await tempDir();
    await board(root, ['todo', 'review']);
    // Editor litter is not a card and must not block removing the column.
    await writeFile(join(root, boardRel('product', 'review', '.DS_Store')), '', 'utf8');
    await writeFile(join(root, boardRel('product', 'review', 'notes.txt')), 'x', 'utf8');

    expect(await reconcileColumns(root, 'product', ['Todo', 'Review'], ['Todo'])).toEqual({ renamed: [] });
  });

  it('removes a column whose folder was never created', async () => {
    const root = await tempDir();
    await board(root, ['todo']); // "Review" is configured but has no folder yet
    expect(await reconcileColumns(root, 'product', ['Todo', 'Review'], ['Todo'])).toEqual({ renamed: [] });
  });

  it('renames a column that has no folder yet without failing', async () => {
    const root = await tempDir();
    await board(root, ['todo']);
    // "Review" was added but never received a card, so there is nothing on disk to move.
    expect(await reconcileColumns(root, 'product', ['Todo', 'Review'], ['Todo', 'Done'])).toEqual({
      renamed: [{ from: 'review', to: 'done' }],
    });
    expect(await dirs(root)).toEqual(['archive', 'todo']);
  });
});
