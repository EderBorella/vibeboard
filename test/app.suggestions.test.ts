import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it, onTestFinished } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { allows } from '../src/server/auth/auth.js';
import type { Credential } from '../src/server/auth/credentials.js';
import { CredentialStore } from '../src/server/auth/credentials.js';
import { ProjectSession } from '../src/server/boards/session.js';
import { listSuggestions } from '../src/store/suggestion-store.js';
import { tempDir } from './helpers.js';

const ADMIN = 'admin-token-for-suggestions';
const admin = { authorization: `Bearer ${ADMIN}` };
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

async function open(): Promise<{ app: FastifyInstance; store: CredentialStore; root: string }> {
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
    payload: { path: root, name: 'S', mode: 'brownfield' },
  });
  return { app, store, root };
}

const cred = (scope: 'work' | 'checkup' | 'service', card?: string): Credential =>
  ({ scope, project: 'p', run: 'r', card, token: 't' }) as Credential;

describe('the scope table', () => {
  it('lets a work agent file a suggestion and not read the list', () => {
    expect(allows(cred('work', 'E-001'), 'POST', '/api/suggestions', 'p')).toBe(true);
    // Reading every open problem is how a run scoped to one card talks itself into five.
    expect(allows(cred('work', 'E-001'), 'GET', '/api/suggestions', 'p')).toBe(false);
  });

  it('lets the service read them and file none', () => {
    expect(allows(cred('service'), 'GET', '/api/suggestions', 'p')).toBe(true);
    expect(allows(cred('service'), 'POST', '/api/suggestions', 'p')).toBe(false);
  });

  it('lets the checkup do both', () => {
    expect(allows(cred('checkup'), 'POST', '/api/suggestions', 'p')).toBe(true);
    expect(allows(cred('checkup'), 'GET', '/api/suggestions', 'p')).toBe(true);
  });

  it('keeps triage away from every agent scope', () => {
    for (const scope of ['work', 'checkup', 'service'] as const) {
      expect(allows(cred(scope, 'E-001'), 'PATCH', '/api/suggestions/:id', 'p'), scope).toBe(false);
    }
  });
});

