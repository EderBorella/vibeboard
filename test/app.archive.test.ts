import { describe, it, expect } from 'vitest';
import { openTestProject } from './helpers.js';
import type { FastifyInstance } from 'fastify';

interface WireCard {
  id: string;
  title: string;
  columnSlug: string;
  restoreTo?: string;
}

async function setup(): Promise<{ app: FastifyInstance; ids: string[] }> {
  // brownfield = no sample cards, so the archive under test is entirely ours
  const { app } = await openTestProject({ name: 'Arc', mode: 'brownfield' });
  const ids: string[] = [];
  for (const [columnSlug, title] of [
    ['todo', 'a'],
    ['in-progress', 'b'],
  ] as const) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'product', columnSlug, title },
    });
    ids.push(res.json().id);
  }
  return { app, ids };
}

const archive = async (a: FastifyInstance): Promise<WireCard[]> =>
  (await a.inject({ method: 'GET', url: '/api/archive/product' })).json().cards;

const state = async (a: FastifyInstance) =>
  (await a.inject({ method: 'GET', url: '/api/state' })).json().snapshot;

describe('archive + restore routes', () => {
  it('lists archived cards with where each would be restored to', async () => {
    const { app, ids } = await setup();
    expect(await archive(app)).toEqual([]);

    await app.inject({ method: 'POST', url: `/api/cards/product/${ids[1]}/archive`, payload: {} });

    const cards = await archive(app);
    expect(cards.map((c) => c.title)).toEqual(['b']);
    expect(cards[0].restoreTo).toBe('in-progress');
    // Archived cards leave the board.
    expect((await state(app)).boards.product.map((c: WireCard) => c.title)).toEqual(['a']);
  });

  it('reports the archive count on the snapshot without shipping the cards', async () => {
    const { app, ids } = await setup();
    expect((await state(app)).archivedCounts.product).toBe(0);

    await app.inject({ method: 'POST', url: `/api/cards/product/${ids[0]}/archive`, payload: {} });

    const snap = await state(app);
    expect(snap.archivedCounts.product).toBe(1);
    expect(snap.archivedCounts.features).toBe(0);
    expect(snap.boards.product.map((c: WireCard) => c.title)).toEqual(['b']);
  });

  it('restores a card to the column it came from', async () => {
    const { app, ids } = await setup();
    await app.inject({ method: 'POST', url: `/api/cards/product/${ids[1]}/archive`, payload: {} });

    const res = await app.inject({
      method: 'POST',
      url: `/api/cards/product/${ids[1]}/restore`,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().columnSlug).toBe('in-progress');
    expect(await archive(app)).toEqual([]);
    const snap = await state(app);
    expect(snap.boards.product.map((c: WireCard) => c.title).sort()).toEqual(['a', 'b']);
    expect(snap.archivedCounts.product).toBe(0);
  });

  it('restores to an explicitly chosen column', async () => {
    const { app, ids } = await setup();
    await app.inject({ method: 'POST', url: `/api/cards/product/${ids[1]}/archive`, payload: {} });

    const res = await app.inject({
      method: 'POST',
      url: `/api/cards/product/${ids[1]}/restore`,
      payload: { toColumnSlug: 'todo' },
    });

    expect(res.json().columnSlug).toBe('todo');
  });

  it('400s on a column the board does not have', async () => {
    const { app, ids } = await setup();
    await app.inject({ method: 'POST', url: `/api/cards/product/${ids[1]}/archive`, payload: {} });

    const res = await app.inject({
      method: 'POST',
      url: `/api/cards/product/${ids[1]}/restore`,
      payload: { toColumnSlug: 'nope' },
    });

    expect(res.statusCode).toBe(400);
    expect((await archive(app)).length).toBe(1); // refused, not half-applied
  });

  it('400s on restoring a card that is not archived', async () => {
    const { app, ids } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/api/cards/product/${ids[0]}/restore`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s for an unknown card', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/cards/product/P-999/restore', payload: {} });
    expect(res.statusCode).toBe(404);
  });
});
