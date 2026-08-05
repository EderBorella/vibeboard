import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { IDLE_STATE } from '../src/core/autopilot-state.js';
import { readAutopilotState, writeAutopilotState } from '../src/server/autopilot-store.js';
import { CredentialStore } from '../src/server/credentials.js';
import { isSameGroup } from '../src/server/process-group.js';
import { defaultServiceCommand, ServiceProcess } from '../src/server/service-process.js';
import { tempDir, testTmp } from './helpers.js';

// Bringing the loop up, and noticing when it dies. Nothing here runs the loop itself — that is Task 7 —
// so the shim stands in for it and records what the process was actually handed.

const here = dirname(fileURLToPath(import.meta.url));
const SHIM = join(here, 'fixtures', 'fake-service.mjs');

beforeAll(() => {
  chmodSync(SHIM, 0o755);
});

interface Recorded {
  argv: string[];
  cwd: string;
  pid: number;
  argv0: string;
  token: string | null;
  apiBase: string | null;
  projectRoot: string | null;
  isGroupLeader: boolean;
}

// A fresh log path per call, outside the repo and inside the run's own temp root, so concurrent workers
// cannot read each other's record.
async function logPath(): Promise<string> {
  return join(await mkdtemp(join(testTmp(), 'svc-')), 'record.json');
}

async function harness(opts: { behaviour?: string; log?: string } = {}) {
  const root = await tempDir();
  await writeAutopilotState(root, IDLE_STATE);
  const log = opts.log ?? (await logPath());
  const credentials = new CredentialStore('admin-token');
  const service = new ServiceProcess({
    root: () => root,
    now: () => new Date(),
    credentials,
    apiBase: () => 'http://127.0.0.1:4610',
    command: () => ({
      bin: process.execPath,
      args: [SHIM, log, opts.behaviour ?? 'sleep'],
    }),
  });
  return { root, service, credentials, log };
}

// The shim writes its record and then stays alive, so the file appears a moment after `start` resolves.
async function recorded(path: string): Promise<Recorded> {
  for (let i = 0; i < 100; i += 1) {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`the service shim never wrote ${path}`);
}

describe('starting the loop', () => {
  it('records running, and the process group, before the loop can tick', async () => {
    const { root, service } = await harness();
    const started = await service.start();
    expect(started.ok).toBe(true);

    // From the FILE, not from the returned object: this is what an emergency stop in a later server
    // process will read, and it is the only copy that survives this one.
    const state = await readAutopilotState(root, '2026-08-05T10:00:00Z');
    expect(state.state).toBe('running');
    expect(state.servicePgid).toBeGreaterThan(1);
    // Both, and the plan says why: the start time is the pid-reuse guard decision 13 was corrected for.
    // A pgid alone would let a later reaper signal whatever inherited that number.
    expect(state.servicePgstart).toBeGreaterThan(0);
    expect(isSameGroup(state.servicePgid ?? 0, state.servicePgstart ?? 0)).toBe(true);
  });

  it('hands the loop a service credential, the API base and the project root', async () => {
    const { service, credentials, log } = await harness();
    await service.start();
    const got = await recorded(log);

    expect(got.apiBase).toBe('http://127.0.0.1:4610');
    // Asserted through the store, not by comparing to a string the test made up: a token the app cannot
    // verify would be a loop that 401s on its first call.
    expect(got.token).toBeTruthy();
    expect(credentials.verify(got.token ?? '')?.scope).toBe('service');
  });

  it('confines the loop to this project, so its credential cannot reach another', async () => {
    const { root, service, credentials, log } = await harness();
    await service.start();
    const got = await recorded(log);
    expect(got.projectRoot).toBe(root);
    expect(credentials.verify(got.token ?? '')?.project).toBe(root);
    expect(got.cwd).toBe(root);
  });

  // NOT a nice-to-have, and not an oversight: every agent runs inside the AppArmor profile, and the
  // service must not, because it WRITES `autopilot-state.json` — the counters are its own — and the
  // profile denies that to every confined process. What confines the loop is the scope table.
  it('spawns the loop unsandboxed, because it writes the state file the profile denies', async () => {
    const { service, log } = await harness();
    await service.start();
    const got = await recorded(log);
    // A confined process would have been `aa-exec -p vibeboard-agent -- node …`, so the binary itself is
    // the evidence. `wrapCommand` is what would have changed it, and nothing here calls it.
    expect(got.argv0).not.toContain('aa-exec');
    expect(got.argv[0]).toBe(log);
  });

  it('spawns it as its own process group leader, which is what an emergency stop needs', async () => {
    const { service, log } = await harness();
    await service.start();
    expect((await recorded(log)).isGroupLeader).toBe(true);
  });

  // A fresh run must not wear the last one's verdict. `decideTick` echoes a stored reason back for any
  // non-running state — `complete` included — so a stale one would hand the loop a success action for a
  // run it never made.
  it('clears the reason and detail of the stop it is replacing', async () => {
    const { root, service } = await harness();
    await writeAutopilotState(root, {
      ...IDLE_STATE,
      state: 'stopped',
      reason: 'complete',
      detail: 'Auto-pilot finished: nothing is eligible and nothing is unfinished.',
    });
    await service.start();
    const state = await readAutopilotState(root, '2026-08-05T10:00:00Z');
    expect(state.reason).toBeUndefined();
    expect(state.detail).toBeUndefined();
  });

  it('keeps the counters, which belong to the service rather than to this process', async () => {
    // Decision 20's split: the server owns state/reason/detail/at, the service owns the counters. A
    // start that reset `iteration` would hand back a cap nobody raised.
    const { root, service } = await harness();
    await writeAutopilotState(root, {
      ...IDLE_STATE,
      state: 'stopped',
      iteration: 7,
      dispatchesSinceCheckup: 3,
    });
    await service.start();
    const state = await readAutopilotState(root, '2026-08-05T10:00:00Z');
    expect(state.iteration).toBe(7);
    expect(state.dispatchesSinceCheckup).toBe(3);
  });

  it('refuses a second loop rather than leaking the first', async () => {
    const { service } = await harness();
    expect((await service.start()).ok).toBe(true);
    const again = await service.start();
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.error).toMatch(/already running/i);
  });

  it('refuses with a reason when the command cannot be run at all', async () => {
    const { root } = await harness();
    const service = new ServiceProcess({
      root: () => root,
      now: () => new Date(),
      credentials: new CredentialStore('admin-token'),
      apiBase: () => 'http://127.0.0.1:4610',
      command: () => ({ bin: '/nonexistent/loop', args: [] }),
    });
    const result = await service.start();
    // Never a throw AND never an unhandled rejection: `spawn` reports a missing binary on the next tick,
    // not by throwing, so an app with no `error` listener would take the SERVER down rather than refuse a
    // request. Vitest fails a run on an unhandled error even when every assertion passes, which is how
    // this was found — so this test's real subject is that the run stays clean.
    expect(result.ok).toBe(false);
    const state = await readAutopilotState(root, '2026-08-05T10:00:00Z');
    expect(state.state).not.toBe('running');
  });
});

