import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { ProjectSession } from '../src/server/session.js';
import { openTestProject } from './helpers.js';

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
    const app = buildApp(bare);
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
