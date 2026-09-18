// --- Auto-pilot state, the three stops, and whether it could start at all ------------------------
// Mirrors src/core/autopilot-state.ts. Persisted on the server, because if `running` survives a
// reload then `halted` must too — otherwise a refresh would bypass the overlay that explains it.
//
// `Readiness` and `acknowledgeGates` are here rather than two hundred lines from the calls they gate:
// the same panel asks "could it start" and then starts it.

import { post, request } from './http';

// Arrays, not bare unions, and that is the point: a type alias is erased at build time, so nothing could
// assert this mirror against the server's. `test/mirror.test.ts` now does, in both directions.
export const AUTOPILOT_STATES = ['idle', 'running', 'stopped', 'halted'] as const;
export type AutopilotStateName = (typeof AUTOPILOT_STATES)[number];

// Every stop resolves to a named reason, and exactly ONE of them is a success. An exhausted budget
// and a reached cap both end tidily and neither means the work is done.
export const STOP_REASONS = [
  'stopped',
  'killed',
  'exhausted',
  'capped',
  'stalled',
  'complete',
  // Nothing to do in the first place — no live card on any board. Apart from `complete` because the
  // absence of unfinished work is not the presence of finished work.
  'no-op',
  // The feature list is derived and waiting for a person (decision 74). Apart from `stalled` for the same
  // reason `infrastructure` is: the board is fine, the loop is waiting on a human, and a stop that blames
  // the cards for that is the accusation this vocabulary exists to stop making.
  'review',
  'interrupted',
  // The machine failed, not the work — a dead box or a dead credential, and no card is to blame. Apart
  // from `stalled` because that one is a statement about the board, which is the accusation this exists
  // to stop the product making.
  'infrastructure',
  'unreadable',
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

// The one rule about reasons the UI needs, mirrored rather than re-derived. `TopBar` used to spell it as
// `reason === 'complete' ? …` inline while the server's `isSuccessReason` had no caller at all — two
// statements of one rule, and the next reason added to the success side would have been added to one.
export function isSuccessReason(reason: StopReason): boolean {
  return reason === 'complete';
}

export interface AutopilotState {
  state: AutopilotStateName;
  iteration: number;
  reason?: StopReason;
  detail?: string;
  at?: string;
  servicePgid?: number;
  servicePgstart?: number;
}

export async function getAutopilotState(): Promise<AutopilotState> {
  const res = await request('/api/autopilot/state', {}, { fallback: 'Failed to read auto-pilot’s state' });
  return (await res.json()).state as AutopilotState;
}

// Stops dispatching. The app is untouched: chat, manual runs and the board all carry on.
export function softStopAutopilot(detail?: string): Promise<{ state: AutopilotState }> {
  return post('/api/autopilot/stop', detail ? { detail } : {});
}

// Kills everything in the project and halts it. A separate call from the soft stop rather than a flag
// on it: one is reversible and the other kills work in flight.
export function killAutopilot(detail?: string): Promise<{ state: AutopilotState }> {
  return post('/api/autopilot/kill', detail ? { detail } : {});
}

export function restartAutopilot(): Promise<{ state: AutopilotState }> {
  return post('/api/autopilot/restart', {});
}

// Starts the loop. Refused with a sentence when the project is not ready, when there is no sandbox, or when
// it is already running or halted — and `post` turns each of those into a thrown Error carrying the server's
// own words, which is what the control renders. A button whose refusal is invisible is a dead end.
export function startAutopilot(): Promise<{ state: AutopilotState }> {
  return post('/api/autopilot/start', {});
}

// One answer to "could auto-pilot start here, and if not, why not?", so the settings panel and
// everything after it read the same list rather than each deciding for themselves.
export interface Readiness {
  ok: boolean;
  blockers: string[];
  readme: { ok: boolean; path?: string; reason?: string };
  foundation: { present: string[]; missing: string[]; ok: boolean };
  gates: { ok: boolean; reason?: string; count: number };
  smoke: { ok: boolean; reason?: string };
  phases: { problems: string[]; count: number };
  unreviewedGates: string[];
}

export async function getReadiness(): Promise<Readiness> {
  const url = '/api/autopilot/readiness';
  return (await request(url, {}, { fallback: 'Failed to check whether auto-pilot could start' })).json();
}

// A person asserting they have read the gate commands an agent wrote. It is the only blocker that is
// cleared rather than fixed.
export function acknowledgeGates(): Promise<{ ok: true }> {
  return post('/api/autopilot/gates-reviewed', {});
}
