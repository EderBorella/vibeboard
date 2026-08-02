import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { boardRel } from '../src/core/layout.js';
import { ProjectSession } from '../src/server/session.js';
import { openTestProject, testApp } from './helpers.js';

// The guard rails on the card routes: every handler checks that a project is open and that the
// card exists, and every refusal carries a specific message the UI shows. Those were executed
// but unasserted, so a wrong code or a swapped message would not have failed anything.
let bare: ProjectSession | undefined;

afterEach(async () => {
  await bare?.close();
  bare = undefined;
});

const MISSING = 'product/P-999';

const cardRoutes = [
  { method: 'PATCH' as const, url: `/api/cards/${MISSING}`, payload: { title: 'x' } },
  { method: 'GET' as const, url: `/api/cards/${MISSING}/raw` },
  { method: 'PUT' as const, url: `/api/cards/${MISSING}/raw`, payload: { raw: '# x' } },
  { method: 'PUT' as const, url: `/api/cards/${MISSING}/links`, payload: { links: [] } },
  { method: 'POST' as const, url: `/api/cards/${MISSING}/place`, payload: { toColumnSlug: 'todo' } },
  { method: 'POST' as const, url: `/api/cards/${MISSING}/archive` },
  { method: 'POST' as const, url: `/api/cards/${MISSING}/restore`, payload: {} },
];

describe('card routes with a card that does not exist', () => {
  it.each(cardRoutes)('404s on $method $url', async ({ method, url, payload }) => {
    const { app } = await openTestProject({ name: 'Guard' });
    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Card not found' });
  });
});

describe('card routes with no project open', () => {
  const routes = [
    {
      method: 'POST' as const,
      url: '/api/cards',
      payload: { board: 'product', columnSlug: 'todo', title: 'x' },
    },
    ...cardRoutes,
    { method: 'GET' as const, url: '/api/archive/product' },
  ];

  it.each(routes)('409s on $method $url', async ({ method, url, payload }) => {
    bare = new ProjectSession();
    const app = testApp(bare);
    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'No project open' });
    await app.close();
  });
});

describe('restore refusals', () => {
  it('refuses to restore a card that is not archived', async () => {
    const { app } = await openTestProject({ name: 'Guard' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'product', columnSlug: 'todo', title: 'Live' },
    });
    const { board, id } = created.json();

    const res = await app.inject({ method: 'POST', url: `/api/cards/${board}/${id}/restore`, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Card is not archived' });
  });

  it('refuses a restore target that is not a column on that board', async () => {
    const { app } = await openTestProject({ name: 'Guard' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'product', columnSlug: 'todo', title: 'Archived' },
    });
    const { board, id } = created.json();
    await app.inject({ method: 'POST', url: `/api/cards/${board}/${id}/archive` });

    const res = await app.inject({
      method: 'POST',
      url: `/api/cards/${board}/${id}/restore`,
      payload: { toColumnSlug: 'not-a-column' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Unknown column' });
  });
});

// PATCH used to spread the request body straight onto the card, so anything with a matching key
// landed. The fields below are each governed by something else, and `setup` is authority: a work
// agent able to flag its own card would make its own subtree the only eligible work in the project.
describe('PATCH /api/cards accepts only the fields it is for', () => {
  it('ignores setup, id, order, archived and links', async () => {
    const { app, root, session } = await openTestProject({ name: 'G' });
    const state = (await app.inject({ method: 'GET', url: '/api/state' })).json();
    const before = state.snapshot.boards.engineering[0];

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/cards/engineering/${before.id}`,
      payload: {
        title: 'A new title',
        setup: true,
        // Correctly typed throughout: these are refused for AUTHORITY, not for shape, and mixing a
        // type error in would let the 400-on-wrong-type path answer for the authority test.
        id: 'E-999',
        order: 9999,
        archived: '2026-08-02T00:00:00Z',
        archivedFrom: 'backlog',
        links: ['P-404'],
      },
    });
    expect(res.statusCode).toBe(200);

    const after = res.json();
    expect(after.title).toBe('A new title'); // the field it IS for still works
    expect(after.setup).toBeUndefined();
    expect(after.id).toBe(before.id);
    expect(after.order).toBe(before.order);
    expect(after.archived).toBeUndefined();
    expect(after.links).toEqual(before.links);

    // And on disk, not merely in the reply.
    await session.reloadConfig();
    const raw = await readFile(
      join(root, boardRel('engineering', after.columnSlug, `${before.id}.md`)),
      'utf8',
    );
    expect(raw).not.toContain('setup');
    expect(raw).not.toContain('E-999');
  });
});

// The other half: a field this endpoint DOES take, with the wrong type. Refused, because answering
// 200 over a card that did not change tells an agent it succeeded and it will not try again.
describe('PATCH /api/cards refuses a wrong-typed field', () => {
  it('400s and names the fields, leaving the card alone', async () => {
    const { app } = await openTestProject({ name: 'G' });
    const state = (await app.inject({ method: 'GET', url: '/api/state' })).json();
    const before = state.snapshot.boards.engineering[0];

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/cards/engineering/${before.id}`,
      // `tags: "urgent"` is the plausible agent mistake: the prose says tags, the key is a list.
      payload: { title: 'Fine', tags: 'urgent' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('tags');

    // Nothing applied — not even the field that WAS valid. A partial write on a refused request is
    // the worst of both answers.
    const after = (await app.inject({ method: 'GET', url: '/api/state' })).json();
    expect(after.snapshot.boards.engineering[0].title).toBe(before.title);
  });
});
