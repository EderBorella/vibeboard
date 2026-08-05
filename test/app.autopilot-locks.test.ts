import { chmodSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AutopilotState } from '../src/core/autopilot-state.js';
import { IDLE_STATE } from '../src/core/autopilot-state.js';
import { writeAutopilotState } from '../src/server/autopilot-store.js';
import type { Scope } from '../src/server/credentials.js';
import { dispatchLock } from '../src/server/routes/runs.js';
import { readRun } from '../src/server/run-store.js';
import { openTestProject, shimArgsLog, tempDir, wsClient } from './helpers.js';

// What a halted project and a running auto-pilot refuse, and what each refusal SAYS. A message about a
// state the user cannot see and cannot act on is a worse failure than the state itself, so every one
// of these names the way forward.

const here = dirname(fileURLToPath(import.meta.url));
const SHIM = join(here, 'fixtures', 'fake-claude.mjs');

beforeAll(() => {
  chmodSync(SHIM, 0o755);
  process.env.VIBEBOARD_CLAUDE_BIN = SHIM;
});

const dispatch = { board: 'engineering', card: 'E-001', skill: 'implement' };

describe('while a project is halted', () => {
  it('refuses a dispatch, naming the restart', async () => {
    const { app } = await openTestProject();
    await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });
    const res = await app.inject({ method: 'POST', url: '/api/runs', payload: dispatch });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Restart');
  });

  it('dispatches again once it has been restarted', async () => {
    const { app } = await openTestProject();
    await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });
    await app.inject({ method: 'POST', url: '/api/autopilot/restart', payload: {} });
    const res = await app.inject({ method: 'POST', url: '/api/runs', payload: dispatch });
    // 404 would mean the card is missing rather than the lock refusing; anything but 409 proves the
    // lock is open. The sample board has E-001, so this is a real dispatch.
    expect(res.statusCode).not.toBe(409);
  });

  // The assertion is that NO PROCESS WAS CREATED, not that the message was polite. Decision 12 is
  // explicit that while halted "nothing dispatches, nothing respawns lazily, and the chat says plainly
  // that the project is halted" — and the args log is the only place that can tell those apart.
  it('starts no agent for a chat message, and says so', async () => {
    const ARGS_LOG = shimArgsLog();
    if (existsSync(ARGS_LOG)) rmSync(ARGS_LOG);
    process.env.VIBEBOARD_SHIM_ARGS = ARGS_LOG;
    const { app } = await openTestProject();
    await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const client = wsClient<{ type: string; error?: string }>(address);
    await client.open;
    client.send({ type: 'copilot:send', text: 'hello', mode: 'plan' });

    // The log FIRST, on a short bounded wait, and only then the message. With the gate removed this test
    // did fail — but at `waitFor(copilot:error)` eight seconds later, so the assertion it names was never
    // reached and the failure said "timed out" rather than "a process was created". A spawn writes the log
    // within milliseconds; a second is generous.
    await new Promise((r) => setTimeout(r, 1000));
    expect(existsSync(ARGS_LOG), 'a process was created for a halted project').toBe(false);

    const refusal = await client.waitFor((m) => m.type === 'copilot:error');
    client.close();
    delete process.env.VIBEBOARD_SHIM_ARGS;
    expect(refusal.error).toContain('halted');
  }, 8000);
});

