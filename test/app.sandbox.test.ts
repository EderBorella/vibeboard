import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { CredentialStore } from '../src/server/credentials.js';
import { NOT_REQUESTED, SANDBOX_PROFILE, type SandboxStatus } from '../src/server/sandbox.js';
import { ProjectSession } from '../src/server/session.js';
import { tempDir } from './helpers.js';

const ADMIN = 'admin-token-for-sandbox-routes';
const admin = { authorization: `Bearer ${ADMIN}` };
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

afterEach(() => {
  delete process.env.VIBEBOARD_OPENCODE_URL;
});

async function open(
  sandbox: SandboxStatus,
): Promise<{ app: FastifyInstance; store: CredentialStore; root: string }> {
  const session = new ProjectSession();
  const store = new CredentialStore(ADMIN);
  // buildApp directly, not testApp: testApp fills the admin header in on every request, which is
  // exactly what the 403 assertions here must not have.
  const app = buildApp(session, { credentials: store, logger: false, sandbox });
  const root = await tempDir();
  onTestFinished(async () => {
    await app.close();
    await session.close();
  });
  await app.inject({
    method: 'POST',
    url: '/api/project/scaffold',
    headers: admin,
    payload: { path: root, name: 'A', mode: 'brownfield' },
  });
  return { app, store, root };
}

describe('GET /api/sandbox', () => {
  it('reports an enforced profile, and no reason to explain', async () => {
    const { app } = await open({ ok: true, profile: SANDBOX_PROFILE });
    const body = (await app.inject({ method: 'GET', url: '/api/sandbox', headers: admin })).json();
    expect(body).toMatchObject({ ok: true, profile: SANDBOX_PROFILE, backend: 'managed' });
    expect(body.reason).toBeUndefined();
    // Nothing to refuse: sandboxed, and managing its own server.
    expect(body.autopilotRefusal).toBeNull();
  });

  it('carries the reason and the refusal when there is no sandbox', async () => {
    const { app } = await open({ ok: false, reason: 'profile not loaded — run `npm run sandbox:install`' });
    const body = (await app.inject({ method: 'GET', url: '/api/sandbox', headers: admin })).json();
    expect(body.ok).toBe(false);
    expect(body.reason).toContain('sandbox:install');
    // The refusal repeats the reason rather than saying a bare no. This is the string the UI shows,
    // and a dead end here is worse than the condition it describes.
    expect(body.autopilotRefusal).toContain('sandbox:install');
  });

  it('refuses auto-pilot while attached to an external server, sandbox or not', async () => {
    process.env.VIBEBOARD_OPENCODE_URL = 'http://127.0.0.1:9999';
    const { app } = await open({ ok: true, profile: SANDBOX_PROFILE });
    const body = (await app.inject({ method: 'GET', url: '/api/sandbox', headers: admin })).json();
    expect(body).toMatchObject({ ok: true, backend: 'attached', attachedUrl: 'http://127.0.0.1:9999' });
    expect(body.autopilotRefusal).toContain('VIBEBOARD_OPENCODE_URL');
  });
});

describe('the three routes are admin-only', () => {
  // By absence from the scope table, which is the point: nobody had to remember to deny these.
  it.each([
    ['GET', '/api/sandbox'],
    ['POST', '/api/opencode/restart'],
    ['POST', '/api/opencode/takeover'],
  ])('refuses a %s to %s from a run credential', async (method, url) => {
    const { app, store, root } = await open(NOT_REQUESTED);
    // `service` is the widest scope a run ever gets — wider than the checkup's, and still not this.
    const cred = store.mintRun('service', 'run-1', root);
    const res = await app.inject({ method: method as 'GET' | 'POST', url, headers: bearer(cred.token) });
    expect(res.statusCode).toBe(403);
  });

  it('refuses them with no credential at all', async () => {
    const { app } = await open(NOT_REQUESTED);
    expect((await app.inject({ method: 'GET', url: '/api/sandbox' })).statusCode).toBe(401);
  });
});
