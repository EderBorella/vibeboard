import { type AutopilotState, IDLE_STATE, reconcile } from '../core/autopilot-state.js';
import { type StopReason, stopSentence } from '../core/dispatch-gate.js';
import { readAutopilotState, updateAutopilotState, writeAutopilotState } from './autopilot-store.js';
import type { Log } from './logging.js';
import { isSameGroup } from './process-group.js';

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
  onKill?: (state: AutopilotState) => void | Promise<void>;
  // Called whenever this project stops being `running`, by any of the three stops. Wired to revoking the
  // service's credential: it belongs to no run record, so nothing else would ever expire it, and a token
  // that outlives the state justifying it is a token that can still dispatch (see `dispatchLock`).
  onDispatchingEnded?: () => void;
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
    const next = reconcile(found, at, isSameGroup);
    if (next !== found) {
      await writeAutopilotState(root, next);
      this.#opts.log?.warn(
        { iteration: next.iteration },
        'auto-pilot was running when this server stopped; it owes this project a checkup',
      );
    }
    // A reconcile that changed anything took the loop's authority away, so its credential goes too — the
    // service's token belongs to no run record, so nothing else would ever expire it, and this path was
    // one of three that left a live one behind.
    if (next !== found) this.#opts.onDispatchingEnded?.();
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
  //
  // There is deliberately no `forget()` for a closed project: every path that opens or switches one
  // calls `load()`, which replaces the mirror from the new project's file, and with no project open
  // `current()` answers `IDLE_STATE`. A method nothing calls would be one more thing to keep true.
  isHalted(): boolean {
    return this.#mirror.state === 'halted';
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
      await this.#opts.onKill?.(this.#mirror);
    } catch (err) {
      this.#opts.log?.error({ err }, 'emergency stop could not finish killing this project');
    }
    return { ok: true, state: await this.#stop('killed', detail, 'halted') };
  }

  // The loop's own ending, recorded through the same path as the buttons. A loop that has decided it is
  // `complete`, `capped`, `exhausted`, `stalled` or `no-op` is not asking permission — it has already
  // stopped dispatching — so this records rather than refuses, with one exception: a project that has been
  // HALTED under it keeps the halt, because an emergency stop is not something a loop may overwrite.
  async recordLoopStop(reason: StopReason, detail?: string): Promise<ControlResult> {
    const state = await this.current();
    if (state.state === 'halted') return { ok: false, error: HALTED_FIRST };
    const next = await this.#stop(reason, detail);
    // The credential goes with it. `#stop` revokes only on a halt — deliberately, because a SOFT stop must
    // leave the loop able to finish what is in flight — but a loop reporting its own ending has nothing left
    // to finish, and `expireScope` is documented as running from every path that takes its authority away.
    // This was the one that did not.
    this.#opts.onDispatchingEnded?.();
    return { ok: true, state: next };
  }

  // The way back, and in C2 it is also the CHECKUP'S STAND-IN.
  //
  // `needsCheckup` is set by the startup reconcile, by a crashed loop and by an emergency stop, and until C3
  // exists nothing can clear it — so a project that reached `checkupEvery` once, or survived one crash, could
  // never dispatch again: Start refused, Restart zeroed the counters and set the flag straight back. The only
  // way out was hand-editing `autopilot-state.json`, which no part of the UI offers.
  //
  // So Restart clears it, and the reasoning is that decision 15 asks for a SUPERVISOR PASS before resuming —
  // a person pressing Restart on a board they are looking at is exactly that, and it is the only supervisor
  // this slice has. C3 replaces this with the real checkup, at which point the flag goes back to being the
  // service's to clear.
  //
  // The counters are reset with it, and that is deliberate rather than incidental: Restart is a person
  // deciding to go again, so it is the one place a cap may legitimately be reset. An earlier comment here
  // claimed the `idle` no-op below closed that loophole — it does not, and never did for `stopped`; what it
  // actually prevents is a Restart on an untouched project silently buying a fresh cap.
  async restart(): Promise<ControlResult> {
    const state = await this.current();
    if (state.state === 'running') {
      return {
        ok: false,
        error: 'Auto-pilot is running. Soft-stop it first, or use the emergency stop.',
      };
    }
    // A no-op on a project already idle, as the plan asked. It was not one: resetting `iteration` from
    // idle meant a soft stop AT `maxIterations` followed by Restart bought a fresh cap without anyone
    // raising it — a control that quietly undoes a cap is worse than no control. Nothing to drop and
    // nothing to reset, so the state is returned as it stands.
    if (state.state === 'idle') return { ok: true, state };
    const root = this.#opts.root();
    if (!root) return { ok: false, error: 'No project open' };
    // Written whole rather than merged, with ONE exception. `reason` and `detail` described a stop that is
    // over and the counters belong to a run that has ended, so all four are dropped deliberately.
    //
    // The process group is kept ONLY when restarting from a soft stop, and the distinction is the whole of
    // it. From `halted` the emergency stop has already killed that group, and keeping a dead pgid would
    // point a later reaper at whatever inherited the number — the risk this comment originally named, and
    // real precisely because a `servicePgid` written without a `servicePgstart` is reaped on the weaker
    // "is it still a group leader" test. From `stopped` the opposite holds: a soft stop kills nothing, so
    // the loop may still be alive and mid-tick, and dropping its pgid left the next emergency stop with no
    // target for it at all — the orphan class decision 13 exists for.
    const previous = this.#mirror;
    const keepGroup = previous.state === 'stopped';
    const next: AutopilotState = {
      state: 'idle',
      iteration: 0,
      dispatchesSinceCheckup: 0,
      // Cleared, not set — see the note above. The person pressing this is the supervisor pass.
      needsCheckup: false,
      at: this.#at(),
      ...(keepGroup && previous.servicePgid !== undefined ? { servicePgid: previous.servicePgid } : {}),
      ...(keepGroup && previous.servicePgstart !== undefined
        ? { servicePgstart: previous.servicePgstart }
        : {}),
      // CARRIED, NOT CLEARED, unlike everything else here. Restart resets the loop's counters and lifts
      // a halt — it is not a person saying they have read the commands an agent wrote into
      // foundation/CODE-QUALITY.md. Dropping it would let the sequence "copilot rewrites the gates →
      // Restart → Start" run those commands unsandboxed with nobody having looked, and the person who
      // pressed Restart was answering a different question. Only `gates-reviewed` clears it.
      ...(previous.unreviewedGates?.length ? { unreviewedGates: previous.unreviewedGates } : {}),
    };
    await writeAutopilotState(root, next);
    this.#mirror = next;
    this.#opts.onDispatchingEnded?.();
    this.#opts.onChange?.(next);
    return { ok: true, state: next };
  }

  // Through a READ-MODIFY-WRITE, merging only the four fields this process owns.
  //
  // The module comment in autopilot-store.ts has always said both writers go this way; they did not,
  // and the window is real rather than theoretical. `emergencyStop` reads the state, then awaits the
  // kill — `cancelAll`, `stopOpencodeServer`, `listRuns` over every results folder in the project, and
  // the reaper — which is tens of milliseconds at best and unbounded on a long history. The service is
  // not dead until its group is reaped, so it can tick and record an iteration in that window. Writing
  // a snapshot taken beforehand rolled that counter back, and took any `servicePgid` recorded with it —
  // including, at the worst moment, the pgid the reaper was about to need.
  async #stop(reason: StopReason, detail: string | undefined, state: 'stopped' | 'halted' = 'stopped') {
    const root = this.#opts.root();
    const at = this.#at();
    const decided = { state, reason, detail: stopSentence(reason, detail), at } as const;
    // The mirror moves FIRST and unconditionally: a project whose state file cannot be written is
    // exactly the project that must still behave as halted for the rest of this process's life.
    this.#mirror = { ...this.#mirror, ...decided };
    let next: AutopilotState = this.#mirror;
    if (root) {
      try {
        next = await updateAutopilotState(root, at, (current) => ({ ...current, ...decided }));
        this.#mirror = next;
      } catch (err) {
        this.#opts.log?.error({ err }, 'could not record the auto-pilot stop on disk');
      }
    }
    // NOT on a soft stop. The Stops table promises a soft stop lets in-flight work finish, and the loop
    // needs its credential to do that: to wait for the run record, move the card it has just verified,
    // record the verdict and write the diary line. Revoking there produced a loop that died of a 401
    // mid-dispatch and abandoned exactly the work the soft stop had promised to let it complete.
    // `dispatchLock` already refuses a `service` caller outside `running`, so nothing NEW can start.
    if (state === 'halted') this.#opts.onDispatchingEnded?.();
    this.#opts.onChange?.(next);
    return next;
  }
}
