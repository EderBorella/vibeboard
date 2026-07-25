import { describe, it, expect, afterEach } from 'vitest';
import { tempDir } from './helpers.js';
import { ProjectSession } from '../src/server/session.js';
import { buildApp } from '../src/server/app.js';
import type { FastifyInstance } from 'fastify';

let session: ProjectSession | undefined;

async function openProject(): Promise<{ app: FastifyInstance; root: string }> {
  session = new ProjectSession();
  const app = buildApp(session);
  const root = await tempDir();
  await app.inject({
    method: 'POST',
    url: '/api/project/scaffold',
    payload: { path: root, name: 'Mut', mode: 'greenfield' },
  });
  return { app, root };
}

afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe('app mutation routes', () => {
  it('creates, patches, places, and archives a card through HTTP', async () => {
    const { app } = await openProject();

    const created = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'engineering', columnSlug: 'todo', title: 'Via API' },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    expect(id).toBe('E-002'); // E-001 is the sample card

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/cards/engineering/${id}`,
      payload: { title: 'Renamed via API' },
    });
    expect(patched.json().title).toBe('Renamed via API');

    // `place` with beforeId: null is "move to the end of that column" — the same job the
    // old /move route did, plus the order renumbering the board actually needs.
    const moved = await app.inject({
      method: 'POST',
      url: `/api/cards/engineering/${id}/place`,
      payload: { toColumnSlug: 'in-progress', beforeId: null },
    });
    expect(moved.json().columnSlug).toBe('in-progress');

    await app.inject({ method: 'POST', url: `/api/cards/engineering/${id}/archive` });
    const state = await app.inject({ method: 'GET', url: '/api/state' });
    expect(state.json().snapshot.boards.engineering.find((c: { id: string }) => c.id === id))
      .toBeUndefined();

    await app.close();
  });

  it('returns 404 for a missing card', async () => {
    const { app } = await openProject();
    const res = await app.inject({ method: 'PATCH', url: '/api/cards/product/P-999', payload: { title: 'x' } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 409 when mutating with no project open', async () => {
    session = new ProjectSession();
    const app = buildApp(session);
    const res = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'product', columnSlug: 'todo', title: 'x' },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});