// The rule on its own, with no app in the way. Through the app, TWO layers refuse a halted project —
// this lock and agent-runner.ts on the far side of every await — so an end-to-end test cannot tell which
// one did it, and planting proved the lock's halted branch was held by nothing.
describe('the dispatch lock itself', () => {
  const at = (state: 'idle' | 'running' | 'stopped' | 'halted') => ({ ...IDLE_STATE, state });
  const locked = (state: AutopilotState, scope: Scope | undefined): boolean =>
    dispatchLock(state, scope) !== undefined;

  // Every state against every scope. `work` and `checkup` never reach this rule in production — the scope
  // table 403s them first — but the predicate is still wrong if it exempts them, and planting showed that
  // exempting `work` was caught by nothing at all with only two columns here.
  //
  // The service's authority is CO-TERMINOUS WITH `running`, which is the whole point of the rule: written
  // as "not a by-hand caller while running", it admitted the loop while idle and while stopped — and
  // `stopped` is the state a soft stop produces, so the soft stop was enforced by nothing on the server.
  it.each([
    // state,      admin, work,  checkup, service
    ['idle', false, false, false, true],
    ['stopped', false, false, false, true],
    ['running', true, true, true, false],
    ['halted', true, true, true, true],
  ] as const)('%s', (state, admin, work, checkup, service) => {
    expect(locked(at(state), 'admin'), 'admin').toBe(admin);
    expect(locked(at(state), 'work'), 'work').toBe(work);
    expect(locked(at(state), 'checkup'), 'checkup').toBe(checkup);
    expect(locked(at(state), 'service'), 'service').toBe(service);
  });

  it('names the way forward in every refusal', () => {
    // Asserted as whole sentences, not substrings: these reach a person, and a refusal that has lost the
    // half telling them what to do is the dead end this design will not ship. A `toBeDefined` first, so a
    // missing sentence fails as a missing sentence rather than as an argument-type error inside chai.
    const byHand = dispatchLock(at('running'), 'admin');
    expect(byHand).toBeDefined();
    expect(byHand).toContain('Soft-stop it first');

    const halted = dispatchLock(at('halted'), 'service');
    expect(halted).toBeDefined();
    expect(halted).toContain('Restart it from the auto-pilot panel');

    const idle = dispatchLock(at('idle'), 'service');
    expect(idle).toBeDefined();
    expect(idle).toContain('no authority to dispatch');
    // The state itself, so the reader knows which of the four they are in.
    expect(idle).toContain('idle');
  });

  // A credential with no scope at all is the browser before the header is filled in, and a missing scope
  // must not read as the service's exemption.
  it('treats an unknown caller as a by-hand one', () => {
    expect(dispatchLock(at('running'), undefined)).toContain('Soft-stop');
    expect(dispatchLock(at('idle'), undefined)).toBeUndefined();
  });
});

