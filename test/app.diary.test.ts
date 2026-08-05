import { describe, expect, it, onTestFinished } from 'vitest';
import type { DiaryEntry } from '../src/core/diary.js';
import { readDiary } from '../src/server/diary-store.js';
import { openTestProject, tempDir } from './helpers.js';

// The diary over HTTP. Written through an endpoint and never by an agent writing the file: a run already
// reports a one-line summary that auto-pilot appends, so an agent with a pen here would be a second path
// to the same fact. The AppArmor profile denies the file (test/sandbox.test.ts) and this is the other half
// — the endpoint that exists instead, and who may reach it.

const post = (app: Awaited<ReturnType<typeof openTestProject>>['app'], payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/log', payload });

async function entries(app: Awaited<ReturnType<typeof openTestProject>>['app']) {
  const res = await app.inject({ method: 'GET', url: '/api/log' });
  expect(res.statusCode).toBe(200);
  return (res.json() as { entries: DiaryEntry[] }).entries;
}

describe('the diary endpoint', () => {
  it('answers with nothing for a project that has no diary yet', async () => {
    const { app } = await openTestProject();
    // A scaffolded project has its first entry, so this is about the shape rather than emptiness.
    expect(Array.isArray(await entries(app))).toBe(true);
  });

  it('appends an entry and answers with it', async () => {
    const { app, root } = await openTestProject();
    const before = (await entries(app)).length;
    const res = await post(app, { kind: 'lifecycle', text: 'Auto-pilot stopped: capped.' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { entry: DiaryEntry }).entry.text).toBe('Auto-pilot stopped: capped.');

    const after = await entries(app);
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)?.text).toBe('Auto-pilot stopped: capped.');
    // On disk, not just in the response — the endpoint is the only way in, so a 200 that wrote nothing
    // would lose the event with nothing to notice.
    expect((await readDiary(root)).at(-1)?.text).toBe('Auto-pilot stopped: capped.');
  });

  it('keeps the fields a run entry carries', async () => {
    const { app } = await openTestProject();
    await post(app, {
      kind: 'run',
      text: 'Added the token store.',
      iteration: 3,
      card: 'E-001',
      board: 'engineering',
      skill: 'implement',
      outcome: 'success',
    });
    expect((await entries(app)).at(-1)).toMatchObject({
      kind: 'run',
      iteration: 3,
      card: 'E-001',
      board: 'engineering',
      skill: 'implement',
      outcome: 'success',
    });
  });

  // The server's clock, never the payload's. A caller choosing its own timestamps could write an event
  // into the past and change what the sequence says happened — and the sequence is the whole point.
  it('stamps the entry itself, ignoring any time the caller sent', async () => {
    const { app } = await openTestProject();
    const res = await post(app, { kind: 'lifecycle', text: 'now', at: '1999-01-01T00:00:00.000Z' });
    expect((res.json() as { entry: DiaryEntry }).entry.at).not.toContain('1999');
  });

  it('refuses an entry with no text', async () => {
    const { app } = await openTestProject();
    for (const text of ['', '   ', undefined]) {
      const res = await post(app, { kind: 'lifecycle', ...(text === undefined ? {} : { text }) });
      expect(res.statusCode, JSON.stringify(text)).toBe(400);
    }
  });

  it('refuses a kind it does not know, naming the three', async () => {
    const { app } = await openTestProject();
    const res = await post(app, { kind: 'gossip', text: 'hello' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('run');
    expect(res.json().error).toContain('checkup');
    expect(res.json().error).toContain('lifecycle');
  });

  // This endpoint is reachable by a run credential, so a payload that is not the shape it claims must
  // answer 400 rather than throwing a TypeError into a 500. Same finding as `POST /suggestions`.
  it('refuses a text that is not a string', async () => {
    const { app } = await openTestProject();
    for (const text of [123, null, { a: 1 }, ['x']]) {
      const res = await post(app, { kind: 'lifecycle', text });
      expect(res.statusCode, JSON.stringify(text)).toBe(400);
    }
  });

  it('ignores a field that is not the shape it should be, rather than writing rubbish', async () => {
    const { app } = await openTestProject();
    await post(app, { kind: 'run', text: 'ok', iteration: 'three', board: 'nowhere', card: 42 });
    const last = (await entries(app)).at(-1);
    expect(last?.text).toBe('ok');
    expect(last).not.toHaveProperty('iteration');
    expect(last).not.toHaveProperty('board');
    expect(last).not.toHaveProperty('card');
  });

  // Append-only is enforced by there being nothing else: no route edits an entry, and none removes one.
  it('offers no way to change or remove what is written', async () => {
    const { app } = await openTestProject();
    for (const method of ['DELETE', 'PUT', 'PATCH'] as const) {
      expect((await app.inject({ method, url: '/api/log' })).statusCode, method).toBe(404);
    }
  });
});

describe('who may write the diary', () => {
  // A real app with no auth-injecting wrapper: every request presents exactly the credential it is given.
  async function openBare() {
    const { buildApp } = await import('../src/server/app.js');
    const { CredentialStore } = await import('../src/server/credentials.js');
    const { ProjectSession } = await import('../src/server/session.js');
    const session = new ProjectSession();
    const store = new CredentialStore('admin-token');
    const app = buildApp(session, { credentials: store, logger: false });
    const root = await tempDir();
    onTestFinished(async () => {
      await app.close();
      await session.close();
    });
    await app.inject({
      method: 'POST',
      url: '/api/project/scaffold',
      headers: { authorization: 'Bearer admin-token' },
      payload: { path: root, name: 'A', mode: 'greenfield' },
    });
    return { app, store, root };
  }

  const as = (app: Awaited<ReturnType<typeof openBare>>['app'], token: string, method: 'GET' | 'POST') =>
    app.inject({
      method,
      url: '/api/log',
      headers: { authorization: `Bearer ${token}` },
      ...(method === 'POST' ? { payload: { kind: 'lifecycle', text: 'x' } } : {}),
    });

  // The service is the writer: it appends a run's summary after every dispatch (loop step 12), and it is
  // a separate process reaching the board over HTTP like anything else.
  it('is open to the auto-pilot service', async () => {
    const { app, store, root } = await openBare();
    const cred = store.mintRun('service', 'r1', root);
    expect((await as(app, cred.token, 'POST')).statusCode).toBe(200);
  });

  // Absent from the scope table for both working scopes. An agent writing the diary directly would be a
  // second path to a fact auto-pilot already records from the run.
  it('is closed to a work agent and to the checkup', async () => {
    const { app, store, root } = await openBare();
    for (const scope of ['work', 'checkup'] as const) {
      const cred = store.mintRun(scope, `r-${scope}`, root, 'E-001');
      expect((await as(app, cred.token, 'POST')).statusCode, scope).toBe(403);
    }
  });

  // Reading is in no scope at all — admin-only by absence, like triaging a suggestion.
  it('is closed to every run scope for reading', async () => {
    const { app, store, root } = await openBare();
    for (const scope of ['work', 'checkup', 'service'] as const) {
      const cred = store.mintRun(scope, `r-${scope}`, root, 'E-001');
      expect((await as(app, cred.token, 'GET')).statusCode, scope).toBe(403);
    }
  });
});
