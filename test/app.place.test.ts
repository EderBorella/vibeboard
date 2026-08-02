import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../src/core/runs.js';
import { readRun, writeRun } from '../src/server/run-store.js';
import { openTestProject } from './helpers.js';

interface WireCard {
  id: string;
  title: string;
  columnSlug: string;
  order: number;
}

async function setup(): Promise<{ app: FastifyInstance; ids: string[]; root: string }> {
  // brownfield = no sample cards, so the order under test is entirely ours
  const { app, root } = await openTestProject({ name: 'Ord', mode: 'brownfield' });
  const ids: string[] = [];
  for (const title of ['a', 'b', 'c']) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'product', columnSlug: 'todo', title },
    });
    ids.push(res.json().id);
  }
  return { app, ids, root };
}

const column = async (a: FastifyInstance, slug: string): Promise<WireCard[]> => {
  const snap = (await a.inject({ method: 'GET', url: '/api/state' })).json().snapshot;
  return (snap.boards.product as WireCard[]).filter((c) => c.columnSlug === slug);
};

describe('POST /cards/:board/:id/place', () => {
  it('reorders within a column and reflects it in the snapshot', async () => {
    const { app, ids } = await setup();
    expect((await column(app, 'todo')).map((c) => c.title)).toEqual(['a', 'b', 'c']);

    const res = await app.inject({
      method: 'POST',
      url: `/api/cards/product/${ids[2]}/place`,
      payload: { toColumnSlug: 'todo', beforeId: ids[0] },
    });
    expect(res.statusCode).toBe(200);
    expect((await column(app, 'todo')).map((c) => c.title)).toEqual(['c', 'a', 'b']);
    expect((await column(app, 'todo')).map((c) => c.order)).toEqual([10, 20, 30]);
  });

  it('treats a null beforeId as the end of the column', async () => {
    const { app, ids } = await setup();
    await app.inject({
      method: 'POST',
      url: `/api/cards/product/${ids[0]}/place`,
      payload: { toColumnSlug: 'todo', beforeId: null },
    });
    expect((await column(app, 'todo')).map((c) => c.title)).toEqual(['b', 'c', 'a']);
  });

  it('moves a card into another column at a position', async () => {
    const { app, ids } = await setup();
    await app.inject({
      method: 'POST',
      url: `/api/cards/product/${ids[0]}/place`,
      payload: { toColumnSlug: 'done', beforeId: null },
    });
    await app.inject({
      method: 'POST',
      url: `/api/cards/product/${ids[1]}/place`,
      payload: { toColumnSlug: 'done', beforeId: ids[0] },
    });

    expect((await column(app, 'done')).map((c) => c.title)).toEqual(['b', 'a']);
    expect((await column(app, 'todo')).map((c) => c.title)).toEqual(['c']);
  });

  it('404s for an unknown card', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/cards/product/P-999/place',
      payload: { toColumnSlug: 'todo', beforeId: null },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('closing a card resolves the runs on it', () => {
  // Your ruling: reaching the board's LAST column means the card is closed, so nothing on it is
  // still waiting for a decision. Done on the move rather than in the watcher — writing run records
  // in response to filesystem events, inside the folder the watcher watches, is a loop.
  const asking = (card: string, run: string): RunRecord => ({
    run,
    card,
    board: 'product',
    skill: 'execute',
    status: 'attention',
    started: '2026-07-26T21:00:00.000Z',
    backend: 'opencode',
    model: 'nemotron',
    effort: 'max',
    mode: 'build',
    report: 'needs a decision',
  });

  it('resolves them when the card lands in the last column', async () => {
    const { app, ids, root } = await setup();
    await writeRun(root, asking(ids[0], 'r-one'));
    await writeRun(root, asking(ids[0], 'r-two'));

    await app.inject({
      method: 'POST',
      url: `/api/cards/product/${ids[0]}/place`,
      payload: { toColumnSlug: 'done', beforeId: null },
    });

    expect((await readRun(root, 'product', ids[0], 'r-one'))?.resolved).toBeTruthy();
    expect((await readRun(root, 'product', ids[0], 'r-two'))?.resolved).toBeTruthy();
  });

  // /move is the door agents use, and it was untested here: reimplementing its handler without the
  // shared helper left the suite green. The extraction's whole stated purpose is that this rule has
  // ONE home, and a rule only one caller is held to has two.
  it('resolves them when the card reaches the last column through /move', async () => {
    const { app, ids, root } = await setup();
    await writeRun(root, asking(ids[0], 'r-one'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/cards/product/${ids[0]}/move`,
      payload: { toColumnSlug: 'done' },
    });

    expect(res.statusCode).toBe(200);
    expect((await readRun(root, 'product', ids[0], 'r-one'))?.resolved).toBeTruthy();
  });

  it('leaves them asking when /move lands anywhere else', async () => {
    const { app, ids, root } = await setup();
    await writeRun(root, asking(ids[0], 'r-one'));
    await app.inject({
      method: 'POST',
      url: `/api/cards/product/${ids[0]}/move`,
      payload: { toColumnSlug: 'in-progress' },
    });
    expect((await readRun(root, 'product', ids[0], 'r-one'))?.resolved).toBeUndefined();
  });

  it('leaves them asking for any other column — only the last one closes a card', async () => {
    // 'In Progress' is not the end of the board, so a card passing through it has decided nothing.
    const { app, ids, root } = await setup();
    await writeRun(root, asking(ids[0], 'r-one'));
    await app.inject({
      method: 'POST',
      url: `/api/cards/product/${ids[0]}/place`,
      payload: { toColumnSlug: 'in-progress', beforeId: null },
    });
    expect((await readRun(root, 'product', ids[0], 'r-one'))?.resolved).toBeUndefined();
  });

  it('leaves another card’s runs alone', async () => {
    const { app, ids, root } = await setup();
    await writeRun(root, asking(ids[0], 'r-mine'));
    await writeRun(root, asking(ids[1], 'r-theirs'));
    await app.inject({
      method: 'POST',
      url: `/api/cards/product/${ids[0]}/place`,
      payload: { toColumnSlug: 'done', beforeId: null },
    });
    expect((await readRun(root, 'product', ids[0], 'r-mine'))?.resolved).toBeTruthy();
    expect((await readRun(root, 'product', ids[1], 'r-theirs'))?.resolved).toBeUndefined();
  });

  it('does not touch a run that succeeded, or one already dealt with', async () => {
    const { app, ids, root } = await setup();
    await writeRun(root, { ...asking(ids[0], 'r-done'), status: 'success' });
    await writeRun(root, { ...asking(ids[0], 'r-earlier'), resolved: 'EARLIER' });
    await app.inject({
      method: 'POST',
      url: `/api/cards/product/${ids[0]}/place`,
      payload: { toColumnSlug: 'done', beforeId: null },
    });
    expect((await readRun(root, 'product', ids[0], 'r-done'))?.resolved).toBeUndefined();
    expect((await readRun(root, 'product', ids[0], 'r-earlier'))?.resolved).toBe('EARLIER');
  });

  it('still places the card when it has no runs at all', async () => {
    const { app, ids } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/api/cards/product/${ids[0]}/place`,
      payload: { toColumnSlug: 'done', beforeId: null },
    });
    expect(res.statusCode).toBe(200);
    expect((await column(app, 'done')).map((c) => c.title)).toEqual(['a']);
  });
});
