import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { IDLE_STATE } from '../src/core/autopilot-state.js';
import { foundationRel } from '../src/core/layout.js';
import { readAutopilotState, writeAutopilotState } from '../src/store/autopilot-store.js';
import { openTestProject, testTmp, wsClient } from './helpers.js';

// Pressing start, and every way it refuses. Each refusal has to name the way forward — a control whose
// refusal is invisible is the dead end this design will not ship.

const here = dirname(fileURLToPath(import.meta.url));
const SHIM = join(here, 'fixtures', 'fake-service.mjs');

beforeAll(() => {
  chmodSync(SHIM, 0o755);
});

async function shimLog(): Promise<string> {
  return join(await mkdtemp(join(testTmp(), 'start-')), 'record.json');
}

// A project that is genuinely ready — every blocker readiness knows about, cleared. Written out rather
// than scaffolded, because the scaffold deliberately does NOT manufacture these: a placeholder foundation
// document is exactly what decision 7's pre-flight exists to refuse.
const DOCS: Record<string, string> = {
  'STACK.md': '# Stack\n\nNode and TypeScript.\n',
  'UX.md': '# UX\n\nA board, three columns deep.\n',
  'DESIGN.md': '# Design\n\nFiles are canonical.\n',
  // Frontmatter, not a code fence: `readGates` reads `gates:` as data so the commands are a list a
  // person edits and a machine runs, never prose to be parsed.
  'CODE-QUALITY.md': '---\ngates:\n  - name: tests\n    command: npm test\n---\nWhat these gates mean.\n',
  'TESTING.md': '---\nsmoke: npm run smoke\n---\nHow this project is exercised.\n',
};

async function ready(opts: { behaviour?: string } = {}) {
  const log = await shimLog();
  const project = await openTestProject({
    serviceCommand: () => ({
      bin: process.execPath,
      args: [SHIM, log, opts.behaviour ?? 'sleep'],
    }),
  });
  // Long enough to clear the README gate's minimum, which exists because a two-line README is a
  // feature list nobody can derive.
  await writeFile(
    join(project.root, 'README.md'),
    [
      '# A project',
      '',
      'It keeps a list of things to do, and it keeps that list in files on disk so that',
      'the list outlives the program that shows it. A person adds an item, marks it done,',
      'and can read the whole thing with an editor if the program is not running.',
      '',
      'Nothing is stored anywhere else, and nothing is sent anywhere.',
    ].join('\n'),
  );
  for (const [name, body] of Object.entries(DOCS)) {
    const path = join(project.root, foundationRel(name));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  // The fixture asserts its own premise. A project that is not actually ready would make every refusal
  // test below pass for the wrong reason — and the 412 it produces is the same one a real blocker
  // produces, so nothing would look wrong.
  const readiness = await project.app.inject({ method: 'GET', url: '/api/autopilot/readiness' });
  if (!readiness.json().ok) {
    throw new Error(`the fixture is not ready: ${JSON.stringify(readiness.json().blockers)}`);
  }
  // The loop is spawned detached, so closing the app does not touch it. `openTestProject`'s own teardown
  // closes the app and the session and neither reaches a child in its own session — which is how this file
  // leaked four processes per run.
  onTestFinished(() => {
    project.app.service.stop();
  });
  return { ...project, log };
}

const start = (app: Awaited<ReturnType<typeof ready>>['app']) =>
  app.inject({ method: 'POST', url: '/api/autopilot/start', payload: {} });

// The shim writes its record and then stays alive, so the file appears a moment after `start` resolves.
async function recorded(path: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 100; i += 1) {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`the service shim never wrote ${path}`);
}

// THE PROCESS GROUP, read from the STATE FILE rather than off a response. A review found the strip applied to
// `GET /autopilot/state` alone while `start`, `stop`, `kill` and `restart` all still answered with it — and
// these tests were reading it from those replies, so one of them PINNED the leak as correct. The file is where
// the server records it (decision 20) and where the reaper reads it; no client ever needs it.
const recordedPgid = async (root: string): Promise<number | undefined> =>
  (await readAutopilotState(root, 'T')).servicePgid;

