import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardColumnSlugs } from '../src/core/board.js';
import { defaultConfig } from '../src/core/config.js';
import { boardRel } from '../src/core/layout.js';
import { openTestProject } from './helpers.js';

describe('PUT /cards/:board/:id/links', () => {
  it('links a product card to the sample engineering card on both sides', async () => {
    const { app } = await openTestProject({ name: 'L' });
    // sample cards: P-001 (product), E-001 (engineering, already links P-001)
    const created = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'product', columnSlug: 'todo', title: 'Second product' },
    });
    const p2 = created.json().id; // P-002

    const res = await app.inject({
      method: 'PUT',
      url: `/api/cards/product/${p2}/links`,
      payload: { links: ['E-001'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().links).toContain('E-001');

    const state = await app.inject({ method: 'GET', url: '/api/state' });
    const snap = state.json().snapshot;
    const e1 = snap.boards.engineering.find((c: { id: string }) => c.id === 'E-001');
    expect(e1.links).toContain(p2); // reverse side updated
  });

  it('404 for a missing card', async () => {
    const { app } = await openTestProject({ name: 'L' });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/cards/product/P-999/links',
      payload: { links: [] },
    });
    expect(res.statusCode).toBe(404);
  });
});

// Answering 200 here tells an agent its child is attached when the child is an orphan. break-down
// derives the whole hierarchy from these links, so a false success is a hole in the tree the loop
// then walks.
describe('a link target whose file cannot be read', () => {
  it('is refused rather than answered 200 with the link missing', async () => {
    const { app, root } = await openTestProject({ name: 'L' });
    const [column] = boardColumnSlugs(defaultConfig('L'), 'engineering');
    await writeFile(
      join(root, boardRel('engineering', column, 'E-050.md')),
      '---\ntitle: "broken\n---\nx\n',
      'utf8',
    );

    const res = await app.inject({
      method: 'PUT',
      url: '/api/cards/product/P-001/links',
      payload: { links: ['E-050'] },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('E-050');
  });

  it('still ignores an id that names no file, which is the documented contract', async () => {
    const { app } = await openTestProject({ name: 'L' });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/cards/product/P-001/links',
      payload: { links: ['E-999'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().links).toEqual([]);
  });
});
