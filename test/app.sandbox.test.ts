import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { CredentialStore } from '../src/server/auth/credentials.js';
import { ProjectSession } from '../src/server/boards/session.js';
import { fixedSandbox, NOT_REQUESTED, type SandboxStatus } from '../src/server/boxes/sandbox.js';
import { TEST_SANDBOX, tempDir } from './helpers.js';

const TEST_IMAGE = 'vibeboard-agent:test';
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
  const app = buildApp(session, { credentials: store, logger: false, sandbox: fixedSandbox(sandbox) });
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
  it('reports the image doing the confining, and no reason to explain', async () => {
    const { app } = await open({ ok: true, image: TEST_IMAGE });
    const body = (await app.inject({ method: 'GET', url: '/api/sandbox', headers: admin })).json();
    expect(body).toMatchObject({ ok: true, profile: TEST_IMAGE, backend: 'managed' });
    expect(body.reason).toBeUndefined();
    // Nothing to refuse: sandboxed, and managing its own server.
    expect(body.agentRefusal).toBeNull();
    expect(body.refusalKind).toBeNull();
  });

  it('carries the reason and the refusal when there is no sandbox', async () => {
    const { app } = await open({
      ok: false,
      reason: 'the agent image is not built — run `npm run box:build`',
      kind: 'docker',
    });
    const body = (await app.inject({ method: 'GET', url: '/api/sandbox', headers: admin })).json();
    expect(body.ok).toBe(false);
    expect(body.reason).toContain('box:build');
    // The refusal repeats the reason rather than saying a bare no. This is the string the UI shows,
    // and a dead end here is worse than the condition it describes.
    expect(body.agentRefusal).toContain('box:build');
    expect(body.refusalKind).toBe('docker');
  });

  // WHICH cause, reported alongside the sentence, so the UI titles the balloon without reading the
  // sentence for keywords. Docker being fine while the box holds a credential the host has replaced is
  // the case that made "Docker is not ready" a lie.
  it('reports a stale credential as its own kind, with the credential sentence', async () => {
    const { app } = await open({
      ok: false,
      reason: 'the agent box is holding a sign-in that has been replaced on this machine',
      kind: 'credential',
    });
    const body = (await app.inject({ method: 'GET', url: '/api/sandbox', headers: admin })).json();
    expect(body.refusalKind).toBe('credential');
    expect(body.agentRefusal).toContain('replaced');
  });

  it('refuses auto-pilot while attached to an external server, sandbox or not', async () => {
    process.env.VIBEBOARD_OPENCODE_URL = 'http://127.0.0.1:9999';
    const { app } = await open({ ok: true, image: TEST_IMAGE });
    const body = (await app.inject({ method: 'GET', url: '/api/sandbox', headers: admin })).json();
    expect(body).toMatchObject({ ok: true, backend: 'attached', attachedUrl: 'http://127.0.0.1:9999' });
    expect(body.agentRefusal).toContain('VIBEBOARD_OPENCODE_URL');
    // The attached case OUTRANKS the status, exactly as the refusal does: the sandbox is ok here and
    // the kind is still not null, because something is still refusing.
    expect(body.refusalKind).toBe('attached');
  });

  // THE RELATIONSHIP, ASSERTED RATHER THAN TRUSTED. `agentRefusal` and `refusalKind` are computed by
  // two different expressions from the same two facts, and nothing but a test stops them drifting into
  // a state where the UI has a cause with no sentence, or a sentence it cannot title.
  it('has a kind exactly when it has a refusal, over every combination of the two facts', async () => {
    const statuses: SandboxStatus[] = [
      { ok: true, image: TEST_IMAGE },
      { ok: false, reason: 'the agent image is not built', kind: 'docker' },
      { ok: false, reason: 'the box is holding a replaced sign-in', kind: 'credential' },
    ];
    for (const attached of [undefined, 'http://127.0.0.1:9999']) {
      for (const status of statuses) {
        if (attached) process.env.VIBEBOARD_OPENCODE_URL = attached;
        else delete process.env.VIBEBOARD_OPENCODE_URL;
        const { app } = await open(status);
        const body = (await app.inject({ method: 'GET', url: '/api/sandbox', headers: admin })).json();
        expect(body.refusalKind === null, `${attached} ${status.ok}`).toBe(body.agentRefusal === null);
      }
    }
  });
});

describe('one path: no agent runs without a sandbox', () => {
  it('refuses to dispatch a run, and says which condition failed', async () => {
    const { app } = await open({
      ok: false,
      reason: 'the agent image is not built — run `npm run box:build`',
      kind: 'docker',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: admin,
      payload: { board: 'engineering', card: 'E-001', skill: 'execute' },
    });
    // 412, not 403: the request is fine, the machine is not in a state to serve it.
    expect(res.statusCode).toBe(412);
    expect(res.json().error).toContain('box:build');
  });

  it('refuses BEFORE resolving the request, so a bad payload still reports the sandbox', async () => {
    // Otherwise the first thing a user with no sandbox sees is "unknown skill", and they go and
    // fix the wrong thing.
    const { app } = await open({ ok: false, reason: 'profile not loaded', kind: 'docker' });
    const res = await app.inject({ method: 'POST', url: '/api/runs', headers: admin, payload: {} });
    expect(res.statusCode).toBe(412);
  });

  it('still serves the board, so the app is usable while it says what to run', async () => {
    const { app } = await open({ ok: false, reason: 'profile not loaded', kind: 'docker' });
    expect((await app.inject({ method: 'GET', url: '/api/state', headers: admin })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/config', headers: admin })).statusCode).toBe(200);
  });

  it('dispatches once there is one', async () => {
    // The other half. A gate that refuses everything is not a gate, it is an outage.
    const { app } = await open(TEST_SANDBOX);
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: admin,
      payload: { board: 'engineering', card: 'nope-not-a-card', skill: 'execute' },
    });
    // 400 for the unknown card — it got PAST the sandbox gate, which is what this asserts.
    expect(res.statusCode).not.toBe(412);
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
