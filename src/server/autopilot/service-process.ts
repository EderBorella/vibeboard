import { type ChildProcess, spawn } from 'node:child_process';
import { closeSync, existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AutopilotState } from '../../core/autopilot-state.js';
import { stopSentence } from '../../core/dispatch-gate.js';
import { groupStartTime, terminateGroup } from '../../exec/process-group.js';
import { updateAutopilotState } from '../../store/autopilot-store.js';
import type { CredentialStore } from '../auth/credentials.js';
import { type AutopilotLogTarget, type Log, openAutopilotLog } from '../logging.js';

// Starting, and outliving, the process that walks the board.
//
// The loop is a SEPARATE PROCESS (decision 20) that reaches this server over HTTP with a `service`
// credential, exactly as an agent does. This module is the only thing that knows how to bring it up:
// what to spawn, what it may see in its environment, and what to write down so an emergency stop can
// find it again.
//
// THREE decisions worth stating, because each one is the opposite of what the code around it does:
//
// 1. NOT SANDBOXED. Every agent runs inside the AppArmor profile; the service must not, because it
//    writes `autopilot-state.json` — the counters are its own — and the profile denies exactly that to
//    every confined process. The service runs no model and executes nothing a card asked for: it reads
//    the board, asks a pure function what to do, and calls endpoints. The confinement that matters for
//    it is the SCOPE TABLE, not the filesystem.
// 2. DETACHED, so it leads its own process group and an emergency stop can take down whatever it
//    started along with it (decision 13). The pgid and its start time are written to the state file,
//    because the reaper that needs them may be in a later server process than the one that spawned it.
// 3. NOT AWAITED. `start` returns once the child exists and the state says `running`. Waiting for the
//    loop would be waiting for the whole project to finish.

interface ServiceStartOk {
  ok: true;
  state: AutopilotState;
}
interface ServiceStartFailed {
  ok: false;
  error: string;
}
type ServiceStartResult = ServiceStartOk | ServiceStartFailed;

// What to run, and where the loop should call back to. Injected as a whole so a test can put a shim in
// place of the real entry point and read back exactly what the process was given — the same way the
// agent tests assert what reaches a backend.
export interface ServiceCommand {
  bin: string;
  args: string[];
}

interface ServiceProcessOptions {
  root: () => string | undefined;
  now: () => Date;
  credentials: CredentialStore;
  // Where the service should reach this server. A URL rather than a port, because a project opened over
  // the LAN and one opened on localhost are the same code with different origins.
  apiBase: () => string;
  command?: () => ServiceCommand;
  // Whether to keep the loop's ORDINARY output as well as its errors — the app-level debug setting. Asked
  // at every start rather than captured, so the toggle takes effect on the next Start rather than at the
  // next restart. Absent means off, which is what every test that is about something else wants.
  debugLog?: () => Promise<boolean>;
  // Where that output goes, injected so a test can point it somewhere it can read. Absent means the
  // install's own log directory, and `undefined` from it means write no file at all.
  openLog?: (what: string) => AutopilotLogTarget | undefined;
  log?: Log;
  // Told when the child ends without the loop having recorded a stop — see `#supervise`.
  onStopped?: (state: AutopilotState) => void;
  // Called when the loop's authority ends by a path that does not go through `AutopilotRuntime`. Wired to
  // revoking its credential, so the token cannot outlive the state that justifies it.
  onDispatchingEnded?: () => void;
}

// The loop's entry point, resolved from this module's own location rather than from the working
// directory, because the server is started from anywhere.
//
// IT CLIMBS, and that matters more than it looks. This used to be a string rewrite of `here` that
// hard-coded BOTH the directory this module sat in and its own filename
// (`server/service-process` → `service/main`), so the moment either changed the replace matched
// nothing, the "entry" became this module's own path, and auto-pilot spawned the wrong file. Nothing
// type-checks a string, and the spawn failure surfaces nowhere near the cause. Climbing to whichever
// ancestor actually holds `service/main<ext>` cannot be invalidated by depth or by a rename here, and
// `test/service-process.test.ts` asserts the resolved path EXISTS ON DISK — the one check a wrong
// path cannot pass.
//
// The extension comes from this module's own, not from a guess: under `tsx watch` both files are
// `.ts`, in `dist/` both are `.js`, and there is never a mix. For the same reason `process.execArgv`
// is carried over — the thing that loaded THIS file has to load that one, which under tsx means the
// loader flags and in a built tree means nothing at all.
function resolveLoopEntry(here: string): string {
  const ext = extname(here);
  let dir = dirname(here);
  let parent = dirname(dir);
  while (parent !== dir) {
    const candidate = join(dir, 'service', `main${ext}`);
    if (existsSync(candidate)) return candidate;
    dir = parent;
    parent = dirname(dir);
  }
  // Nothing found on the way up. Answer with the nearest candidate rather than throwing, so the
  // failure arrives as a spawn error naming a path instead of out of a `start()` the caller is
  // awaiting for an answer about the loop.
  return join(dirname(here), 'service', `main${ext}`);
}

