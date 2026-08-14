import { isStopReason, type StopReason } from './dispatch-gate.js';
import { asText } from './parse.js';
import { oneOf } from './types.js';

// Auto-pilot's own state, persisted (decision 15). It is the service's file, not board state, and the
// service is its single writer for the counters — so it is written directly rather than through the
// API, which is the one deliberate carve-out in decision 20.
//
// WHO OWNS WHAT, because two processes touch this file:
//   the auto-pilot service  →  iteration
//   the main server         →  state, reason, detail, at, servicePgid, servicePgstart
//
// There is no longer a field both write. `needsCheckup` was one — set by the server, cleared by the
// service — and it retired with the periodic checkup (decision 47).
//
// The pgid pair moved to the server's row in C2, and this table said the service owned it. Writing it from
// the server is the better choice — the alternative leaves a window in which an emergency stop has no group
// to reap, because the service cannot record a pid before it exists — but the ruling's safety argument is
// "the fields are disjoint and each write is a read-modify-write", so the split has to be written down
// correctly or the next writer will honour the wrong half.
// Both go through a read-modify-write (store/autopilot-store.ts), so neither clobbers the other's
// fields, and every write is a rename — so a reader sees one whole state or the other, never half.
//
// The two processes are NOT serialised against each other, and that was ruled rather than overlooked
// (2026-08-05): accepted and documented, not locked. The residual cost is one lost counter increment in
// one window — the server reads the state, the service ticks and writes, the server writes back what it
// read — and that window is the emergency-stop path, where the service is about to be killed and the
// value at risk is the iteration count of a run being abandoned. A lockfile would trade that for a stale
// lock left behind by a killed process, which is the worse failure. See store/write-queue.ts.

export const AUTOPILOT_STATES = ['idle', 'running', 'stopped', 'halted'] as const;
export type AutopilotStateName = (typeof AUTOPILOT_STATES)[number];

export interface AutopilotState {
  state: AutopilotStateName;
  iteration: number; // dispatches this run, compared against maxIterations
  reason?: StopReason; // why it stopped, or why it is halted
  detail?: string; // the sentence a person reads — the specifics the reason cannot carry
  at?: string; // when this state was entered; the overlay's timestamp
  // The loop's process group, recorded by THE SERVER when it spawns it — see the table above. Read back so
  // an emergency stop, in this server process or a later one, can take the loop down with everything it
  // started.
  //
  // `servicePgstart` is the same pid-reuse guard the run records carry, and both are always written
  // together. The reaper's weaker fallback — requiring the pid to still BE a group leader — is therefore
  // unreachable for this target, and `reconcile` refuses to treat a pgid without a start time as
  // identifiable at all.
  servicePgid?: number;
  servicePgstart?: number;
  // WHICH GATE DOCUMENTS AN AGENT HAS REWRITTEN AND NOBODY HAS READ YET.
  //
  // `foundation/CODE-QUALITY.md` and `foundation/TESTING.md` do not merely describe the gates — they
  // carry the commands, and those run through `/bin/sh` UNSANDBOXED, as the server's own user
  // (exec/commands.ts). So an agent that writes one has chosen code that will later execute outside
  // the confinement everything else about it is built on.
  //
  // The write is allowed; the EXECUTION waits. Auto-pilot refuses to start while this is non-empty,
  // naming the files, and `POST /api/autopilot/gates-reviewed` clears it. Set only when the writer was
  // not the admin — editing your own gates in Project Control blocks nothing.
  //
  // It lives here because this file is server-owned machine state that the profile already denies to
  // every agent. A new file would NOT be denied: the profile's own comment says denying the folder
  // "does not deny creating things inside it — those are mediated on their own paths".
  unreviewedGates?: string[];
}

export const IDLE_STATE: AutopilotState = {
  state: 'idle',
  iteration: 0,
};

// A whole number at or above zero. `iteration` is compared with `>=` against the cap, so a fractional
// value is a threshold the comparison steps straight over and a negative one buys extra dispatches.
function counter(value: unknown): number | undefined {
  if (value === undefined) return 0;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

const isState = oneOf(AUTOPILOT_STATES);

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
  if (iteration === undefined) return 'unreadable';
  const pgid = d.servicePgid;
  // PRESENT-BUT-MALFORMED IS NOT ABSENT, and here that distinction has teeth: this list is what stops
  // auto-pilot running commands an agent wrote, so dropping a value we cannot read would fail OPEN on
  // the one field in this file whose whole purpose is to refuse. Same rule the halt above follows, and
  // the same rule foundation.ts states as "absence is never a pass".
  const gates = unreviewed(d);
  return {
    state: d.state,
    iteration,
    // Dropped, not refused: the reason is what the overlay SHOWS, and losing the label is a far
    // better outcome than losing the halt it labels.
    ...(isStopReason(d.reason) ? { reason: d.reason } : {}),
    // TRIMMED, which this file's own copy of `asText` was not. A `detail` written with padding — a
    // hand-edited state file, or a sentence assembled with a stray space — reached the halt overlay
    // carrying it, while every other reader of an optional string field in the codebase stripped it.
    ...(asText(d.detail) ? { detail: asText(d.detail) } : {}),
    ...(asText(d.at) ? { at: asText(d.at) } : {}),
    ...(typeof pgid === 'number' && Number.isInteger(pgid) && pgid > 1 ? { servicePgid: pgid } : {}),
    ...(typeof d.servicePgstart === 'number' && Number.isInteger(d.servicePgstart) && d.servicePgstart > 0
      ? { servicePgstart: d.servicePgstart }
      : {}),
    ...(gates.length > 0 ? { unreviewedGates: gates } : {}),
  };
}

