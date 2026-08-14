import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardRel } from '../src/core/layout.js';
import { boardColumnSlugs } from '../src/store/cards/board.js';
import { defaultConfig } from '../src/store/project/config.js';
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

// THE FIELD NO TEST ANYWHERE EXERCISED, which is how it shipped: `POST /api/cards` accepted `links`, wrote them
// into the new card's frontmatter without the far side, and answered 200 echoing them back. It is a person's
// field now (ruling 65) — a run's parent link is the server's — and it goes through the one writer that does both
// sides.
describe('POST /cards with links', () => {
  const create = (
    app: Awaited<ReturnType<typeof openTestProject>>['app'],
    payload: Record<string, unknown>,
  ): Promise<{ statusCode: number; json: () => Record<string, string> }> =>
    app.inject({ method: 'POST', url: '/api/cards', payload }) as unknown as Promise<{
      statusCode: number;
      json: () => Record<string, string>;
    }>;

  it('writes the far side, so the new card is a child rather than an orphan', async () => {
    const { app } = await openTestProject({ name: 'L' });
    const made = await create(app, {
      board: 'product',
      columnSlug: 'todo',
      title: 'Mine, under F-001',
      links: ['F-001'],
    });
    expect(made.statusCode).toBe(200);
    expect((made.json() as unknown as { links: string[] }).links).toEqual(['F-001']);

    const state = await app.inject({ method: 'GET', url: '/api/state' });
    const f1 = state.json().snapshot.boards.features.find((c: { id: string }) => c.id === 'F-001');
    expect(f1.links).toContain(made.json().id);
  });

  it('still ignores an id that names no card, which is the documented contract', async () => {
    const { app } = await openTestProject({ name: 'L' });
    const made = await create(app, {
      board: 'product',
      columnSlug: 'todo',
      title: 'Linked to nothing',
      links: ['F-999'],
    });
    expect(made.statusCode).toBe(200);
    expect((made.json() as unknown as { links: string[] }).links).toEqual([]);
  });

  it('refuses a second parent once the project asks for the discipline, and keeps no card', async () => {
    const { app } = await openTestProject({ name: 'L' });
    await create(app, { board: 'features', columnSlug: 'todo', title: 'Second feature' }); // F-002
    await app.inject({ method: 'PATCH', url: '/api/config', payload: { enforceOneParent: true } });

    const refused = await create(app, {
      board: 'product',
      columnSlug: 'todo',
      title: 'Under both',
      links: ['F-001', 'F-002'],
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toContain('two parents on the features board');

    // NOTHING LEFT BEHIND, and the id proves it: a refused create that left its file standing would have spent
    // P-002, so the next card would be P-003.
    const next = await create(app, { board: 'product', columnSlug: 'todo', title: 'The next one' });
    expect(next.json().id).toBe('P-002');
  });

  it('refuses giving an existing card a second parent through the back-reference', async () => {
    // The FAR side, which is the half the create path had no check for at all: E-001 already hangs off P-001, and
    // the payload below writes this new card's id onto it.
    const { app } = await openTestProject({ name: 'L' });
    await app.inject({ method: 'PATCH', url: '/api/config', payload: { enforceOneParent: true } });
    const refused = await create(app, {
      board: 'product',
      columnSlug: 'todo',
      title: 'Adopting a task that has a story',
      links: ['E-001'],
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toContain('already has a parent on the product board');
  });

  it('lets the browser hang a card off two features by default', async () => {
    // Same trade as the links route: many-to-many is legitimate when a person means it, and only the derived
    // hierarchy cannot survive it — so the switch, not the create, is what decides.
    const { app } = await openTestProject({ name: 'L' });
    await create(app, { board: 'features', columnSlug: 'todo', title: 'Second feature' }); // F-002
    const made = await create(app, {
      board: 'product',
      columnSlug: 'todo',
      title: 'Under both',
      links: ['F-001', 'F-002'],
    });
    expect(made.statusCode).toBe(200);
    expect((made.json() as unknown as { links: string[] }).links).toEqual(
      expect.arrayContaining(['F-001', 'F-002']),
    );
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

// A parent advances once all its children are settled — the machine sends it into its checkup phase — and the
// hierarchy that walk reads is these links. Two parents means a "see also" can finish an unrelated card.
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

  // These two drive the ADMIN path deliberately — they are about the settings switch. Agent
  // enforcement is pinned in test/auth.test.ts, which mints a work credential and expects a refusal
  // with the switch off; deleting the agent half here would leave both of these passing. Noted because
  // the coverage for this feature lives in two files and the split is not obvious from either.
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
