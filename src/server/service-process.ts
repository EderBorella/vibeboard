import { type ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { AutopilotState } from '../core/autopilot-state.js';
import { stopSentence } from '../core/dispatch-gate.js';
import { updateAutopilotState } from './autopilot-store.js';
import type { CredentialStore } from './credentials.js';
import type { Log } from './logging.js';
import { groupStartTime } from './process-group.js';

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

export interface ServiceStartOk {
  ok: true;
  state: AutopilotState;
}
export interface ServiceStartFailed {
  ok: false;
  error: string;
}
export type ServiceStartResult = ServiceStartOk | ServiceStartFailed;

// What to run, and where the loop should call back to. Injected as a whole so a test can put a shim in
// place of the real entry point and read back exactly what the process was given — the same way the
// agent tests assert what reaches a backend.
export interface ServiceCommand {
  bin: string;
  args: string[];
}

export interface ServiceProcessOptions {
  root: () => string | undefined;
  now: () => Date;
  credentials: CredentialStore;
  // Where the service should reach this server. A URL rather than a port, because a project opened over
  // the LAN and one opened on localhost are the same code with different origins.
  apiBase: () => string;
  command?: () => ServiceCommand;
  log?: Log;
  // Told when the child ends without the loop having recorded a stop — see `#supervise`.
  onStopped?: (state: AutopilotState) => void;
}

// The loop's entry point, resolved beside this module rather than from the working directory: the
// server is started from anywhere, and `dist/server/service-process.js` and `src/server/…ts` both have
// the loop as a sibling directory.
//
// `process.execArgv` is carried over so the same thing that loads THIS file loads that one — under
// `tsx watch` the entry is a `.ts` file and needs the loader flags that got us here, and in a built
// tree there are none to carry.
export function defaultServiceCommand(): ServiceCommand {
  const here = fileURLToPath(import.meta.url);
  const entry = here.replace(/([\\/])server([\\/])service-process\.(ts|js)$/, '$1service$2main.$3');
  return { bin: process.execPath, args: [...process.execArgv, entry] };
}

export class ServiceProcess {
  #opts: ServiceProcessOptions;
  #child: ChildProcess | undefined;

  constructor(opts: ServiceProcessOptions) {
    this.#opts = opts;
  }

  // Whether THIS process is holding the loop. Not the same question as "is the state running": a state
  // file can say `running` after the server that wrote it died, which is what the startup reconcile is
  // for. Used by the start endpoint to refuse a second child rather than leak the first.
  running(): boolean {
    return this.#child !== undefined && this.#child.exitCode === null && !this.#child.killed;
  }

  async start(): Promise<ServiceStartResult> {
    const root = this.#opts.root();
    if (!root) return { ok: false, error: 'No project open' };
    if (this.running()) {
      return { ok: false, error: 'Auto-pilot is already running in this server.' };
    }

    // Minted per session, not per tick, and it is the service's whole authority: `POST /api/runs`,
    // `POST /api/log`, `GET /api/accounting`, and moving a card. Nothing survives this server, because
    // the store is in memory — a loop cannot outlive the process that started it.
    const credential = this.#opts.credentials.mintRun('service', serviceRunId(this.#opts.now()), root);
    const command = (this.#opts.command ?? defaultServiceCommand)();

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

    let child: ChildProcess;
    try {
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
        // `ignore` rather than a pipe: nothing reads these, and an unread pipe eventually blocks the
        // writer. What the loop has to say, it says in the diary and the state file.
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    } catch (err) {
      return this.#couldNotStart(root, String(err));
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
      if (this.#child === child) this.#child = undefined;
      void this.#couldNotStart(root, String(err));
    });

    if (child.pid === undefined) {
      return this.#couldNotStart(root, 'the process had no pid');
    }
    this.#child = child;
    // Nothing holds the server open on its account. The child is detached and supervised; a reference
    // from the event loop would keep this process alive for as long as the loop runs.
    child.unref();

    const at = this.#opts.now().toISOString();
    const pgstart = groupStartTime(child.pid);
    // Read-modify-write, and only the fields this process owns (decision 20): `state` and the pgid are
    // the server's, the counters are the service's. Written BEFORE the loop can tick, so an emergency
    // stop arriving immediately still finds a group to reap.
    //
    // `reason` and `detail` are CLEARED. They described a stop that is over, and `decideTick` echoes a
    // stored reason back for any non-running state — including `complete` — so a fresh run must not
    // start out wearing the last one's verdict.
    const state = await updateAutopilotState(root, at, (current) => ({
      ...current,
      at,
      servicePgid: child.pid,
      ...(pgstart === undefined ? {} : { servicePgstart: pgstart }),
    }));
    this.#opts.log?.info({ pid: child.pid, pgstart }, 'auto-pilot service started');
    this.#supervise(child, root);
    return { ok: true, state };
  }

  async #couldNotStart(root: string, why: string): Promise<ServiceStartFailed> {
    const at = this.#opts.now().toISOString();
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
            `The auto-pilot service ${how} without stopping first, so this project owes a checkup before it resumes.`,
          ),
          // The same reasoning as the startup reconcile: dispatches nobody was watching may be in
          // flight, and resuming without a supervisor pass would be acting on the assumption they went
          // fine.
          needsCheckup: true,
          at,
        };
      });
      if (unexpected) {
        this.#opts.log?.error({ code, signal }, 'the auto-pilot service died without stopping first');
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