// The gate documents an agent rewrote. Absent is an empty list; a value that will not read is a list
// with something in it, because the safe answer to "I cannot tell whether an agent rewrote your gate
// commands" is to make somebody look.
function unreviewed(d: Record<string, unknown>): string[] {
  if (d.unreviewedGates === undefined) return [];
  if (!Array.isArray(d.unreviewedGates)) return [UNREADABLE_GATES];
  const names = d.unreviewedGates.filter((g): g is string => typeof g === 'string' && g.trim() !== '');
  return names.length === d.unreviewedGates.length ? names : [...names, UNREADABLE_GATES];
}

// Reads as a document name in the blocker sentence, because that is where it will be seen.
export const UNREADABLE_GATES = 'a gate document whose name could not be read';

// THE SENTENCE, and there is one of it.
//
// This lives beside the flag it explains because there used to be two of these, written months apart,
// and only one was complete. The dispatch refusal named the acknowledgement; the auto-pilot start
// refusal said "read the commands in Project Control" and stopped there — so a user read them, pressed
// Start, got the identical message, and reasonably concluded the product was broken. Reading clears
// nothing; a button does.
//
// Every refusal names the action that fixes it. This is that rule applied to the one blocker a person
// CLEARS rather than fixes, and having a single home is what stops the two drifting apart again.
export function unreviewedGatesSentence(names: string[]): string {
  const listed = names.map((n) => `foundation/${n}`).join(' and ');
  const one = names.length === 1;
  return `${listed} ${one ? 'was' : 'were'} rewritten by an agent and nobody has read ${
    one ? 'it' : 'them'
  }. These files hold commands this server runs outside the sandbox, as you — read them in Project Control, then press "I have read the gate commands" on the auto-pilot bar.`;
}

// THE STATE AS A CLIENT MAY SEE IT. The process group is the reaper's business and nothing outside this server
// has any use for it: a pid is an instrument for signalling, and handing one to every open tab — and to the
// browser's console, and to anything that can read a WebSocket frame — publishes the one value
// `markInterrupted` uses to decide what to kill.
//
// ONE HOME, because a review found the strip applied to `GET /autopilot/state` alone while `start`, `stop`,
// `kill` and `restart` all answered with the raw state and both socket broadcasts carried it. Five leaks behind
// one plugged hole, and a test pinned one of them as correct.
export function forClient(state: AutopilotState): AutopilotState {
  const { servicePgid, servicePgstart, ...rest } = state;
  return rest;
}

export function serializeState(state: AutopilotState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

// What a state found on disk means once the process that wrote it is gone.
//
// `running` USUALLY cannot be true, and this comment used to say it never could: "the service and every
// agent were this server's children and died with it". That was false. The loop is spawned detached, in
// its own session, so it survives a terminal's Ctrl-C, a SIGHUP and its parent's death — measured, not
// argued: 275 orphaned processes accumulated on one machine before the shutdown path took it down. The
// server now kills it on the way out, which makes the old claim true again on the ordinary path — and
// `alive` is the guard for every other path, including a second server opening the same project.
//
// So: `running` with a group that is STILL ALIVE is left alone, because it is true. `running` with no
// live group becomes `stopped`, and it owes the project a checkup — resuming dispatch would be acting on
// the assumption that runs nobody is watching went fine.
//
// `halted` is returned untouched. That is the whole reason this file is persisted: a restart must not
// be a way out of it.
export function reconcile(
  state: AutopilotState,
  at: string,
  // Whether the recorded process group is the one recorded and still running. Injected because this
  // module is pure — /proc belongs to the server side — and DEFAULTS TO FALSE, which is the fail-closed
  // reading: a caller that cannot tell gets the conservative answer rather than a project left `running`.
  alive: (pgid: number, pgstart: number) => boolean = () => false,
): AutopilotState {
  if (state.state !== 'running') return state;
  if (
    state.servicePgid !== undefined &&
    state.servicePgstart !== undefined &&
    alive(state.servicePgid, state.servicePgstart)
  ) {
    return state;
  }
  // NO `needsCheckup`. Decision 15's "a checkup is mandatory on resume" has not retired — what changed is
  // that it no longer needs a flag. The position is re-derived every tick, a task left in `review` is
  // re-judged or re-stamped, and an in-flight run is `interrupted` by `markInterrupted`, which burns no
  // attempt. The honesty the flag bought is structural now.
  return {
    ...state,
    state: 'stopped',
    reason: 'interrupted',
    at,
  };
}
