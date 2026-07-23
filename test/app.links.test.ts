import { describe, it, expect, afterEach } from 'vitest';
import { tempDir } from './helpers.js';
import { ProjectSession } from '../src/server/session.js';
import { buildApp } from '../src/server/app.js';
import type { FastifyInstance } from 'fastify';

let session: ProjectSession | undefined;

async function open(): Promise<FastifyInstance> {
  session = new ProjectSession();
  const app = buildApp(session);
  const root = await tempDir();
  await app.inject({ method: 'POST', url: '/api/project/scaffold', payload: { path: root, name: 'L', mode: 'greenfield' } });
  return app;
}

afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe('PUT /cards/:board/:id/links', () => {
  it('links a product card to the sample engineering card on both sides', async () => {
    const app = await open();
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
    const app = await open();
    const res = await app.inject({ method: 'PUT', url: '/api/cards/product/P-999/links', payload: { links: [] } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