describe('POST /api/suggestions', () => {
  it('stamps the run and card from the credential, not the payload', async () => {
    const { app, store, root } = await open();
    const work = store.mintRun('work', 'run-7', root, 'E-001');
    const res = await app.inject({
      method: 'POST',
      url: '/api/suggestions',
      headers: bearer(work.token),
      // A run claiming somebody else's card is a run rewriting whose problem this is.
      payload: { title: 'Missing index', body: 'linear scan', run: 'someone-else', card: 'E-999' },
    });
    expect(res.statusCode).toBe(200);
    const [saved] = await listSuggestions(root, 'active');
    expect(saved).toMatchObject({ run: 'run-7', card: 'E-001', title: 'Missing index', state: 'active' });
  });

  it('refuses one with no title', async () => {
    const { app, store, root } = await open();
    const work = store.mintRun('work', 'run-7', root, 'E-001');
    const res = await app.inject({
      method: 'POST',
      url: '/api/suggestions',
      headers: bearer(work.token),
      payload: { body: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(await listSuggestions(root)).toEqual([]);
  });

  it('accepts a third, and a fourth — filing is uncapped on purpose', async () => {
    const { app, store, root } = await open();
    const work = store.mintRun('work', 'run-7', root, 'E-001');
    for (const n of [1, 2, 3, 4]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/suggestions',
        headers: bearer(work.token),
        payload: { title: `finding ${n}` },
      });
      expect(res.statusCode, `finding ${n}`).toBe(200);
    }
    // An agent with four findings is telling you its card was scoped wrongly. That is a
    // break-down defect worth seeing, not noise worth suppressing.
    expect(await listSuggestions(root, 'active')).toHaveLength(4);
  });
});

describe('GET /api/suggestions', () => {
  it('filters to the active ones for the service', async () => {
    const { app, store, root } = await open();
    const work = store.mintRun('work', 'run-7', root, 'E-001');
    await app.inject({
      method: 'POST',
      url: '/api/suggestions',
      headers: bearer(work.token),
      payload: { title: 'one' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/suggestions',
      headers: bearer(work.token),
      payload: { title: 'two' },
    });
    // BY TITLE, never by position. Suggestion ids are `<timestamp>-<random 8>` and allSuggestions sorts by
    // filename, so two posts landing in the SAME MILLISECOND are ordered by the random half — measured at
    // 1004/2000, a coin flip. This read used to take `[0]`, dismiss whichever it got, and assert 'two'
    // survived. It passed because the two injects normally straddle a millisecond; under Stryker's 19
    // workers they stop doing so, it dismissed 'two', and `expected ['one'] to deeply equal ['two']`
    // failed the DRY RUN before any mutant existed — which reads exactly like a bug in the code under test.
    //
    // Not a defect in the store: `randomUUID` is there so two same-millisecond posts cannot overwrite each
    // other (see the id comment in server/suggestions/routes.ts), and list order is a promise nothing else
    // relies on. It was this test depending on luck.
    const dismissed = (await listSuggestions(root)).find((s) => s.title === 'one');
    if (!dismissed) throw new Error("the suggestion titled 'one' was not written");
    await app.inject({
      method: 'PATCH',
      url: `/api/suggestions/${dismissed.id}`,
      headers: admin,
      payload: { state: 'dismissed', reason: 'no' },
    });

    const service = store.mintRun('service', 'svc-1', root);
    const res = await app.inject({
      method: 'GET',
      url: '/api/suggestions?state=active',
      headers: bearer(service.token),
    });
    const { suggestions } = res.json() as { suggestions: { title: string }[] };
    expect(suggestions.map((s) => s.title)).toEqual(['two']);
  });
});

describe('hostile input', () => {
  it('refuses a traversing id instead of reading a file outside the folder', async () => {
    const { app, root } = await open();
    await writeFile(join(root, 'victim.md'), '---\nid: victim\ntitle: secret\n---\nbody\n', 'utf8');
    // Fastify decodes %2f, so this reached <root>/victim.md and returned its fields in the body.
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/suggestions/..%2f..%2fvictim',
      headers: admin,
      payload: { state: 'actioned' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('secret');
  });

  it('answers 400, not 500, for a title that is not a string', async () => {
    const { app, store, root } = await open();
    const work = store.mintRun('work', 'run-7', root, 'E-001');
    // Agent-reachable input on a work credential: `body.title?.trim()` threw before the guard.
    const res = await app.inject({
      method: 'POST',
      url: '/api/suggestions',
      headers: bearer(work.token),
      payload: { title: 123, body: { nested: true } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('gives two suggestions filed in the same millisecond different ids', async () => {
    const { app, store, root } = await open();
    const work = store.mintRun('work', 'run-7', root, 'E-001');
    // The old suffix was Math.random().toString(36).slice(2, 6) — 0 to 4 characters, '' for 0 —
    // so a collision silently overwrote a finding, which is the one thing this channel must not do.
    await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) =>
        app.inject({
          method: 'POST',
          url: '/api/suggestions',
          headers: bearer(work.token),
          payload: { title: `f${n}` },
        }),
      ),
    );
    expect(await listSuggestions(root)).toHaveLength(6);
  });

  it('ignores a board supplied by the caller', async () => {
    const { app, store, root } = await open();
    const work = store.mintRun('work', 'run-7', root, 'E-001');
    await app.inject({
      method: 'POST',
      url: '/api/suggestions',
      headers: bearer(work.token),
      payload: { title: 'one', board: 'product' },
    });
    // A Credential carries no board, so anything here came from the caller. Nothing reads it yet,
    // and accepting it would make "identity comes from the credential" false for one field.
    expect((await listSuggestions(root))[0]).not.toHaveProperty('board');
  });
});

describe('PATCH /api/suggestions/:id', () => {
  it('records the reason for a dismissal', async () => {
    const { app, store, root } = await open();
    const work = store.mintRun('work', 'run-7', root, 'E-001');
    await app.inject({
      method: 'POST',
      url: '/api/suggestions',
      headers: bearer(work.token),
      payload: { title: 'one' },
    });
    const [s] = await listSuggestions(root);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/suggestions/${s.id}`,
      headers: admin,
      payload: { state: 'dismissed', reason: 'out of scope' },
    });
    expect(res.statusCode).toBe(200);
    expect((await listSuggestions(root, 'dismissed'))[0].reason).toBe('out of scope');
  });

  it('refuses a state it does not recognise, and 404s an id that is not there', async () => {
    const { app } = await open();
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/suggestions/x',
          headers: admin,
          payload: { state: 'banana' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/suggestions/x',
          headers: admin,
          payload: { state: 'actioned' },
        })
      ).statusCode,
    ).toBe(404);
  });
});