export function defaultServiceCommand(): ServiceCommand {
  const entry = resolveLoopEntry(fileURLToPath(import.meta.url));
  return { bin: process.execPath, args: [...process.execArgv, entry] };
}

export class ServiceProcess {
  #opts: ServiceProcessOptions;
  #child: ChildProcess | undefined;
  // Children this object killed ON PURPOSE. Their exit is not news, and recording it would be actively
  // wrong: a deliberate stop is followed either by a state the caller is about to write, or by a replacement
  // start whose `running` the supervisor would otherwise overwrite with `stopped` a moment later. Found by
  // the tests the moment `start` began replacing a stale child instead of refusing.
  #deliberate = new WeakSet<ChildProcess>();

  constructor(opts: ServiceProcessOptions) {
    this.#opts = opts;
  }

  // Whether THIS process is holding the loop. Not the same question as "is the state running": a state
  // file can say `running` after the server that wrote it died, which is what the startup reconcile is
  // for. Used by the start endpoint to refuse a second child rather than leak the first.
  running(): boolean {
    // The handle ALONE, deliberately. It used to also test `exitCode === null && !killed`, and planting
    // showed neither half could be reached: `stop()` clears the handle before signalling, and the exit
    // handler clears it on the way out. Two conditions nothing can distinguish are a claim, not a check.
    return this.#child !== undefined;
  }

  // The recorded group, for a caller that has to take it down. `undefined` when this server is not
  // holding a child — a state file naming a group from a previous server is the reaper's business, not
  // this object's.
  pgid(): number | undefined {
    return this.running() ? this.#child?.pid : undefined;
  }

  // Take the loop down, and everything it started with it. Called from every way the SERVER ends: a
  // detached child is not killed by a terminal's Ctrl-C, is not reached by SIGHUP, and is reparented to
  // init when its parent goes — so without this the loop keeps ticking against a port nothing is
  // listening on. That is exactly the orphan class decision 13 exists for, and the comment in
  // `core/autopilot-state.ts` claiming the service "died with the server" was simply false.
  stop(): boolean {
    const child = this.#child;
    const pid = child?.pid;
    this.#child = undefined;
    if (child) this.#deliberate.add(child);
    if (pid === undefined) return false;
    // The GROUP, not the child: the loop's own children (none today, an agent-spawning tick tomorrow)
    // have to go with it.
    return terminateGroup(pid);
  }