describe('pressing start', () => {
  it('starts the loop and reports the running state', async () => {
    const { app, root, log } = await ready();
    const res = await start(app);
    expect(res.statusCode).toBe(200);
    expect(res.json().state.state).toBe('running');
    // On disk, not in the reply.
    expect(await recordedPgid(root)).toBeGreaterThan(1);
    expect(res.json().state.servicePgid).toBeUndefined();

    // What the loop was actually handed. Nothing asserted this, so the app could have pointed it at a dead
    // host and every test would have passed — and the loop would 401 on its first call with no clue why.
    const got = await recorded(log);
    expect(got.apiBase).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(got.projectRoot).toBe(root);
    expect(got.stateAtStart).toBe('running');
  });

  it('tells every open tab, so a second window does not show a stopped project', async () => {
    const { app } = await ready();
    await app.listen({ port: 0 });
    const ws = wsClient<{ type: string; state?: { state?: string } }>(
      `http://127.0.0.1:${(app.server.address() as { port: number }).port}`,
    );
    await ws.open;
    await start(app);
    const message = await ws.waitFor((m) => m.type === 'autopilot:state');
    expect(message.state?.state).toBe('running');
    ws.ws.close();
  });

  it('refuses when the project is not ready, and lists what to fix', async () => {
    // No gate command: `verify: gates` would then fail closed on every card, so a run that started here
    // could never advance anything.
    const { app } = await openTestProject();
    const res = await start(app);
    expect(res.statusCode).toBe(412);
    expect(res.json().blockers.length).toBeGreaterThan(0);
    expect(res.json().error).toContain('not ready');
  });

  it('refuses without a sandbox, which is mandatory for the one caller that runs unattended', async () => {
    const { app } = await openTestProject({
      sandbox: { ok: false, reason: 'Docker is not available — no daemon', kind: 'docker' },
    });
    const res = await start(app);
    expect(res.statusCode).toBe(412);
    expect(res.json().error).toContain('Docker is not available');
  });

  it('refuses while halted, and says a person has to restart it', async () => {
    const { app, root } = await ready();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'halted', reason: 'killed' });
    const res = await start(app);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('halted');
    expect(res.json().error).toContain('Restart');
  });

  // TWO guards, and they answer different questions — so each needs its own assertion, on its own
  // sentence. Asserting the substring they share let the endpoint's check be deleted with nothing
  // failing, because the service refused the second child anyway.
  it('refuses a second start because the STATE says this project is running', async () => {
    const { app } = await ready();
    expect((await start(app)).statusCode).toBe(200);
    const again = await start(app);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('Auto-pilot is already running this project.');
  });

  it('starts a fresh loop when the state says it may, replacing one this server still held', async () => {
    // The state rewritten behind the endpoint's back is what a soft stop plus Restart looks like from
    // here: `stopped` on disk, the old loop still alive because a soft stop kills nothing. Refusing left
    // the project unable to start for as long as the old loop took to notice; replacing is safe because
    // outside `running` that loop can neither dispatch nor keep its credential.
    const { app, root } = await ready();
    expect((await start(app)).statusCode).toBe(200);
    const first = await recordedPgid(root);
    expect(first).toBeGreaterThan(1);
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'stopped' });

    const again = await start(app);
    expect(again.statusCode).toBe(200);
    expect(await recordedPgid(root)).not.toBe(first);
  });

  it('refuses with no project open', async () => {
    const { app, session } = await ready();
    await session.close();
    expect((await start(app)).statusCode).toBe(409);
  });
});

describe('what the browser is told', () => {
  it('is not told the loop’s process group, by ANY route or broadcast', async () => {
    // The pgid and its start time are the reaper's business. Nothing in the browser reads them, and sending a
    // pid to a web page is a detail of this machine leaving the machine for no one's benefit.
    //
    // EVERY reply, not just the read: a review found four control replies and both socket broadcasts still
    // carrying it while this test watched the one route that did not.
    const { app, root } = await ready();
    const started = await start(app);
    expect(await recordedPgid(root)).toBeGreaterThan(1); // recorded where the reaper needs it
    for (const [what, state] of [
      ['start', started.json().state],
      ['state', (await app.inject({ method: 'GET', url: '/api/autopilot/state' })).json().state],
      ['stop', (await app.inject({ method: 'POST', url: '/api/autopilot/stop', payload: {} })).json().state],
      [
        'restart',
        (await app.inject({ method: 'POST', url: '/api/autopilot/restart', payload: {} })).json().state,
      ],
      ['kill', (await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} })).json().state],
    ] as [string, Record<string, unknown>][]) {
      expect(state.servicePgid, what).toBeUndefined();
      expect(state.servicePgstart, what).toBeUndefined();
    }
  });
});