describe('when the loop dies without stopping first', () => {
  it('records stopped, says how it died, and owes the project a checkup', async () => {
    const { root, service } = await harness({ behaviour: 'exit:3' });
    await service.start();

    for (let i = 0; i < 100 && (await readAutopilotState(root, 'x')).state === 'running'; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const state = await readAutopilotState(root, '2026-08-05T10:00:00Z');
    expect(state.state).toBe('stopped');
    expect(state.reason).toBe('interrupted');
    expect(state.detail).toContain('code 3');
    // The same reasoning as the startup reconcile: dispatches nobody was watching may be in flight, so
    // resuming without a supervisor pass would assume they went fine.
    expect(state.needsCheckup).toBe(true);
  });

  // The ordinary ending. The loop writes its own stop — `complete`, `capped`, `exhausted` — and THEN
  // exits, so a supervisor that overwrote the state would replace a real verdict with a generic one.
  it('leaves a stop the loop recorded for itself alone', async () => {
    const { root, service } = await harness({ behaviour: 'exit:0' });
    await service.start();
    // What the loop would have written on its way out, in the same window.
    await writeAutopilotState(root, {
      ...IDLE_STATE,
      state: 'stopped',
      reason: 'complete',
      detail: 'Auto-pilot finished: nothing is eligible and nothing is unfinished.',
    });
    await new Promise((r) => setTimeout(r, 400));
    const state = await readAutopilotState(root, '2026-08-05T10:00:00Z');
    expect(state.reason).toBe('complete');
  });

  it('stops reporting itself as running once the child is gone', async () => {
    const { service } = await harness({ behaviour: 'exit:0' });
    await service.start();
    for (let i = 0; i < 100 && service.running(); i += 1) await new Promise((r) => setTimeout(r, 20));
    expect(service.running()).toBe(false);
  });
});

// The one thing about the default that can be checked without a built tree: it points at the loop's
// entry beside this module rather than at a path relative to whatever directory the server was started
// from, and it carries the loader that got us here so a `.ts` entry still runs under tsx.
describe('the default command', () => {
  it('resolves the loop’s entry beside the server, with this process’s loader', () => {
    const command = defaultServiceCommand();
    expect(command.bin).toBe(process.execPath);
    const entry = command.args.at(-1) ?? '';
    expect(entry).toMatch(/[\\/]service[\\/]main\.(ts|js)$/);
    expect(entry.startsWith('/')).toBe(true);
    for (const flag of process.execArgv) expect(command.args).toContain(flag);
  });
});