  async start(): Promise<ServiceStartResult> {
    const root = this.#opts.root();
    if (!root) return { ok: false, error: 'No project open' };

    // A child we are still holding is REPLACED, not a reason to refuse. Refusing produced a dead end the
    // panel could not explain: press Start, soft-stop, Restart — the state is `idle`, the loop is still
    // alive because a soft stop kills nothing, and Start then answered "already running in this server"
    // over a project that said idle, for as long as the old loop took to notice (up to a run timeout).
    //
    // Killing it is safe precisely because of the authority rules: outside `running` the old loop cannot
    // dispatch (`dispatchLock`) and its credential is revoked on a halt or a restart. The STATE decides
    // whether a loop should exist, and the endpoint has already checked it.
    if (this.running()) {
      this.#opts.log?.warn({ pid: this.#child?.pid }, 'replacing an auto-pilot loop this server still held');
      this.stop();
    }

    // Minted per session, not per tick, and it is the service's whole authority: `POST /api/runs`,
    // `POST /api/log`, `GET /api/accounting`, and moving a card. Nothing survives this server, because
    // the store is in memory — a loop cannot outlive the process that started it.
    const credential = this.#opts.credentials.mintRun('service', serviceRunId(this.#opts.now()), root);

    // RUNNING FIRST, BEFORE THE CHILD EXISTS. The service's authority to dispatch is co-terminous with
    // this state (see `dispatchLock`), so a loop that started while the file still said `idle` would have
    // its own first tick refused. The pgid cannot be written yet — there is no process — so this is two
    // writes rather than one, and the window between them holds a state that says running with no group
    // recorded. That window contains no child either, so an emergency stop arriving inside it has nothing
    // to reap and loses nothing.
    //
    // `reason` and `detail` are cleared here: they described a stop that is over, and `decideTick` echoes
    // a stored reason back for any non-running state — `complete` included — so a fresh run must not
    // start out wearing the last one's verdict.
    const startedAt = this.#opts.now().toISOString();
    await updateAutopilotState(root, startedAt, (current) => ({
      ...current,
      state: 'running',
      reason: undefined,
      detail: undefined,
      at: startedAt,
    }));

    // WHERE THE LOOP'S OUTPUT GOES, opened before the spawn because the descriptor is what the child is
    // handed. Both halves matter and they are not the same decision:
    //
    //   stderr is ALWAYS kept. `src/service/main.ts` refuses to start on a missing environment variable or
    //   a board it cannot read, and both `console.error` and exit 2 — so with stderr discarded those two
    //   failures left no trace anywhere: no state, no diary, no log. Pressing Start did nothing, visibly.
    //   That is the hole this exists to close, and a setting defaulting to off would not close it.
    //
    //   stdout is kept only when the debug setting is on. It is the per-tick narrative — useful when you are
    //   debugging the loop, noise for the rest of the time.
    const target = (this.#opts.openLog ?? openAutopilotLog)(`auto-pilot starting for ${root}`);
    const verbose = target === undefined ? false : ((await this.#opts.debugLog?.()) ?? false);

    let child: ChildProcess;
    let command: ServiceCommand;
    try {
      // Resolved here, AFTER the state says `running` — which also makes it the seam a test can observe the
      // ordering through, since a factory called at this point can read the file the loop is about to read.
      command = (this.#opts.command ?? defaultServiceCommand)();
      child = spawn(command.bin, command.args, {
        cwd: root,
        env: {
          ...process.env,
          VIBEBOARD_SERVICE_TOKEN: credential.token,
          VIBEBOARD_API_BASE: this.#opts.apiBase(),
          VIBEBOARD_PROJECT_ROOT: root,
        },
        // See the header: its own group, so an emergency stop reaches everything it started.
        detached: true,
        // A FILE, never a pipe. A pipe needs a reader and this process has none, so it would fill and then
        // block the loop for ever — which is why this was `ignore` before there was a file to point at.
        stdio: ['ignore', target && verbose ? target.fd : 'ignore', target ? target.fd : 'ignore'],
      });
    } catch (err) {
      return this.#couldNotStart(root, String(err));
    } finally {
      // The child holds its own duplicate from here on. Ours is closed whether the spawn worked or threw —
      // one descriptor leaked per Start would otherwise accumulate for the life of the server.
      if (target) closeSync(target.fd);
    }
    // ASYNCHRONOUS failures. `spawn` does not throw for a missing or unrunnable entry point — it emits
    // `error` on the next tick — so the try/catch above cannot see it, and with no listener attached that
    // becomes an UNHANDLED EXCEPTION and takes the whole server down. Which is the exact opposite of this
    // module's one contract, and it was the project's own suite that caught it: an unhandled error fails
    // the run even when every assertion passes.
    //
    // `#couldNotStart` is safe to reach twice — from the pid check below and again from here — because it
    // only writes over a state that still says `running`.
    child.on('error', (err) => {
      this.#opts.log?.error({ err }, 'the auto-pilot service could not be started');
      void this.#couldNotStart(root, String(err), child);
      if (this.#child === child) this.#child = undefined;
    });

    if (child.pid === undefined) {
      return this.#couldNotStart(root, `${command.bin} could not be run — check that it exists`, child);
    }
    this.#child = child;
    // Nothing holds the server open on its account. The child is detached and supervised; a reference
    // from the event loop would keep this process alive for as long as the loop runs.
    child.unref();

    const at = this.#opts.now().toISOString();
    const pgstart = groupStartTime(child.pid);
    // Read-modify-write, and only the fields this process owns (decision 20): `state` and the pgid are
    // the server's, the counters are the service's. The group is recorded as soon as there is one, so an
    // emergency stop arriving a moment later has something to reap.
    const state = await updateAutopilotState(root, at, (current) => ({
      ...current,
      at,
      servicePgid: child.pid,
      ...(pgstart === undefined ? {} : { servicePgstart: pgstart }),
    }));
    // THE LAST WORD, on the far side of every await — the same shape `agent-runner.ts` uses for a
    // dispatch, and for the same reason. The endpoint checked `halted` two awaits and five disk reads
    // ago; an emergency stop landing in between would otherwise leave a loop spawned into a halted
    // project, reported as a success, with its pgid recorded beside `halted`.
    //
    // The state that came BACK is what decides, not one read again: it is the result of the same
    // read-modify-write that recorded the group, so nothing can have moved between them.
    if (state.state !== 'running') {
      this.stop();
      return {
        ok: false,
        error: `Auto-pilot was ${state.state} by the time its loop started, so the loop was stopped again.`,
      };
    }
    this.#opts.log?.info({ pid: child.pid, pgstart }, 'auto-pilot service started');
    this.#supervise(child, root);
    return { ok: true, state };
  }

  // Guarded on WHICH ATTEMPT failed, not merely on the state. `spawn` emits `error` on the next tick, so a
  // late failure from attempt N could otherwise write `stopped` over attempt N+1's healthy `running` and
  // hand the loop a stop naming a failure that was not its own.
  async #couldNotStart(root: string, why: string, child?: ChildProcess): Promise<ServiceStartFailed> {
    const at = this.#opts.now().toISOString();
    if (child !== undefined && this.#child !== undefined && this.#child !== child) {
      return { ok: false, error: `Auto-pilot could not be started: ${why}.` };
    }
    const error = `Auto-pilot could not be started: ${why}.`;
    try {
      await updateAutopilotState(root, at, (current) =>
        current.state === 'running'
          ? { ...current, state: 'stopped', reason: 'stalled', detail: error, at }
          : current,
      );
    } catch (err) {
      this.#opts.log?.error({ err }, 'could not undo the running state after a failed service start');
    }
    return { ok: false, error };
  }

  // A dead loop must not leave the project reading `running` for ever. The state is what the overlay,
  // the play button and every refusal are derived from, so a child that dies without recording a stop —
  // crashed, killed from outside, or a bug — has to be noticed here.
  //
  // Guarded on the state as it is NOW rather than on anything remembered: the ordinary ending is the
  // loop writing its own stop and then exiting, and overwriting that would replace a real reason
  // (`complete`, `capped`, `exhausted`) with a generic one.
  #supervise(child: ChildProcess, root: string): void {
    child.on('exit', (code, signal) => {
      if (this.#child === child) this.#child = undefined;
      // A stop we asked for is not an unexpected exit.
      if (this.#deliberate.has(child)) return;
      void this.#recordUnexpectedExit(root, code, signal);
    });
  }

  async #recordUnexpectedExit(
    root: string,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    const at = this.#opts.now().toISOString();
    try {
      let unexpected = false;
      const state = await updateAutopilotState(root, at, (current) => {
        // Anything but `running` means someone already said why this ended: the loop's own stop, a soft
        // stop, or an emergency stop. Left exactly as it is.
        if (current.state !== 'running') return current;
        unexpected = true;
        const how = signal ? `was killed by ${signal}` : `exited with code ${code}`;
        return {
          ...current,
          state: 'stopped',
          reason: 'interrupted',
          detail: stopSentence(
            'interrupted',
            // NOT "so this project owes a checkup before it resumes". Nothing owed one even when it said
            // so: `stateConflict` stopped refusing an interrupted project when the periodic checkup
            // retired (decision 47), so Start resumes at whatever phase the board derives.
            `The auto-pilot service ${how} without stopping first, and the work it was in the middle of is unfinished.`,
          ),
          at,
          // The group is GONE, so the number must go with it. Left behind it named a process that no
          // longer exists, and a later reaper reading a pgid whose start time is absent falls back to the
          // weaker "is it still a group leader" test — which is decision 13's pid-reuse hazard, kept alive
          // by bookkeeping rather than by anything real.
          servicePgid: undefined,
          servicePgstart: undefined,
        };
      });
      if (unexpected) {
        this.#opts.log?.error({ code, signal }, 'the auto-pilot service died without stopping first');
        // The credential dies with the loop. This path writes the state directly rather than through
        // `AutopilotRuntime`, so it was one of the three stops that left a live `service` token behind —
        // and a live token can still move cards and write diary lines, none of which is behind the
        // dispatch lock.
        this.#opts.onDispatchingEnded?.();
        this.#opts.onStopped?.(state);
      }
    } catch (err) {
      this.#opts.log?.error({ err }, 'could not record the auto-pilot service exit');
    }
  }
}

// Not a run, but it needs a handle the credential store can expire and a log line can name. Seconds
// are enough: one server starts the loop once at a time, and `running()` refuses a second.
function serviceRunId(now: Date): string {
  return `service-${now.toISOString().replace(/[-:.]/g, '').slice(0, 15)}`;
}