describe('the loop’s authority is exactly the running state', () => {
  // ONE token, four states, and nothing else changing. The earlier version of this asserted only that a
  // halted project refuses a service dispatch — which the browser is refused for too, with the same 409
  // and the same sentence, so deleting the whole halted branch left it green. A pair is the fix: the same
  // credential must be admitted in one state and refused in the others.
  it('is admitted while running and refused while idle, stopped and halted', async () => {
    const { app, root, mint } = await openTestProject();
    const service = mint('service', 'run-svc');
    const headers = { authorization: `Bearer ${service.token}` };

    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    const allowed = await app.inject({ method: 'POST', url: '/api/runs', headers, payload: dispatch });
    expect(allowed.statusCode).toBe(200);

    // `idle` and `stopped` matter as much as `halted`: `stopped` is what a SOFT STOP produces, and the
    // runtime writes it without killing anything — so if the loop keeps its authority there, the soft stop
    // is enforced by the loop choosing to notice and by nothing else.
    for (const state of ['idle', 'stopped', 'halted'] as const) {
      await writeAutopilotState(root, { ...IDLE_STATE, state });
      const res = await app.inject({ method: 'POST', url: '/api/runs', headers, payload: dispatch });
      expect(res.statusCode, state).toBe(409);
    }
  });

  // A SOFT STOP keeps the credential, and that is the Stops table's promise rather than an oversight: it
  // says in-flight work finishes, and the loop needs its token to finish — to wait for the run record, move
  // the card it has just verified, record the verdict and write the diary line. Revoking there produced a
  // loop that died of a 401 mid-dispatch and abandoned the very work the soft stop let it keep. Nothing NEW
  // can start, because `dispatchLock` refuses a service caller outside `running`.
  it('keeps its credential through a soft stop, so in-flight work can be finished', async () => {
    const { app, root, mint } = await openTestProject();
    const service = mint('service', 'run-svc');
    const headers = { authorization: `Bearer ${service.token}` };
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });

    await app.inject({ method: 'POST', url: '/api/autopilot/stop', payload: {} });
    // Still a valid credential: 200 on the reads and writes finishing a dispatch needs.
    expect((await app.inject({ method: 'GET', url: '/api/runs', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/accounting', headers })).statusCode).toBe(200);
    // And still no new dispatch, which is what the soft stop was for. 409, not 401.
    const dispatched = await app.inject({ method: 'POST', url: '/api/runs', headers, payload: dispatch });
    expect(dispatched.statusCode).toBe(409);
  });

  // An emergency stop and a restart are the two that genuinely take the authority away, so they take the
  // token with it. 401 rather than 409 — the credential is gone, not merely out of state. Without this the
  // token lived for the whole life of the server: it belongs to no run record, so nothing else expires it.
  it.each([
    ['an emergency stop', '/api/autopilot/kill'],
    ['a restart', '/api/autopilot/restart'],
  ])('revokes its credential on %s, and only its own', async (_name, url) => {
    const { app, root, mint } = await openTestProject();
    const service = mint('service', 'run-svc');
    const headers = { authorization: `Bearer ${service.token}` };
    // A WORK credential beside it, because with one credential in the store a blanket purge is
    // indistinguishable from targeted revocation — and a blanket purge would 401 an agent mid-turn, which
    // is the opposite of what a stop is allowed to do to work already in flight.
    const work = mint('work', 'run-work', 'E-001');
    const workHeaders = { authorization: `Bearer ${work.token}` };
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    expect((await app.inject({ method: 'GET', url: '/api/runs', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/state', headers: workHeaders })).statusCode).toBe(
      200,
    );

    // A restart is refused while `running`, so it needs the soft stop first — which is the documented
    // sequence and the one that used to leave a live token behind.
    if (url.endsWith('restart')) {
      await app.inject({ method: 'POST', url: '/api/autopilot/stop', payload: {} });
    }
    expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/runs', headers })).statusCode).toBe(401);
    // The agent's credential is untouched. Its run is a separate thing with a separate lifetime, and only
    // an emergency stop kills a run — through the runner, not through the credential store.
    const still = await app.inject({ method: 'GET', url: '/api/state', headers: workHeaders });
    expect(still.statusCode, 'a work credential must survive a stop aimed at the loop').toBe(200);
  });
});

describe('the two revocations that do not go through a stop control', () => {
  it('revokes it when a reconcile decides the loop is gone', async () => {
    // Reopening the OPEN project is deliberately allowed while `running`, because the reconcile that clears
    // a stale `running` only happens on open. That reconcile took the loop's authority away and left its
    // credential valid.
    const { app, root, mint } = await openTestProject();
    const service = mint('service', 'run-svc');
    const headers = { authorization: `Bearer ${service.token}` };
    // `running` with no recorded group: nothing to be alive, so the reconcile decides it is gone.
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    expect((await app.inject({ method: 'GET', url: '/api/runs', headers })).statusCode).toBe(200);

    expect(
      (await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: root } })).statusCode,
    ).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/runs', headers })).statusCode).toBe(401);
  });
});

describe('while auto-pilot is running', () => {
  it('refuses a manual dispatch, offering the soft stop', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    const res = await app.inject({ method: 'POST', url: '/api/runs', payload: dispatch });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Soft-stop');
  });

  // THE LOCK C2 CHANGED, and the only state in which the loop ever dispatches. Refusing the service here
  // would refuse auto-pilot itself; refusing a by-hand dispatch is S6, because the runner, the
  // concurrency cap and the queue are shared and a manual run would queue ahead of the loop's next one.
  it('lets the SERVICE dispatch while running, and still refuses a by-hand one', async () => {
    const { app, root, mint } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });

    const byHand = await app.inject({ method: 'POST', url: '/api/runs', payload: dispatch });
    expect(byHand.statusCode).toBe(409);

    const service = mint('service', 'run-svc');
    const loop = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: { authorization: `Bearer ${service.token}` },
      payload: dispatch,
    });
    // Past the lock. It gets a real run, which is the point — the same payload the admin was refused.
    expect(loop.statusCode).toBe(200);
    expect(loop.json().run).toBeTruthy();
  });

  it('dispatches by hand again after a soft stop', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    await app.inject({ method: 'POST', url: '/api/autopilot/stop', payload: {} });
    const res = await app.inject({ method: 'POST', url: '/api/runs', payload: dispatch });
    expect(res.statusCode).not.toBe(409);
  });

  // S7. Switching would resolve the next dispatch against the new project and rewrite the old one's
  // live runs to `interrupted` — a status that burns no attempt, corrupting the ledger of a run still
  // in flight.
  it('refuses to open a DIFFERENT project', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    const elsewhere = await tempDir();
    const res = await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: elsewhere } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Soft-stop');
  });

  // Not a switch, and refusing it would deadlock recovery: a server that died mid-run leaves `running`
  // on disk, and the reconcile that fixes it happens on open.
  it('still allows reopening the project already open', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    const res = await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: root } });
    expect(res.statusCode).toBe(200);
  });

  // The same folder spelled differently is the same folder. A raw string compare refused this as a
  // switch, and the reconcile that clears a stale `running` only happens on open — so the one state that
  // needs recovering was the one state that could not be recovered.
  it.each([
    ['a trailing slash', (root: string) => `${root}/`],
    ['a redundant segment', (root: string) => `${root}/./`],
    ['a parent-and-back', (root: string) => `${root}/x/..`],
  ])('still allows reopening the open project spelled with %s', async (_label, spell) => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/project/open',
      payload: { path: spell(root) },
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows the switch after a soft stop', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    await app.inject({ method: 'POST', url: '/api/autopilot/stop', payload: {} });
    const other = await openTestProject({ name: 'B' });
    const res = await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: other.root } });
    expect(res.statusCode).toBe(200);
  });
});

