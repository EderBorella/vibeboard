import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { ProjectSession } from '../src/server/session.js';
import { tempDir } from './helpers.js';

let session: ProjectSession | undefined;

afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe('app read/project routes', () => {
  it('GET /api/state reports closed before any project is opened', async () => {
    session = new ProjectSession();
    const app = buildApp(session);
    const res = await app.inject({ method: 'GET', url: '/api/state' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ open: false });
    await app.close();
  });

  it('POST /api/project/scaffold scaffolds, opens, and exposes the snapshot', async () => {
    session = new ProjectSession();
    const app = buildApp(session);
    const root = await tempDir();

    const scaffold = await app.inject({
      method: 'POST',
      url: '/api/project/scaffold',
      payload: { path: root, name: 'Injected', mode: 'greenfield' },
    });
    expect(scaffold.statusCode).toBe(200);
    expect(scaffold.json().snapshot.name).toBe('Injected');

    const state = await app.inject({ method: 'GET', url: '/api/state' });
    expect(state.json().open).toBe(true);
    expect(state.json().snapshot.boards.product.length).toBeGreaterThan(0);
    await app.close();
  });

  it('POST /api/project/open on a non-project dir returns 400', async () => {
    session = new ProjectSession();
    const app = buildApp(session);
    const root = await tempDir();
    const res = await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: root } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