// The owed-checkup refusal retired with `checkupEvery` (decision 47): it was the one that stopped a project
// after roughly five cards and told a person to press Restart. What survives is Restart clearing a run that
// reached its cap, which is a different fact and is what this asserts.
describe('a project stopped at its cap', () => {
  it('is startable again once Restart has cleared the run', async () => {
    const { app, root } = await ready();
    await writeAutopilotState(root, {
      ...IDLE_STATE,
      state: 'stopped',
      reason: 'stalled',
      iteration: 250,
    });
    expect(
      (await app.inject({ method: 'POST', url: '/api/autopilot/restart', payload: {} })).statusCode,
    ).toBe(200);
    const started = await start(app);
    expect(started.statusCode).toBe(200);
    expect(started.json().state.state).toBe('running');
  });
});

describe('when the loop dies on its own', () => {
  it('raises the overlay in every open tab', async () => {
    const { app } = await ready({ behaviour: 'exit:7' });
    await app.listen({ port: 0 });
    const ws = wsClient<{ type: string; state?: { state?: string; reason?: string } }>(
      `http://127.0.0.1:${(app.server.address() as { port: number }).port}`,
    );
    await ws.open;
    await start(app);
    // Two messages arrive here: `running` from the start, then the supervisor's stop. It is the SECOND that
    // matters, and the start path's broadcast was held by a test while this one was held by nothing.
    const stopped = await ws.waitFor((m) => m.type === 'autopilot:state' && m.state?.state === 'stopped');
    expect(stopped.state?.reason).toBe('interrupted');
    ws.ws.close();
  });
});

describe('a loop that crashed keeps nothing', () => {
  it('loses the credential it was started with', async () => {
    // The supervisor writes the state directly rather than through `AutopilotRuntime`, so this was one of
    // three paths out of `running` that left a live `service` token behind — and a live token can still move
    // cards and write diary lines, neither of which is behind the dispatch lock.
    //
    // The LOOP'S OWN token, read back from what the process was handed: a token the test minted itself would
    // prove nothing about the one the server issued. An earlier version of this test called `stop()` first,
    // which marks the exit deliberate — so the supervisor never ran and the assertion passed on a different
    // revocation entirely.
    const { app, log } = await ready({ behaviour: 'exit:7' });
    await start(app);
    const token = (await recorded(log)).token as string;
    const headers = { authorization: `Bearer ${token}` };

    for (let i = 0; i < 100; i += 1) {
      const res = await app.inject({ method: 'GET', url: '/api/runs', headers });
      if (res.statusCode === 401) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect.fail('the crashed loop kept a working credential');
  });
});

describe('and an emergency stop takes it down with everything else', () => {
  it('signals the process group the start recorded', async () => {
    const { app, root } = await ready();
    await start(app);
    const pgid = (await recordedPgid(root)) as number;
    expect(pgid).toBeGreaterThan(1);

    const killed = await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });
    expect(killed.statusCode).toBe(200);
    expect(killed.json().state.state).toBe('halted');

    // The group is gone. `process.kill(pgid, 0)` throws ESRCH once nothing in it is left, which is the
    // only way to ask from outside — and it is the recorded pgid that is checked, not a handle this test
    // kept, because the reaper reads that number off disk.
    for (let i = 0; i < 100; i += 1) {
      try {
        process.kill(pgid, 0);
      } catch {
        return; // gone
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    // Reached only if the group is still alive after two seconds.
    expect.fail(`the service group ${pgid} survived the emergency stop`);
  });

  it('leaves the state halted rather than letting the supervisor overwrite it', async () => {
    // The child dies because it was killed, and the supervisor's exit handler runs. It must not turn a
    // deliberate `halted` into `stopped`, or the overlay would clear itself moments after the user
    // pressed the emergency stop.
    const { app } = await ready();
    await start(app);
    await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });
    await new Promise((r) => setTimeout(r, 400));
    const res = await app.inject({ method: 'GET', url: '/api/autopilot/state' });
    expect(res.json().state.state).toBe('halted');
    expect(res.json().state.reason).toBe('killed');
  });
});
