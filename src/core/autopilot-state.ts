import type { StopReason } from './dispatch-gate.js';
import { STOP_REASONS } from './dispatch-gate.js';

// Auto-pilot's own state, persisted (decision 15). It is the service's file, not board state, and the
// service is its single writer for the counters — so it is written directly rather than through the
// API, which is the one deliberate carve-out in decision 20.
//
// WHO OWNS WHAT, because two processes touch this file:
//   the auto-pilot service  →  iteration, dispatchesSinceCheckup, needsCheckup, servicePgid/-start
//   the main server         →  state, reason, detail, at  (the stops, and the startup reconcile)
// Both go through a read-modify-write (server/autopilot-store.ts), so neither clobbers the other's
// fields, and every write is a rename — so a reader sees one whole state or the other, never half.
//
// The two processes are NOT serialised against each other, and that was ruled rather than overlooked
// (2026-08-05): accepted and documented, not locked. The residual cost is one lost counter increment in
// one window — the server reads the state, the service ticks and writes, the server writes back what it
// read — and that window is the emergency-stop path, where the service is about to be killed and the
// value at risk is the iteration count of a run being abandoned. A lockfile would trade that for a stale
// lock left behind by a killed process, which is the worse failure. See server/write-queue.ts.

export const AUTOPILOT_STATES = ['idle', 'running', 'stopped', 'halted'] as const;
export type AutopilotStateName = (typeof AUTOPILOT_STATES)[number];

export interface AutopilotState {
  state: AutopilotStateName;
  iteration: number; // dispatches this run, compared against maxIterations
  dispatchesSinceCheckup: number; // a counter, not iteration % checkupEvery: the checkup consumes an
  // iteration itself, so a modulo would misfire — and it would fire at zero, before any work exists
  // The checkup is MANDATORY on resume, so this is a fact about the project rather than a preference:
  // set by the startup reconcile, cleared by the service once the checkup has run.
  needsCheckup: boolean;
  reason?: StopReason; // why it stopped, or why it is halted
  detail?: string; // the sentence a person reads — the specifics the reason cannot carry
  at?: string; // when this state was entered; the overlay's timestamp
  // The auto-pilot service's own process group, recorded by the service when it starts. Read here so
  // an emergency stop can take the service down with everything else, and preserved by the reconcile
  // because the reaper runs straight after it.
  //
  // `servicePgstart` is the same pid-reuse guard the run records carry, and slice C should record both.
  // Where it is absent the reaper falls back to requiring the pid to still BE a group leader — weaker,
  // and allowed only here, because this group is killed by the server that spawned it rather than by
  // one reading a file written long ago.
  servicePgid?: number;
  servicePgstart?: number;
}

export const IDLE_STATE: AutopilotState = {
  state: 'idle',
  iteration: 0,
  dispatchesSinceCheckup: 0,
  needsCheckup: false,
};

// A whole number at or above zero. `iteration` is compared with `>=` against the cap, so a fractional
// value is a threshold the comparison steps straight over and a negative one buys extra dispatches.
function counter(value: unknown): number | undefined {
  if (value === undefined) return 0;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isState(value: unknown): value is AutopilotStateName {
  return typeof value === 'string' && (AUTOPILOT_STATES as readonly string[]).includes(value);
}

function isReason(value: unknown): value is StopReason {
  return typeof value === 'string' && (STOP_REASONS as readonly string[]).includes(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

// `'unreadable'` rather than a default, because the caller must be able to tell an absent file from a
// damaged one: the first starts fresh and the second halts (S13). A single return type carrying both
// would collapse the distinction the fail-closed rule depends on.
export function parseState(content: string): AutopilotState | 'unreadable' {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return 'unreadable';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'unreadable';
  const d = parsed as Record<string, unknown>;
  if (!isState(d.state)) return 'unreadable';
  const iteration = counter(d.iteration);
  const dispatchesSinceCheckup = counter(d.dispatchesSinceCheckup);
  if (iteration === undefined || dispatchesSinceCheckup === undefined) return 'unreadable';
  const pgid = d.servicePgid;
  return {
    state: d.state,
    iteration,
    dispatchesSinceCheckup,
    needsCheckup: d.needsCheckup === true,
    // Dropped, not refused: the reason is what the overlay SHOWS, and losing the label is a far
    // better outcome than losing the halt it labels.
    ...(isReason(d.reason) ? { reason: d.reason } : {}),
    ...(text(d.detail) ? { detail: text(d.detail) } : {}),
    ...(text(d.at) ? { at: text(d.at) } : {}),
    ...(typeof pgid === 'number' && Number.isInteger(pgid) && pgid > 1 ? { servicePgid: pgid } : {}),
    ...(typeof d.servicePgstart === 'number' && Number.isInteger(d.servicePgstart) && d.servicePgstart > 0
      ? { servicePgstart: d.servicePgstart }
      : {}),
  };
}

export function serializeState(state: AutopilotState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

// What a state found on disk means once the process that wrote it is gone.
//
// `running` cannot be true: the service and every agent were this server's children and died with
// it. It becomes `stopped`, and it owes the project a checkup — resuming dispatch would be acting on
// the assumption that runs nobody is watching are still going.
//
// `halted` is returned untouched. That is the whole reason this file is persisted: a restart must not
// be a way out of it.
export function reconcile(state: AutopilotState, at: string): AutopilotState {
  if (state.state !== 'running') return state;
  return {
    ...state,
    state: 'stopped',
    reason: 'interrupted',
    needsCheckup: true,
    at,
  };
}
