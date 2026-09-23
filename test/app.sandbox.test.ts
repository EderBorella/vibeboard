import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
import type { RunRecord } from '../src/core/runs.js';
import { buildApp } from '../src/server/app.js';
import { CredentialStore } from '../src/server/auth/credentials.js';
import { ProjectSession } from '../src/server/boards/session.js';
import { fixedSandbox, NOT_REQUESTED, type SandboxStatus } from '../src/server/boxes/sandbox.js';
import { writeRun } from '../src/store/run-store.js';
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
      reason: 'the agent image vibeboard-agent:test is not built yet',
      kind: 'docker',
      buildable: true,
    });
    const body = (await app.inject({ method: 'GET', url: '/api/sandbox', headers: admin })).json();
    expect(body.ok).toBe(false);
    expect(body.reason).toContain('is not built yet');
    // The refusal repeats the reason rather than saying a bare no. This is the string the UI shows,
    // and a dead end here is worse than the condition it describes.
    expect(body.agentRefusal).toContain('is not built yet');
    expect(body.refusalKind).toBe('docker');
    // AND WHETHER THE PRODUCT'S OWN REMEDY APPLIES. Added 2026-09-01 with the build action.
    expect(body.buildable).toBe(true);
  });

  // THE HALF THAT MAKES `buildable` MEAN ANYTHING, and it is asserted at the ROUTE rather than only in
  // the panel: `kind` is `docker` for BOTH a missing daemon and a missing image, so a route that set
  // this whenever the sandbox was not ok would hand the UI a Build button for a daemon that is not
  // running — a remedy that cannot work, offered for a fault it does not address. Measured: with the
  // route widened that way, every panel test still passed, because nothing here was asking.
  it('does NOT say a build would help when docker itself is missing', async () => {
    const { app } = await open({
      ok: false,
      reason: 'Docker is not available — no daemon',
      kind: 'docker',
    });
    const body = (await app.inject({ method: 'GET', url: '/api/sandbox', headers: admin })).json();
    expect(body.refusalKind).toBe('docker');
    expect(body.buildable).toBeUndefined();
  });

  // AN IMAGE BEHIND ITS HOST, and the two fields kept apart on purpose. `buildable` says a build fixes
  // the REFUSAL, and the setup wizard reads it that way — it puts "Build it now — only happens once" next
  // to a check that just said "Connected and ready". So the drift has a field of its own, which only the
  // Settings panel reads, and nothing here refuses because of it.
  it('says why the image is out of date without refusing or calling it buildable', async () => {
    const stale = 'vibeboard-agent:base has Claude Code 2.1.221 where this machine has 2.1.280';
    const { app } = await open({ ok: true, image: TEST_IMAGE, stale });
    const body = (await app.inject({ method: 'GET', url: '/api/sandbox', headers: admin })).json();
    expect(body.imageStale).toBe(stale);
    expect(body.ok).toBe(true);
    expect(body.agentRefusal).toBeNull();
    expect(body.buildable).toBeUndefined();
  });

  it('carries the drift beside a refusal it has nothing to do with', async () => {
    const stale = 'vibeboard-agent:base has Claude Code 2.1.221 where this machine has 2.1.280';
    const { app } = await open({ ok: false, reason: 'the sign-in has expired', kind: 'credential', stale });
    const body = (await app.inject({ method: 'GET', url: '/api/sandbox', headers: admin })).json();
    expect(body.refusalKind).toBe('credential');
    expect(body.imageStale).toBe(stale);
  });

  it('has no drift field at all when the image matches', async () => {
    const { app } = await open({ ok: true, image: TEST_IMAGE });
    const body = (await app.inject({ method: 'GET', url: '/api/sandbox', headers: admin })).json();
    expect('imageStale' in body).toBe(false);
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

// THE MORNING THE LIGHT LIED. Auto-pilot stopped itself with "2 runs in a row failed before reaching a
// model: Failed to authenticate: OAuth session expired", and this endpoint went on answering `ok: true,
// agentRefusal: null, refusalKind: null` — checked against the live server while the box held the dead
// token. Every field it had answers "may an agent start", and the answer to that really was yes; nothing
// here answered "did the last ones die", so the top bar said `online` all morning.
//
// The evidence is the LOOP'S OWN — records stamped `fault: infrastructure`, the same ones `machineBroken`
// read when it stopped — so the light cannot disagree with the loop about what happened.
describe('GET /api/sandbox: what already went wrong', () => {
  const run = (over: Partial<RunRecord> = {}): RunRecord => ({
    run: '20260816-100000-aaaa',
    card: 'E-001',
    board: 'engineering',
    skill: 'implement',
    status: 'success',
    started: '2026-08-16T10:00:00.000Z',
    backend: 'claude-code',
    model: 'opus',
    effort: 'high',
    mode: 'bypassPermissions',
    report: '',
    ...over,
  });
  const broke = (id: string, started: string, note: string): RunRecord =>
    run({ run: id, started, status: 'failed', fault: 'infrastructure', note });

  const sandboxBody = async (app: FastifyInstance) =>
    (await app.inject({ method: 'GET', url: '/api/sandbox', headers: admin })).json();

  // TWO FAILURES WITH DIFFERENT NOTES AND DIFFERENT TIMESTAMPS, so this can tell the most recent from the
  // oldest and a real count from a hardcoded one. A fixture of one, or of two identical records, would
  // pass against a route that reported the wrong end of the streak.
  it('reports how many ran in a row, what the last one said, and when it started', async () => {
    const { app, root } = await open({ ok: true, image: TEST_IMAGE });
    await writeRun(root, broke('20260816-100000-aaaa', '2026-08-16T10:00:00.000Z', 'Connection refused.'));
    await writeRun(
      root,
      broke(
        '20260816-100500-bbbb',
        '2026-08-16T10:05:00.000Z',
        'Failed to authenticate: OAuth session expired.',
      ),
    );
    expect((await sandboxBody(app)).recentFailure).toEqual({
      runs: 2,
      note: 'Failed to authenticate: OAuth session expired.',
      at: '2026-08-16T10:05:00.000Z',
    });
  });

  // VERBATIM, for the reason the refusal is: a dead credential and a working directory that no longer
  // exists read identically once the specifics are dropped, and they send a person to two different
  // machines. Asserted as the whole string — a `toContain` would pass against a route that wrapped the
  // harness's sentence in one of ours.
  it('never rewords what the harness said', async () => {
    const said = 'Failed to authenticate: OAuth session expired. Run `claude setup-token`.';
    const { app, root } = await open({ ok: true, image: TEST_IMAGE });
    await writeRun(root, broke('20260816-100000-aaaa', '2026-08-16T10:00:00.000Z', said));
    expect((await sandboxBody(app)).recentFailure.note).toBe(said);
  });

  it('says nothing when the last run reached a model', async () => {
    const { app, root } = await open({ ok: true, image: TEST_IMAGE });
    await writeRun(root, broke('20260816-100000-aaaa', '2026-08-16T10:00:00.000Z', 'Connection refused.'));
    await writeRun(root, run({ run: '20260816-100500-bbbb', started: '2026-08-16T10:05:00.000Z' }));
    expect((await sandboxBody(app)).recentFailure).toBeUndefined();
  });

  it('says nothing for a project that has never run anything', async () => {
    const { app } = await open({ ok: true, image: TEST_IMAGE });
    expect((await sandboxBody(app)).recentFailure).toBeUndefined();
  });

  // THE ANTI-DEADLOCK ASSERTION, and it is the reason this field exists rather than a gate.
  //
  // A gate keyed on HISTORY cannot be cleared, because the run that would clear it is the run the gate
  // refuses. This codebase has already shipped that deadlock once — the infrastructure streak, read off
  // the end of the history and breakable only by a run that reached a model, so the first tick after the
  // user fixed the machine stopped again on the same records, for ever. It was fixed by counting only
  // runs since auto-pilot last started, and this route deliberately does not pass that boundary because
  // it is REPORTING rather than DECIDING. That is only safe while it decides nothing, which is what this
  // holds: the three fields the dispatch gate reads are untouched, and a dispatch still gets through.
  it('does not refuse anything: a project with a streak can still dispatch', async () => {
    const { app, root } = await open({ ok: true, image: TEST_IMAGE });
    await writeRun(root, broke('20260816-100000-aaaa', '2026-08-16T10:00:00.000Z', 'Connection refused.'));
    await writeRun(
      root,
      broke(
        '20260816-100500-bbbb',
        '2026-08-16T10:05:00.000Z',
        'Failed to authenticate: OAuth session expired.',
      ),
    );

    const body = await sandboxBody(app);
    // Reported — so this project really is in the state that used to deadlock.
    expect(body.recentFailure.runs).toBe(2);
    // And enforcing nothing. These three are what the gate reads, and a recent failure moves none of them.
    expect(body.ok).toBe(true);
    expect(body.agentRefusal).toBeNull();
    expect(body.refusalKind).toBeNull();

    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: admin,
      payload: { board: 'engineering', card: 'nope-not-a-card', skill: 'execute' },
    });
    // 412 is the machine refusing. Anything else means it got past the gate, which is the whole assertion
    // — the card is deliberately unknown so nothing else about this project has to exist.
    expect(res.statusCode).not.toBe(412);
  });

  // The run records live under a project root, and there is none. Every other field here is about docker
  // and the backend and is answerable either way, so the route must still answer rather than fail.
  it('answers without it when no project is open', async () => {
    const session = new ProjectSession();
    const app = buildApp(session, {
      credentials: new CredentialStore(ADMIN),
      logger: false,
      sandbox: fixedSandbox({ ok: true, image: TEST_IMAGE }),
    });
    onTestFinished(async () => {
      await app.close();
      await session.close();
    });
    const body = await sandboxBody(app);
    expect(body.ok).toBe(true);
    expect(body.recentFailure).toBeUndefined();
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