// BLOCKER found in review: the emergency stop killed the runner's agents and the managed OpenCode
// server, and left the CHAT's agent running. It holds no run record, so it has no pgid on disk and
// neither `cancelAll` nor the reaper can see it — and the confirm dialog says "every agent working on
// this project is killed".
describe('an emergency stop', () => {
  it('kills the chat’s agent and what it started', async () => {
    const AGENT = join(here, 'fixtures', 'fake-agent.mjs');
    chmodSync(AGENT, 0o755);
    const previous = process.env.VIBEBOARD_CLAUDE_BIN;
    // The chat's bin comes from the environment: CopilotSession takes no override. Restored in the
    // `finally` so the rest of the file keeps the shim it set up.
    process.env.VIBEBOARD_CLAUDE_BIN = AGENT;
    try {
      const { app } = await openTestProject();
      const address = await app.listen({ port: 0, host: '127.0.0.1' });
      const client = wsClient<{ type: string; event?: { kind: string; text?: string } }>(address);
      await client.open;
      // `spawner` narrates its child's pid and then hangs, exactly as it does for a run.
      client.send({ type: 'copilot:send', text: '[[behaviour:spawner]]', mode: 'plan' });
      const said = await client.waitFor((m) => Boolean(m.event?.text?.includes('child ')));
      const grandchild = Number(/child (\d+)/.exec(said.event?.text ?? '')?.[1]);
      expect(grandchild).toBeGreaterThan(0);
      expect(alive(grandchild)).toBe(true);

      await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });
      for (let i = 0; i < 60 && alive(grandchild); i++) await new Promise((r) => setTimeout(r, 50));
      expect(alive(grandchild)).toBe(false);
      client.close();
    } finally {
      if (previous === undefined) delete process.env.VIBEBOARD_CLAUDE_BIN;
      else process.env.VIBEBOARD_CLAUDE_BIN = previous;
    }
  }, 20_000);
});

// Signal 0 asks "may I signal this?" and kills nothing.
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// HIGH found in review: S7's refusal was on `/project/open` alone, and scaffolding — the adjacent
// button in the same picker — called `session.open` with no check at all. A refusal reachable by the
// button next to it is not a refusal.
describe('creating a project while auto-pilot runs', () => {
  it('is refused, like opening one', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    const elsewhere = await tempDir();
    const res = await app.inject({
      method: 'POST',
      url: '/api/project/scaffold',
      payload: { path: elsewhere, name: 'B', mode: 'greenfield' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Soft-stop');
    // And nothing was written: the guard is before `scaffoldProject`, so the refusal leaves no
    // half-made project behind.
    expect(existsSync(join(elsewhere, '.vibeboard'))).toBe(false);
  });

  it('is allowed once auto-pilot has stopped', async () => {
    const { app, root } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    await app.inject({ method: 'POST', url: '/api/autopilot/stop', payload: {} });
    const elsewhere = await tempDir();
    const res = await app.inject({
      method: 'POST',
      url: '/api/project/scaffold',
      payload: { path: elsewhere, name: 'B', mode: 'greenfield' },
    });
    expect(res.statusCode).toBe(200);
  });
});

// BLOCKER found in review, reproduced 4/4: a dispatch resolving while a kill lands started AFTER the
// project was recorded halted and settled `success`.
//
// The deterministic pin for this is in agent-runner.test.ts ("a halted project"), where the gate is a
// function a test controls. This is the reviewer's own probe kept as a regression guard: it is
// PROBABILISTIC — it can only fail if the gate is gone, and with the gate it cannot pass by luck.
describe('a dispatch racing an emergency stop', () => {
  it('never ends in success', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { app, root } = await openTestProject();
      const [dispatched] = await Promise.all([
        app.inject({ method: 'POST', url: '/api/runs', payload: dispatch }),
        app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} }),
      ]);
      if (dispatched.statusCode !== 200) continue; // refused outright, which is the other right answer
      const run = dispatched.json().run.run as string;
      // Whatever it did, it must not be recorded as work that succeeded in a halted project.
      for (let i = 0; i < 40; i++) {
        const record = await readRun(root, 'engineering', 'E-001', run);
        if (record && record.status !== 'running' && record.status !== 'queued') {
          expect(record.status, `attempt ${attempt}`).not.toBe('success');
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }, 30_000);
});
