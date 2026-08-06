import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { IDLE_STATE } from '../src/core/autopilot-state.js';
import { readAutopilotState, writeAutopilotState } from '../src/server/autopilot-store.js';
import { CredentialStore } from '../src/server/credentials.js';
import type { Log } from '../src/server/logging.js';
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
  apparmor: string;
  stateAtStart: string | null;
  token: string | null;
  apiBase: string | null;
  projectRoot: string | null;
  hasPath: boolean;
  isGroupLeader: boolean;
}

// A fresh log path per call, outside the repo and inside the run's own temp root, so concurrent workers
// cannot read each other's record.
async function logPath(): Promise<string> {
  return join(await mkdtemp(join(testTmp(), 'svc-')), 'record.json');
}

function recordingLog(lines: string[]): Log {
  const write = (_obj: object, msg?: string): void => {
    if (msg) lines.push(msg);
  };
  const log: Log = {
    debug: write,
    info: write,
    warn: write,
    error: write,
    fatal: write,
    child: () => log,
  };
  return log;
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
  // EVERY harness kills what it started. Twelve sleeping children leaked per run of this file and its
  // sibling before this existed, reparented to init and holding ~48 MB each; 275 of them accumulated on
  // one machine. Registered with the runner rather than in an afterEach, so it runs even when an
  // assertion throws half way through a test.
  onTestFinished(() => {
    service.stop();
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
  //
  // Asserted from `/proc/self/attr/current`, because the obvious probe does not work: this test used to
  // check that `argv0` did not contain `aa-exec`, and a reviewer wrapped the real spawn in `aa-exec` and
  // watched it stay green. `aa-exec` EXECS its target, so a confined child sees `node` in `argv0` exactly
  // as an unconfined one does. The label is the thing that actually differs.
  it('spawns the loop unsandboxed, because it writes the state file the profile denies', async () => {
    const { service, log } = await harness();
    await service.start();
    const got = await recorded(log);
    expect(got.apparmor).toBe('unconfined');
    // And it inherits the environment, without which the real loop has no PATH and no HOME.
    expect(got.hasPath).toBe(true);
  });

  // The ordering the module argues for at greatest length: under the positive authority rule, a loop that
  // starts while the file still says `idle` has its own first dispatch refused.
  //
  // Observed through the COMMAND FACTORY, which is resolved between the write and the spawn. The child's own
  // reading cannot prove it — node takes tens of milliseconds to start and the write takes one, so planting
  // the two writes into a single one AFTER the spawn left the child still seeing `running`. The factory runs
  // at a point in the server's own control flow, so it either sees `running` or the ordering is wrong.
  it('has already recorded running before the loop is even spawned', async () => {
    const root = await tempDir();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'stopped', reason: 'capped' });
    const seen: string[] = [];
    const log = await logPath();
    const service = new ServiceProcess({
      root: () => root,
      now: () => new Date(),
      credentials: new CredentialStore('admin-token'),
      apiBase: () => 'http://127.0.0.1:4610',
      command: () => {
        seen.push(JSON.parse(readFileSync(join(root, '.vibeboard', 'autopilot-state.json'), 'utf8')).state);
        return { bin: process.execPath, args: [SHIM, log, 'sleep'] };
      },
    });
    onTestFinished(() => {
      service.stop();
    });
    await service.start();
    expect(seen).toEqual(['running']);
    // And the child agrees, which is the thing that actually matters to the loop.
    expect((await recorded(log)).stateAtStart).toBe('running');
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

  // REPLACES rather than refuses, and the difference is a dead end the panel could not explain: press
  // Start, soft-stop, Restart, and the state says `idle` while the old loop is still alive — a soft stop
  // kills nothing. Refusing there meant Start answered "already running" over a project that said idle for
  // as long as the old loop took to notice. Killing it is safe because outside `running` it cannot
  // dispatch and its credential is gone.
  it('replaces a loop this server was still holding, rather than refusing for ever', async () => {
    const { service } = await harness();
    expect((await service.start()).ok).toBe(true);
    const first = service.pgid();
    expect(first).toBeGreaterThan(1);

    const again = await service.start();
    expect(again.ok).toBe(true);
    expect(service.pgid()).not.toBe(first);
    // And the one it replaced is gone, not leaked.
    for (let i = 0; i < 100; i += 1) {
      try {
        process.kill(first ?? 0, 0);
      } catch {
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect.fail(`the replaced loop ${first} is still alive`);
  });

  // The interaction the replacement created: killing the old child fires its own exit handler, and that
  // handler must not write `stopped` over the `running` the replacement has just recorded.
  it('does not let a deliberate stop report itself as a crash', async () => {
    const { root, service } = await harness();
    await service.start();
    await service.start();
    await new Promise((r) => setTimeout(r, 300));
    expect((await readAutopilotState(root, '2026-08-05T10:00:00Z')).state).toBe('running');
  });

  it('spawns nothing into a project that was halted while it was starting', async () => {
    // The endpoint checks `halted` two awaits and five disk reads before the spawn, so this is the last
    // word — the same shape agent-runner.ts uses for a dispatch.
    const { root, service } = await harness();
    const started = service.start();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'halted', reason: 'killed' });
    const result = await started;
    if (result.ok) {
      // The write landed before the halt: the other ordering, and still correct. Nothing to assert but
      // that the loop is running and the state agrees.
      expect((await readAutopilotState(root, 'x')).state).toBe('running');
      return;
    }
    expect(result.error).toMatch(/halted by the time/);
    expect(service.running()).toBe(false);
  });

  it('refuses with a reason when the command cannot be run at all', async () => {
    const { root } = await harness();
    const logged: string[] = [];
    const service = new ServiceProcess({
      root: () => root,
      now: () => new Date(),
      credentials: new CredentialStore('admin-token'),
      apiBase: () => 'http://127.0.0.1:4610',
      command: () => ({ bin: '/nonexistent/loop', args: [] }),
      log: recordingLog(logged),
    });
    const result = await service.start();
    expect(result.ok).toBe(false);
    // The REFUSAL'S WORDS, not merely its falsity. Nothing read them, so `reason: 'complete'` could have
    // been written here — a failed start leaving the project wearing a success verdict, which is exactly
    // what the neighbouring test about clearing a stale reason exists to prevent.
    // The SYNCHRONOUS answer, which is the one the caller gets: it names the program that could not be
    // run, because "the process had no pid" is true and tells a reader nothing. Node's own words arrive a
    // tick later on the `error` event and race this, so they belong in the log and are asserted there.
    expect(result.ok === false && result.error).toBe(
      'Auto-pilot could not be started: /nonexistent/loop could not be run — check that it exists.',
    );
    const state = await readAutopilotState(root, '2026-08-05T10:00:00Z');
    expect(state.state).toBe('stopped');
    expect(state.reason).toBe('stalled');
    expect(state.detail).toContain('could not be started');

    // AND the run stays free of unhandled errors, which is the other half and cannot be asserted from
    // here: `spawn` reports a missing binary on the next tick, so an app with no `error` listener takes
    // the SERVER down. Vitest fails the run on that, but as an error count with no test name attached —
    // so the logged message below is what fails as a named test instead.
    expect(logged.some((line) => line.includes('could not be started'))).toBe(true);
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
    // The WHOLE sentence, including the reason's own prefix from `stopSentence`. `toContain('code 3')`
    // left that composition unheld, and this is a string a person reads in an overlay.
    // The canned half no longer names a restart: this reason covers a server that died, a loop killed from
    // outside and a loop that crashed, and the detail beside it says which. It used to tell someone whose loop
    // had been SIGKILLed that they had restarted something.
    expect(state.detail).toBe(
      'Auto-pilot stopped before it could finish, so it owes this project a checkup. The auto-pilot service exited with code 3 without stopping first, so this project owes a checkup before it resumes.',
    );
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
    // The premise, asserted: without this the test passes on a machine where the child never started at
    // all — proved by planting, which made `running()` permanently false and left this green in 12ms.
    expect(service.running()).toBe(true);
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
    // AND IT IS THERE. The resolution is a string rewrite, so a renamed file or a moved directory would
    // otherwise be found by the first hand-run rather than by the suite — and the failure it produces is a
    // spawn error with no obvious cause.
    expect(existsSync(entry), `${entry} does not exist`).toBe(true);
    for (const flag of process.execArgv) expect(command.args).toContain(flag);
  });
});
