import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it, onTestFinished } from 'vitest';
import { IDLE_STATE } from '../src/core/autopilot-state.js';
import { buildApp } from '../src/server/app.js';
import { writeAutopilotState } from '../src/server/autopilot-store.js';
import { CredentialStore } from '../src/server/credentials.js';
import { DeviceStore } from '../src/server/devices.js';
import { ProjectSession } from '../src/server/session.js';
import { TEST_SANDBOX, tempDir } from './helpers.js';

const SHIM = join(process.cwd(), 'test', 'fixtures', 'fake-agent.mjs');
// Stryker copies the repo without the executable bit, and a shim that cannot be spawned makes every
// dispatch fail before any mutant exists.
chmodSync(SHIM, 0o755);
// The shim's behaviour travels in the prompt rather than the environment, which is shared with every
// other test file in this process.
const HANG = '[[behaviour:hang]]';

// THE TRAP THIS FILE AVOIDS. `testApp` in ./helpers fills in an Authorization header on every request
// that does not bring one, so every test of an UNAUTHENTICATED route would pass through it while
// actually presenting the admin token — proving the opposite of what it claims. Built with buildApp
// directly, the way test/auth.test.ts does, so a request here carries exactly what the test gives it.

const ADMIN = 'admin-token-for-signin-tests';
const admin = { authorization: `Bearer ${ADMIN}` };
const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141';

interface Ctx {
  app: FastifyInstance;
  devices: DeviceStore;
  session: ProjectSession;
  root: string;
}

async function open(opts: { mode?: 'greenfield' | 'brownfield' } = {}): Promise<Ctx> {
  const session = new ProjectSession();
  const devices = DeviceStore.inMemory();
  const app = buildApp(session, {
    credentials: new CredentialStore(ADMIN, devices),
    devices,
    logger: false,
    // Both only matter to the "closed while agents run" block, which dispatches a real hanging run —
    // there is no way to make the runner look busy from outside, and a stubbed count would be a test
    // of the stub.
    runBin: SHIM,
    sandbox: TEST_SANDBOX,
  });
  const root = await tempDir();
  onTestFinished(async () => {
    app.runner.cancelAll();
    await app.close();
    await session.close();
  });
  await app.inject({
    method: 'POST',
    url: '/api/project/scaffold',
    headers: admin,
    payload: { path: root, name: 'A', mode: opts.mode ?? 'brownfield' },
  });
  return { app, devices, session, root };
}

const claim = (app: FastifyInstance, agent = CHROME) =>
  app.inject({ method: 'POST', url: '/auth/claim', headers: { 'user-agent': agent } });

const ask = (app: FastifyInstance, agent = CHROME) =>
  app.inject({ method: 'POST', url: '/auth/request', headers: { 'user-agent': agent } });

