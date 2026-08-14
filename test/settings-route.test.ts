import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { CredentialStore } from '../src/server/auth/credentials.js';
import { ProjectSession } from '../src/server/boards/session.js';
import type { AppSettings } from '../src/server/settings/routes.js';
import { tempDir } from './helpers.js';

// VibeBoard's OWN settings, as opposed to a project's. Through `buildApp` directly rather than the test
// helper, because two of the three things worth asserting here are about the credential presented — and the
// helper injects an admin header onto every request.

const ADMIN = 'admin-token-for-settings';
const admin = { authorization: `Bearer ${ADMIN}` };
const original = process.env.VIBEBOARD_STATE_FILE;

beforeEach(async () => {
  // Its own state file per test: the setting lives there, and the real one is in the user's home.
  process.env.VIBEBOARD_STATE_FILE = join(await tempDir(), 'state.json');
});

afterEach(() => {
  process.env.VIBEBOARD_STATE_FILE = original;
});

async function open(): Promise<{ app: ReturnType<typeof buildApp>; store: CredentialStore }> {
  const session = new ProjectSession();
  const store = new CredentialStore(ADMIN);
  const app = buildApp(session, { credentials: store, logger: false });
  onTestFinished(async () => {
    await app.close();
    await session.close();
  });
  return { app, store };
}

const settings = async (app: ReturnType<typeof buildApp>): Promise<AppSettings> => {
  const res = await app.inject({ method: 'GET', url: '/api/settings', headers: admin });
  expect(res.statusCode).toBe(200);
  return res.json() as AppSettings;
};

describe('GET /api/settings', () => {
  // NO PROJECT OPEN, and that is the reason this is not part of `PATCH /api/config`: the server starts with
  // none, and the moment you most want to turn debug logging on is when you cannot get a project going.
  it('answers with no project open', async () => {
    const { app } = await open();
    expect((await settings(app)).debugLog).toBe(false);
  });

  it('names the file to look in, because "check the log" is useless without the path', async () => {
    // The suite runs with VIBEBOARD_LOG_DIR empty, so this install writes none — reported as null rather
    // than as a path that will never exist.
    const { app } = await open();
    const s = await settings(app);
    expect(s.autopilotLog).toBeNull();
    expect(s.serverLog).toBeNull();
  });
});

describe('PATCH /api/settings', () => {
  it('saves the switch and reports it back', async () => {
    const { app } = await open();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: admin,
      payload: { debugLog: true },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as AppSettings).debugLog).toBe(true);
    // FROM DISK: the reply could be assembled and nothing written, and the next start of the loop reads the
    // file rather than this response.
    const raw = JSON.parse(await readFile(process.env.VIBEBOARD_STATE_FILE as string, 'utf8'));
    expect(raw.debugLog).toBe(true);
    expect((await settings(app)).debugLog).toBe(true);
  });

  it('does not disturb the project the app would reopen', async () => {
    // One file holds both. A wholesale overwrite here would forget which project was open, which the user
    // would meet as being dropped at the project gate after touching a debug switch.
    await writeFile(process.env.VIBEBOARD_STATE_FILE as string, '{"lastProject":"/p"}', 'utf8');
    const { app } = await open();
    await app.inject({ method: 'PATCH', url: '/api/settings', headers: admin, payload: { debugLog: true } });
    const raw = JSON.parse(await readFile(process.env.VIBEBOARD_STATE_FILE as string, 'utf8'));
    expect(raw).toEqual({ lastProject: '/p', debugLog: true });
  });

  it.each([[{}], [{ debugLog: 'true' }], [{ debugLog: 1 }], [{ debugLog: null }]])(
    'refuses %o rather than coercing it',
    async (payload) => {
      // `Boolean('false')` is `true`. A switch that turns itself on when a client sends the wrong shape is a
      // switch nobody can trust, so the shape is refused and the stored value left alone.
      const { app } = await open();
      const res = await app.inject({ method: 'PATCH', url: '/api/settings', headers: admin, payload });
      expect(res.statusCode).toBe(400);
      expect((await settings(app)).debugLog).toBe(false);
    },
  );

  // ADMIN ONLY, by absence from the scope table — the default that makes every other route's silence mean
  // something. An agent that could write this could turn the record of what it did up or down.
  //
  // A PROJECT IS OPENED FIRST, and the credentials are minted against it. Without that this test passed for
  // the wrong reason: `allows` compares the credential's project against the OPEN one, so with none open
  // every run credential is refused whatever the scope table says — and adding both routes to the table as
  // `READ_SCOPES` changed nothing here. Planted, confirmed, fixed.
  it('is reachable by nobody who runs', async () => {
    const { app, store } = await open();
    const root = await tempDir();
    const scaffolded = await app.inject({
      method: 'POST',
      url: '/api/project/scaffold',
      headers: admin,
      payload: { path: root, name: 'S', mode: 'brownfield' },
    });
    expect(scaffolded.statusCode).toBe(200);

    for (const scope of ['work', 'checkup', 'service', 'assist'] as const) {
      const cred = store.mintRun(scope, `run-${scope}`, root);
      const headers = { authorization: `Bearer ${cred.token}` };
      const read = await app.inject({ method: 'GET', url: '/api/settings', headers });
      expect(read.statusCode, scope).toBe(403);
      const write = await app.inject({
        method: 'PATCH',
        url: '/api/settings',
        headers,
        payload: { debugLog: true },
      });
      expect(write.statusCode, scope).toBe(403);
    }
    expect((await settings(app)).debugLog).toBe(false);
  });
});
