import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type AutopilotState, IDLE_STATE, parseState, serializeState } from '../core/autopilot-state.js';
import { stopSentence } from '../core/dispatch-gate.js';
import { AUTOPILOT_STATE_FILE } from '../core/layout.js';

// Auto-pilot's state on disk. One file per project, written by the service for its counters and by
// the main server for the stops — both through `updateAutopilotState`, so neither clobbers the
// other's fields (the ownership split is in core/autopilot-state.ts).

export function autopilotStatePath(root: string): string {
  return join(root, AUTOPILOT_STATE_FILE);
}

// The state a project is in when its file cannot be read. S13, and it inverts the house rule
// deliberately.
//
// Everywhere else in VibeBoard, "absent or corrupt" means start fresh: app-state.ts does exactly
// that, and losing which project was open last is a nuisance, not a hazard. Here it is the other way
// round, because the one state that must never fail open is `halted`. A damaged file that idled would
// mean an emergency stop could be undone by corrupting a JSON file — or by any of the ordinary ways a
// file gets truncated — and the overlay that is supposed to explain the halt would simply not appear.
function unreadable(at: string): AutopilotState {
  return {
    ...IDLE_STATE,
    state: 'halted',
    reason: 'unreadable',
    detail: stopSentence('unreadable'),
    at,
  };
}

// ABSENT is not the same as UNREADABLE, and the two answers are opposites: a project that has never
// run auto-pilot is idle, and one whose state cannot be read is halted. Collapsing them either way is
// a bug — the first would halt every new project, the second would un-halt a stopped one.
//
// The damaged file is NOT overwritten. The halt is re-derived on every read, so the evidence survives
// for someone to look at, and `restart` is the deliberate act that replaces it.
export async function readAutopilotState(root: string, at: string): Promise<AutopilotState> {
  let content: string;
  try {
    content = await readFile(autopilotStatePath(root), 'utf8');
  } catch (err) {
    // Only "no such file" means absent. A permission error, a directory in its place, or an IO
    // failure are all cases where a state may exist and we cannot see it — which is the halting case.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return IDLE_STATE;
    return unreadable(at);
  }
  const parsed = parseState(content);
  return parsed === 'unreadable' ? unreadable(at) : parsed;
}

export async function writeAutopilotState(root: string, state: AutopilotState): Promise<void> {
  const path = autopilotStatePath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeState(state), 'utf8');
}

// Read-modify-write, so a caller that owns `state` cannot clobber the `iteration` the service owns.
// Returns what was written, which is what every caller wants to broadcast.
export async function updateAutopilotState(
  root: string,
  at: string,
  change: (current: AutopilotState) => AutopilotState,
): Promise<AutopilotState> {
  const next = change(await readAutopilotState(root, at));
  await writeAutopilotState(root, next);
  return next;
}