describe('the first browser signs itself in', () => {
  // THE WHOLE POINT OF THE FEATURE: open the URL and the board is there. No button, no code, no
  // command, no pasting.
  it('claims a credential with no Authorization header at all', async () => {
    const { app, devices } = await open();

    const res = await claim(app);

    expect(res.statusCode).toBe(200);
    const { token } = res.json();
    expect(token).toMatch(/^dev_[0-9a-f]{10}\./);
    expect(devices.verify(token)).not.toBeNull();
  });

  // The other half of the same assertion, in the same file on purpose: opening ONE unauthenticated
  // door must not have opened the rest. Registered inside /api, /auth/claim would have needed an
  // exception in registerAuth's hook, and this is what that mistake would look like.
  it('while every /api route is still 401 without a credential', async () => {
    const { app } = await open();
    await claim(app);

    for (const url of ['/api/state', '/api/config', '/api/runs', '/api/signin']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it('and the credential it minted works on /api', async () => {
    const { app } = await open();
    const { token } = (await claim(app)).json();

    const res = await app.inject({
      method: 'GET',
      url: '/api/state',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  // Once, ever. A claim that stayed open would be an unauthenticated endpoint handing admin to
  // anything on the machine — which is every agent, by design.
  it('refuses the second claim, naming why', async () => {
    const { app } = await open();
    await claim(app);

    const res = await claim(app, 'curl/8.5.0');

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('already signed in');
  });

  it('records the label and the address it came from', async () => {
    const { app, devices } = await open();
    await claim(app);
    expect(devices.list()[0]).toMatchObject({ label: CHROME, address: '127.0.0.1' });
  });

  // Two page loads in the same tick. The emptiness check and the insert are indivisible inside
  // DeviceStore.claim; written as an `if` around an `await` at the endpoint, both would be first.
  it('cannot be won twice by two simultaneous loads', async () => {
    const { app, devices } = await open();

    const [a, b] = await Promise.all([claim(app), claim(app, 'curl/8.5.0')]);

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(devices.size).toBe(1);
  });
});

describe('a later browser asks to be approved', () => {
  it('is told nobody is signed in yet, rather than waiting for an approval that cannot come', async () => {
    const { app } = await open();
    const res = await ask(app);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('No browser is signed in');
  });

  it('gets a request id once a device exists', async () => {
    const { app } = await open();
    await claim(app);

    const res = await ask(app, 'Safari on the phone');

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toHaveLength(43); // 32 bytes, base64url
  });

  it('shows up in the admin list with its label and address', async () => {
    const { app } = await open();
    const { token } = (await claim(app)).json();
    await ask(app, 'Safari on the phone');

    const res = await app.inject({ url: '/api/signin', headers: { authorization: `Bearer ${token}` } });

    expect(res.json().pending).toEqual([
      { id: expect.any(String), label: 'Safari on the phone', address: '127.0.0.1', at: expect.any(String) },
    ]);
  });

  it('polls pending until something happens', async () => {
    const { app } = await open();
    await claim(app);
    const { id } = (await ask(app)).json();

    const res = await app.inject({ url: `/auth/request/${id}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: 'pending' });
  });

  it('collects a credential once approved, and only once', async () => {
    const { app, devices } = await open();
    const { token: first } = (await claim(app)).json();
    const { id } = (await ask(app, 'Safari on the phone')).json();

    const approved = await app.inject({
      method: 'POST',
      url: `/api/signin/approve/${id}`,
      headers: { authorization: `Bearer ${first}` },
    });
    expect(approved.statusCode).toBe(200);

    const collected = await app.inject({ url: `/auth/request/${id}` });
    expect(collected.json().state).toBe('approved');
    const second = collected.json().token;
    expect(devices.verify(second)).not.toBeNull();
    expect(second).not.toBe(first);

    // Single shot: an agent polling the same id must not pick up a token a person approved for a
    // browser. Request ids are unguessable, and this is the second lock on the same door.
    expect((await app.inject({ url: `/auth/request/${id}` })).json()).toEqual({ state: 'expired' });
  });

  it('is told it was refused, in words', async () => {
    const { app } = await open();
    const { token } = (await claim(app)).json();
    const { id } = (await ask(app)).json();

    await app.inject({
      method: 'POST',
      url: `/api/signin/refuse/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect((await app.inject({ url: `/auth/request/${id}` })).json()).toEqual({ state: 'refused' });
    // And it keeps saying so rather than flipping back to "ask again" on the next poll, which would
    // read as the refusal having been forgotten.
    expect((await app.inject({ url: `/auth/request/${id}` })).json()).toEqual({ state: 'refused' });
  });

  it('answers expired for an id nobody opened', async () => {
    const { app } = await open();
    expect((await app.inject({ url: '/auth/request/made-up' })).json()).toEqual({ state: 'expired' });
  });

  // PROMPT FATIGUE is the attack, not guessing. A caller that can raise a dialog as often as it likes
  // eventually catches an absent-minded Allow, so the rate limit is the mitigation and not a nicety.
  it('refuses a second request within the gap, with 429', async () => {
    const { app } = await open();
    await claim(app);
    expect((await ask(app)).statusCode).toBe(200);

    const res = await ask(app);

    expect(res.statusCode).toBe(429);
    expect(res.json().error).toContain('too recently');
  });

  it('approving and refusing an id that has gone answers 404 rather than pretending', async () => {
    const { app } = await open();
    const { token } = (await claim(app)).json();
    const headers = { authorization: `Bearer ${token}` };

    for (const verb of ['approve', 'refuse']) {
      const res = await app.inject({ method: 'POST', url: `/api/signin/${verb}/made-up`, headers });
      expect(res.statusCode, verb).toBe(404);
    }
  });

  // Admin-only BY ABSENCE from auth.ts's scope table. No table change was made for this feature, and
  // this is the assertion that the default did the work.
  it('cannot be approved without a credential', async () => {
    const { app } = await open();
    await claim(app);
    const { id } = (await ask(app)).json();

    const res = await app.inject({ method: 'POST', url: `/api/signin/approve/${id}` });

    expect(res.statusCode).toBe(401);
    expect((await app.inject({ url: `/auth/request/${id}` })).json()).toEqual({ state: 'pending' });
  });
});

// The client branches on the CODE, never on the sentence: "claimed" means ask to be approved,
// "busy" means stop and explain. Branching on prose would change behaviour the next time someone
// improved the wording, and the wording is meant to be improvable.
describe('every refusal names a machine-readable reason', () => {
  it('tells a claim apart: already claimed, or agents running', async () => {
    const { app, root } = await open();
    await claim(app);
    expect((await claim(app)).json()).toMatchObject({ reason: 'claimed' });

    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running', at: '2026-08-07T09:00:00.000Z' });
    expect((await claim(app)).json()).toMatchObject({ reason: 'busy' });
  });

  it('tells a request apart: nobody to ask, or asked too often', async () => {
    const { app } = await open();
    expect((await ask(app)).json()).toMatchObject({ reason: 'nobody' });

    await claim(app);
    expect((await ask(app)).statusCode).toBe(200);
    expect((await ask(app)).json()).toMatchObject({ reason: 'too-often' });
  });

  it('hands the waiting browser what the approver will see', async () => {
    // So the user can match this screen against the prompt on the other one. Without it they are
    // asked to recognise a prompt they have never been shown.
    const { app } = await open();
    await claim(app);

    const res = await ask(app, 'Safari on the phone');

    expect(res.json()).toEqual({
      id: expect.any(String),
      label: 'Safari on the phone',
      address: '127.0.0.1',
    });
  });
});

describe('the device list', () => {
  it('names which row is this browser, so the panel does not offer to revoke itself', async () => {
    const { app } = await open();
    const { token } = (await claim(app)).json();

    const res = await app.inject({ url: '/api/signin', headers: { authorization: `Bearer ${token}` } });

    const body = res.json();
    expect(body.devices).toHaveLength(1);
    expect(body.thisDevice).toBe(body.devices[0].id);
  });

  it('reports no device for the admin token, which belongs to none', async () => {
    const { app } = await open();
    expect((await app.inject({ url: '/api/signin', headers: admin })).json().thisDevice).toBeNull();
  });

  it('revokes one device and leaves the other signed in', async () => {
    const { app, devices } = await open();
    const { token: keep } = (await claim(app)).json();
    const gone = await devices.add('Phone', '192.168.0.31');
    const headers = { authorization: `Bearer ${keep}` };

    const res = await app.inject({ method: 'DELETE', url: `/api/signin/devices/${gone.id}`, headers });

    expect(res.statusCode).toBe(200);
    expect(
      (await app.inject({ url: '/api/state', headers: { authorization: `Bearer ${gone.token}` } }))
        .statusCode,
    ).toBe(401);
    expect((await app.inject({ url: '/api/state', headers })).statusCode).toBe(200);
  });

  it('answers 404 for a device it does not have', async () => {
    const { app } = await open();
    const { token } = (await claim(app)).json();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/signin/devices/dev_0000000000',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  // The answer to "how do I regenerate": every browser is signed out AND the next page load is a
  // silent first visit again. No restart, no command.
  it('signing everything out re-opens the first-visit claim', async () => {
    const { app } = await open();
    const { token } = (await claim(app)).json();
    const headers = { authorization: `Bearer ${token}` };

    expect((await app.inject({ method: 'POST', url: '/api/signin/clear', headers })).statusCode).toBe(200);

    expect((await app.inject({ url: '/api/state', headers })).statusCode).toBe(401);
    expect((await claim(app)).statusCode).toBe(200);
  });
});

// THE USER'S RULING: "Refused while agents are running." Not tidiness — an agent is the one caller
// that could plausibly be behind an unexpected sign-in request, and while runs are in flight a prompt
// appearing is least surprising and most likely to be waved through.
describe('sign-in while agents are running', () => {
  async function withHangingRun(): Promise<Ctx> {
    const ctx = await open({ mode: 'greenfield' });
    const state = (await ctx.app.inject({ url: '/api/state', headers: admin })).json() as {
      snapshot: { boards: { engineering: { id: string }[] } };
    };
    const dispatched = await ctx.app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: admin,
      payload: {
        board: 'engineering',
        card: state.snapshot.boards.engineering[0].id,
        skill: 'execute',
        prompt: HANG,
      },
    });
    expect(dispatched.statusCode, dispatched.body).toBe(200);
    return ctx;
  }

  it('refuses the claim, naming the running agent', async () => {
    // The store is EMPTY here, so the claim would otherwise succeed — which is what makes this a test
    // of the activity check rather than of the claim being closed for some other reason.
    const { app, devices } = await withHangingRun();
    expect(devices.empty).toBe(true);

    const res = await claim(app);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe(
      '1 agent is running on this project, so signing in a new browser is closed until they finish.',
    );
  });

  it('refuses a request to be approved', async () => {
    const { app, devices } = await withHangingRun();
    await devices.add('Laptop', '192.168.0.16'); // so "nobody to ask" is not the reason

    const res = await ask(app);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('is running on this project');
  });

  it('and opens again once the run has actually finished', async () => {
    // The other half: a check that refused unconditionally would pass every assertion above.
    //
    // Waits for the child to DIE rather than for `cancelAll` to return. A cancelled run stays in
    // `activeIds` until its process is really gone, which is correct — a run being killed is still an
    // agent running — and asserting straight after the call fails for that reason, not this one.
    const { app } = await withHangingRun();
    app.runner.cancelAll();
    for (let i = 0; i < 200 && app.runner.activeIds.length > 0; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(app.runner.activeIds).toEqual([]);

    expect((await claim(app)).statusCode).toBe(200);
  });

  it('refuses while auto-pilot is running, even with no run in flight', async () => {
    const { app, root } = await open();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running', at: '2026-08-07T09:00:00.000Z' });

    const res = await claim(app);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Auto-pilot is running');
  });
});

describe('a typo in a sign-in URL', () => {
  // Without /auth in the not-found handler's guard, an unknown /auth path is answered with index.html
  // and the client parses HTML as JSON — so the error the user reads is about JSON, not about sign-in.
  it('is a 404 and not the app shell', async () => {
    const { app } = await open();
    app.spaFallback = (reply) => reply.type('text/html').send('<!doctype html><title>shell</title>');

    const res = await app.inject({ url: '/auth/reqest/typo' });

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('doctype');
  });
});
