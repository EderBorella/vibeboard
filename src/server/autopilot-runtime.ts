import { type AutopilotState, IDLE_STATE, reconcile } from '../core/autopilot-state.js';
import { type StopReason, stopSentence } from '../core/dispatch-gate.js';
import { readAutopilotState, writeAutopilotState } from './autopilot-store.js';
import type { Log } from './logging.js';

// The three levels of stopping (decision 12), and the live answer to "is this project halted?".
//
//   Soft stop       auto-pilot stops dispatching; the app is untouched
//   Emergency stop  everything project-related dies; the project enters `halted`
//   Restart         returns the project to `idle` — chat, manual runs and the board all work again,
//                   with auto-pilot still off until it is started separately
//
// Two ways to read the state, deliberately:
//
//   `current()` reads the FILE. It is authoritative, because the auto-pilot service writes its own
//   counters there and this process cannot see those writes. Every refusal uses it.
//
//   `isHalted()` reads the in-memory mirror and is synchronous, for the one caller that cannot await:
//   the lazy `opencode serve` spawn, which sits inside a promise chain several layers down. Only this
//   process ever writes `halted`, so the mirror cannot be wrong about it — and the async refusals in
//   front of that path check `current()` anyway, so the sync gate is the second line, not the only one.

export interface AutopilotRuntimeOptions {
  root: () => string | undefined;
  now: () => Date;
  // Pushed to every client, so an emergency stop in one tab raises the overlay in the others. The
  // state file is deliberately not watched (session.ts) — its counters change once per dispatch.
  onChange?: (state: AutopilotState) => void;
  // Everything an emergency stop must take down: the runner's agents, the managed OpenCode server,
  // and the recorded process groups. Injected rather than imported, so this class does not reach into
  // the runner and can be tested without one.
  onKill?: () => void | Promise<void>;
  log?: Log;
}

// Why an action was refused, or nothing when it was performed. A sentence rather than a code: the
// refusals reach a person, and every one of them has to say what to do instead.
export type ControlResult = { ok: true; state: AutopilotState } | { ok: false; error: string };

const HALTED_FIRST =
  'This project is halted. Restart it from the auto-pilot panel before doing anything else here.';

export class AutopilotRuntime {
  #opts: AutopilotRuntimeOptions;
  // Last known state. Only ever behind on the counters, which no refusal depends on.
  #mirror: AutopilotState = IDLE_STATE;

  constructor(opts: AutopilotRuntimeOptions) {
    this.#opts = opts;
  }

  #at(): string {
    return this.#opts.now().toISOString();
  }

  // Called when a project opens. Reads the state, reconciles it, and writes back only if the
  // reconcile changed something: a `running` state found on disk had its children die with the
  // server that wrote it, so it becomes `stopped` and owes the project a checkup.
  async load(): Promise<AutopilotState> {
    const root = this.#opts.root();
    if (!root) {
      this.#mirror = IDLE_STATE;
      return IDLE_STATE;
    }
    const at = this.#at();
    const found = await readAutopilotState(root, at);
    const next = reconcile(found, at);
    if (next !== found) {
      await writeAutopilotState(root, next);
      this.#opts.log?.warn(
        { iteration: next.iteration },
        'auto-pilot was running when this server stopped; it owes this project a checkup',
      );
    }
    this.#mirror = next;
    return next;
  }

  // Authoritative. Refreshes the mirror as a side effect, so the sync gate below drifts for as short
  // a time as possible.
  async current(): Promise<AutopilotState> {
    const root = this.#opts.root();
    if (!root) return IDLE_STATE;
    this.#mirror = await readAutopilotState(root, this.#at());
    return this.#mirror;
  }

  // Synchronous, and only for callers that cannot await — see the note at the top of this file.
  isHalted(): boolean {
    return this.#mirror.state === 'halted';
  }

  state(): AutopilotState {
    return this.#mirror;
  }

  // Auto-pilot stops dispatching. Nothing dies, nothing is killed, and the app carries on.
  async softStop(detail?: string): Promise<ControlResult> {
    const state = await this.current();
    // Refused rather than applied: writing `stopped` over `halted` would silently undo an emergency
    // stop, and the overlay — the only thing telling the user why the project is stopped — would
    // disappear without anyone deciding it should.
    if (state.state === 'halted') return { ok: false, error: HALTED_FIRST };
    return { ok: true, state: await this.#stop('stopped', detail) };
  }

  // Everything project-related dies and the project enters `halted`. While halted nothing dispatches
  // and NOTHING RESPAWNS LAZILY — without that second half the Restart button would be decorative,
  // because the next chat message would quietly bring `opencode serve` back.
  async emergencyStop(detail?: string): Promise<ControlResult> {
    // Read before killing, so the iteration count recorded with the halt is the one the service had
    // reached rather than whatever this process last saw.
    await this.current();
    // The kill runs FIRST and its failure does not stop the state being written. A halt that killed
    // some of the processes but recorded nothing would leave the app looking fine over a project whose
    // agents are gone — the worst of both.
    try {
      await this.#opts.onKill?.();
    } catch (err) {
      this.#opts.log?.error({ err }, 'emergency stop could not finish killing this project');
    }
    return { ok: true, state: await this.#stop('killed', detail, 'halted') };
  }

  // The way back. Counters reset because the next start is a new run, and `needsCheckup` is SET
  // rather than cleared: after an emergency stop the board is in a state nobody has looked at, and
  // the checkup is mandatory on resume anyway (decision 15).
  async restart(): Promise<ControlResult> {
    const state = await this.current();
    if (state.state === 'running') {
      return {
        ok: false,
        error: 'Auto-pilot is running. Soft-stop it first, or use the emergency stop.',
      };
    }
    const root = this.#opts.root();
    if (!root) return { ok: false, error: 'No project open' };
    // Written whole rather than merged, because everything the previous state held is deliberately
    // dropped: `reason` and `detail` described a stop that is over, and `servicePgid` named a process
    // the emergency stop already killed — kept, it would point the next reaper at a pid that by then
    // belongs to something else.
    const next: AutopilotState = {
      state: 'idle',
      iteration: 0,
      dispatchesSinceCheckup: 0,
      needsCheckup: true,
      at: this.#at(),
    };
    await writeAutopilotState(root, next);
    this.#mirror = next;
    this.#opts.onChange?.(next);
    return { ok: true, state: next };
  }

  // A project closed. The mirror must not keep answering for it — the next project's first read is
  // async, and until it lands `isHalted()` would be speaking about a project nobody has open.
  forget(): void {
    this.#mirror = IDLE_STATE;
  }

  async #stop(reason: StopReason, detail: string | undefined, state: 'stopped' | 'halted' = 'stopped') {
    const root = this.#opts.root();
    const at = this.#at();
    const next: AutopilotState = {
      ...this.#mirror,
      state,
      reason,
      detail: stopSentence(reason, detail),
      at,
    };
    // Best effort on the write, never on the mirror: a project whose state file cannot be written is
    // exactly the project that must still behave as halted for the rest of this process's life.
    this.#mirror = next;
    if (root) {
      try {
        await writeAutopilotState(root, next);
      } catch (err) {
        this.#opts.log?.error({ err }, 'could not record the auto-pilot stop on disk');
      }
    }
    this.#opts.onChange?.(next);
    return next;
  }
}
