import type { FastifyInstance } from 'fastify';
import { describe, expect, it, onTestFinished } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { CredentialStore } from '../src/server/credentials.js';
import { ProjectSession } from '../src/server/session.js';
import { tempDir } from './helpers.js';

const ADMIN = 'admin-token';
const admin = { authorization: `Bearer ${ADMIN}` };
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

// A real app with no auth-injecting wrapper: every request here presents exactly the credential
// the test gives it, which is the whole point of this file.
async function open(): Promise<{ app: FastifyInstance; store: CredentialStore }> {
  const session = new ProjectSession();
  const store = new CredentialStore(ADMIN);
  const app = buildApp(session, { credentials: store, logger: false });
  const root = await tempDir();
  onTestFinished(async () => {
    await app.close();
    await session.close();
  });
  await app.inject({
    method: 'POST',
    url: '/api/project/scaffold',
    headers: admin,
    payload: { path: root, name: 'A', mode: 'greenfield' },
  });
  return { app, store };
}

describe('the API boundary', () => {
  it('refuses a request with no credential', async () => {
    const { app } = await open();
    const res = await app.inject({ method: 'POST', url: '/api/cards', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a token it never minted', async () => {
    const { app } = await open();
    const res = await app.inject({ method: 'GET', url: '/api/state', headers: bearer('guessed') });
    expect(res.statusCode).toBe(401);
  });

  it('refuses an expired run credential everywhere', async () => {
    const { app, store } = await open();
    const cred = store.mintRun('work', 'run-1', 'E-001');
    store.expireRun('run-1');
    const res = await app.inject({ method: 'GET', url: '/api/state', headers: bearer(cred.token) });
    expect(res.statusCode).toBe(401);
  });

  it('lets the browser through to anything', async () => {
    const { app } = await open();
    expect((await app.inject({ method: 'GET', url: '/api/state', headers: admin })).statusCode).toBe(200);
  });

  it('lets a run read the board', async () => {
    const { app, store } = await open();
    const cred = store.mintRun('work', 'run-1', 'E-001');
    const res = await app.inject({ method: 'GET', url: '/api/state', headers: bearer(cred.token) });
    expect(res.statusCode).toBe(200);
  });

  // The most dangerous endpoint in the app: a run that can dispatch runs escapes the loop's
  // iteration counter, its budget and its concurrency cap in one move.
  it('refuses a work credential on POST /api/runs', async () => {
    const { app, store } = await open();
    const cred = store.mintRun('work', 'run-1', 'E-001');
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: bearer(cred.token),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a run credential on PUT /raw, whatever its scope', async () => {
    const { app, store } = await open();
    // Raw bytes bypass every validation in the mutation layer — id, column and frontmatter all.
    for (const scope of ['work', 'checkup', 'service'] as const) {
      const cred = store.mintRun(scope, `run-${scope}`, 'E-001');
      const res = await app.inject({
        method: 'PUT',
        url: '/api/cards/engineering/E-001/raw',
        headers: bearer(cred.token),
        payload: { raw: '---\nid: E-001\n---\n' },
      });
      expect(res.statusCode, scope).toBe(403);
    }
  });

  it('refuses a run credential on PATCH /api/config', async () => {
    // Config holds the columns, the caps and the routing table. An agent that can edit it can
    // rewrite the rules it is judged by.
    const { app, store } = await open();
    const cred = store.mintRun('service', 'run-1');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      headers: bearer(cred.token),
      payload: { name: 'renamed' },
    });
    expect(res.statusCode).toBe(403);
  });

  // Every route not named in the scope table is admin-only, so a new endpoint is closed until
  // somebody opens it deliberately. Explorer writes are the widest reach in the app: any path
  // in the project, card or not.
  it('refuses a run credential on an endpoint the table never mentions', async () => {
    const { app, store } = await open();
    const cred = store.mintRun('checkup', 'run-1');
    const res = await app.inject({
      method: 'PUT',
      url: '/api/explorer/file',
      headers: bearer(cred.token),
      payload: { path: 'notes.md', content: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  describe('a work credential is confined to its own card', () => {
    it('may edit the card it was minted for', async () => {
      const { app, store } = await open();
      const cred = store.mintRun('work', 'run-1', 'E-001');
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/cards/engineering/E-001',
        headers: bearer(cred.token),
        payload: { title: 'Renamed by its own run' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('may not edit another', async () => {
      const { app, store } = await open();
      const cred = store.mintRun('work', 'run-1', 'E-001');
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/cards/engineering/E-002',
        headers: bearer(cred.token),
        payload: { title: 'Reaching past its own card' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('is not confined when the scope is checkup', async () => {
      // The checkup is a supervisor, not a worker: editing any card is the job.
      const { app, store } = await open();
      const cred = store.mintRun('checkup', 'run-1');
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/cards/engineering/E-001',
        headers: bearer(cred.token),
        payload: { title: 'Renamed by the checkup' },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // The five verbs an agent can reach, as a matrix. A row nobody exercises is a row that does not
  // work, and the interesting part is the gap between the two scopes: a work agent must not be able
  // to move its own card into done and declare itself finished.
  describe('the five card verbs', () => {
    const verbs = (id: string) =>
      ({
        create: {
          method: 'POST' as const,
          url: '/api/cards',
          payload: { board: 'engineering', columnSlug: 'backlog', title: 'x' },
        },
        edit: { method: 'PATCH' as const, url: `/api/cards/engineering/${id}`, payload: { title: 'x' } },
        link: { method: 'PUT' as const, url: `/api/cards/engineering/${id}/links`, payload: { links: [] } },
        move: {
          method: 'POST' as const,
          url: `/api/cards/engineering/${id}/move`,
          payload: { toColumnSlug: 'in-progress' },
        },
        archive: { method: 'POST' as const, url: `/api/cards/engineering/${id}/archive`, payload: {} },
      }) satisfies Record<string, { method: 'POST' | 'PATCH' | 'PUT'; url: string; payload: object }>;

    it('lets a work credential create, edit its own card and link — and nothing else', async () => {
      const { app, store } = await open();
      const cred = store.mintRun('work', 'run-1', 'E-001');
      const v = verbs('E-001');
      for (const name of ['create', 'edit', 'link'] as const) {
        const res = await app.inject({ ...v[name], headers: bearer(cred.token) });
        expect(res.statusCode, name).toBe(200);
      }
      for (const name of ['move', 'archive'] as const) {
        const res = await app.inject({ ...v[name], headers: bearer(cred.token) });
        expect(res.statusCode, name).toBe(403);
      }
    });

    it('lets a checkup credential do all five', async () => {
      const { app, store } = await open();
      const cred = store.mintRun('checkup', 'run-1');
      const v = verbs('E-001');
      for (const name of ['create', 'edit', 'link', 'move', 'archive'] as const) {
        const res = await app.inject({ ...v[name], headers: bearer(cred.token) });
        expect(res.statusCode, name).toBe(200);
      }
    });

    it('refuses a run of any scope on /place, which is the drag-and-drop verb', async () => {
      // Position is a person's judgement about a board they are looking at. An agent moves a card
      // to a column; where in that column is not a question it has any basis to answer.
      const { app, store } = await open();
      for (const scope of ['work', 'checkup', 'service'] as const) {
        const cred = store.mintRun(scope, `run-${scope}`, 'E-001');
        const res = await app.inject({
          method: 'POST',
          url: '/api/cards/engineering/E-001/place',
          headers: bearer(cred.token),
          payload: { toColumnSlug: 'in-progress', beforeId: null },
        });
        expect(res.statusCode, scope).toBe(403);
      }
    });

    it('appends a moved card to the end of its new column', async () => {
      const { app, store } = await open();
      const cred = store.mintRun('checkup', 'run-1');
      const res = await app.inject({
        method: 'POST',
        url: '/api/cards/engineering/E-001/move',
        headers: bearer(cred.token),
        payload: { toColumnSlug: 'in-progress' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().columnSlug).toBe('in-progress');
    });

    it('refuses a move to a column the board does not have', async () => {
      const { app, store } = await open();
      const cred = store.mintRun('checkup', 'run-1');
      const res = await app.inject({
        method: 'POST',
        url: '/api/cards/engineering/E-001/move',
        headers: bearer(cred.token),
        payload: { toColumnSlug: 'not-a-column' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // The socket carries the copilot channel, and the copilot writes files with tools that
  // auto-approve. Locking /api while leaving this open would secure nothing.
  it('refuses a websocket that presents no credential', async () => {
    const { app } = await open();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { default: WebSocket } = await import('ws');
    const address = app.addresses()[0];
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    // The handshake is refused, so the client sees an error and never an open socket. Waited on
    // with real time and a generous margin — there is a real TCP connection behind this, and a
    // faked clock would observe neither end of it.
    const outcome = await new Promise<string>((resolve) => {
      ws.on('open', () => resolve('opened'));
      ws.on('error', () => resolve('refused'));
      setTimeout(() => resolve('nothing happened'), 2000);
    });
    ws.close();
    expect(outcome).toBe('refused');
  });

  it('accepts a websocket presenting the admin token', async () => {
    const { app } = await open();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { default: WebSocket } = await import('ws');
    const address = app.addresses()[0];
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws?token=${ADMIN}`);
    const opened = await new Promise<boolean>((resolve) => {
      ws.on('open', () => resolve(true));
      ws.on('close', () => resolve(false));
      ws.on('error', () => resolve(false));
    });
    ws.close();
    expect(opened).toBe(true);
  });
});
