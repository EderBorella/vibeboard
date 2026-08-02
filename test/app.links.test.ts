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

// Rollup advances a parent when all its children are terminal, and the hierarchy it reads is these
// links. Two parents means a "see also" can finish an unrelated card.
describe('one parent per card', () => {
  // A second feature to be the second parent, and a product card to hang them off.
  async function twoFeatures(): Promise<{
    app: Awaited<ReturnType<typeof openTestProject>>['app'];
    p2: string;
  }> {
    const project = await openTestProject({ name: 'L' });
    const create = async (board: string, columnSlug: string, title: string): Promise<string> =>
      (
        await project.app.inject({ method: 'POST', url: '/api/cards', payload: { board, columnSlug, title } })
      ).json().id;
    await create('features', 'todo', 'Second feature'); // F-002
    const p2 = await create('product', 'todo', 'Second product');
    return { app: project.app, p2 };
  }

  it('lets the browser link a product card to two features by default', async () => {
    const { app, p2 } = await twoFeatures();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/cards/product/${p2}/links`,
      payload: { links: ['F-001', 'F-002'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().links).toEqual(expect.arrayContaining(['F-001', 'F-002']));
  });

  it('refuses it once the project asks for the discipline', async () => {
    const { app, p2 } = await twoFeatures();
    await app.inject({ method: 'PATCH', url: '/api/config', payload: { enforceOneParent: true } });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/cards/product/${p2}/links`,
      payload: { links: ['F-001', 'F-002'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('two parents on the features board');

    // One is still fine, switch or no switch.
    const one = await app.inject({
      method: 'PUT',
      url: `/api/cards/product/${p2}/links`,
      payload: { links: ['F-001'] },
    });
    expect(one.statusCode).toBe(200);
  });
});
