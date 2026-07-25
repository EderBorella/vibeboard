import { describe, it, expect, afterEach } from 'vitest';
import { tempDir } from './helpers.js';
import { ProjectSession } from '../src/server/session.js';
import { buildApp } from '../src/server/app.js';
import type { FastifyInstance } from 'fastify';

let session: ProjectSession | undefined;
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  await session?.close();
  app = undefined;
  session = undefined;
});

interface WireCard { id: string; title: string; columnSlug: string; order: number }

async function setup(): Promise<{ app: FastifyInstance; ids: string[] }> {
  session = new ProjectSession();
  app = buildApp(session);
  const root = await tempDir();
  // brownfield = no sample cards, so the order under test is entirely ours
  await app.inject({ method: 'POST', url: '/api/project/scaffold', payload: { path: root, name: 'Ord', mode: 'brownfield' } });
  const ids: string[] = [];
  for (const title of ['a', 'b', 'c']) {
    const res = await app.inject({
      method: 'POST', url: '/api/cards',
      payload: { board: 'product', columnSlug: 'todo', title },
    });
    ids.push(res.json().id);
  }
  return { app, ids };
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
      method: 'POST', url: `/api/cards/product/${ids[2]}/place`,
      payload: { toColumnSlug: 'todo', beforeId: ids[0] },
    });
    expect(res.statusCode).toBe(200);
    expect((await column(app, 'todo')).map((c) => c.title)).toEqual(['c', 'a', 'b']);
    expect((await column(app, 'todo')).map((c) => c.order)).toEqual([10, 20, 30]);
  });

  it('treats a null beforeId as the end of the column', async () => {
    const { app, ids } = await setup();
    await app.inject({
      method: 'POST', url: `/api/cards/product/${ids[0]}/place`,
      payload: { toColumnSlug: 'todo', beforeId: null },
    });
    expect((await column(app, 'todo')).map((c) => c.title)).toEqual(['b', 'c', 'a']);
  });

  it('moves a card into another column at a position', async () => {
    const { app, ids } = await setup();
    await app.inject({ method: 'POST', url: `/api/cards/product/${ids[0]}/place`, payload: { toColumnSlug: 'done', beforeId: null } });
    await app.inject({ method: 'POST', url: `/api/cards/product/${ids[1]}/place`, payload: { toColumnSlug: 'done', beforeId: ids[0] } });

    expect((await column(app, 'done')).map((c) => c.title)).toEqual(['b', 'a']);
    expect((await column(app, 'todo')).map((c) => c.title)).toEqual(['c']);
  });

  it('404s for an unknown card', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST', url: '/api/cards/product/P-999/place',
      payload: { toColumnSlug: 'todo', beforeId: null },
    });
    expect(res.statusCode).toBe(404);
  });
});
