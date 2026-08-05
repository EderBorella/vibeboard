import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type AutopilotState, IDLE_STATE, parseState, serializeState } from '../core/autopilot-state.js';
import { stopSentence } from '../core/dispatch-gate.js';
import { AUTOPILOT_STATE_FILE } from '../core/layout.js';
import { serialise } from './write-queue.js';

// Auto-pilot's state on disk. One file per project, written by the service for its counters and by the
// main server for the stops (the ownership split is in core/autopilot-state.ts).
//
// This comment used to say both writers go through `updateAutopilotState`. That was FALSE — `load()` and
// `restart()` call `writeAutopilotState` directly — and believing it is why the serialisation added for the
// lost-update race stopped one path short. Two whole-file writes at once truncated and interleaved, leaving
// bytes that do not parse, so S13 fail-closed the project to `halted / unreadable`: VibeBoard corrupting
// the file and then blaming the file, with both calls reporting success. `load()` needs no user action to
// reach it — it writes precisely when it found `running` on disk, which is when a service is ticking
// counters through the other path.
//
// Two defences now, deliberately both:
//   1. every write goes through ONE queue key, so nothing in this process overlaps;
//   2. the write itself is atomic — temp file plus `rename` — so a reader never sees a half-written file
//      and a writer outside this process cannot corrupt it either. The queue cannot promise that; only the
//      rename can. Same reasoning, and the same mechanism, as the run store.

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

export function writeAutopilotState(root: string, state: AutopilotState): Promise<void> {
  return serialise(queueKey(root), () => write(root, state));
}

// The queue key, shared by every writer of this file. One statement of it, because two keys would be two
// queues and the whole point is that there is one.
const queueKey = (root: string): string => `autopilot:${root}`;

// Unserialised, and private for that reason: `merge` runs INSIDE the critical section already, so calling
// the public wrapper from there would wait on a chain that cannot finish until it returns — a deadlock.
let writeSeq = 0;
async function write(root: string, state: AutopilotState): Promise<void> {
  const path = autopilotStatePath(root);
  await mkdir(dirname(path), { recursive: true });
  // Unique per WRITE, not per project: two overlapping writes sharing one temp name race for it, and the
  // loser's rename finds the file already gone. The run store learned this the same way.
  const temp = `${path}.${process.pid}.${++writeSeq}.tmp`;
  try {
    await writeFile(temp, serializeState(state), 'utf8');
    await rename(temp, path);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}

// Read-modify-write, so a caller that owns `state` cannot clobber the `iteration` the service owns.
// Returns what was written, which is what every caller wants to broadcast.
export function updateAutopilotState(
  root: string,
  at: string,
  change: (current: AutopilotState) => AutopilotState,
): Promise<AutopilotState> {
  // The READ is inside the critical section, not just the write, and that is the whole point. Two writers
  // own different halves of this file — the service the counters, this process the state — and with the
  // read outside, a halt written between another writer's read and its write was simply overwritten: the
  // guard below never saw it, because `current` was already stale. Measured as a load-sensitive failure of
  // the HTTP-level test for this pair, and pinned deterministically in test/autopilot-store.test.ts.
  return serialise(`autopilot:${root}`, () => merge(root, at, change));
}

async function merge(
  root: string,
  at: string,
  change: (current: AutopilotState) => AutopilotState,
): Promise<AutopilotState> {
  const current = await readAutopilotState(root, at);
  const next = change(current);
  // A merge may never take a project OUT of `halted`.
  //
  // The only writer that legitimately does is `restart`, and it writes the whole state rather than
  // merging — precisely because it is dropping everything, deliberately. Every other writer is adding
  // to what is there, and `halted` means every agent in this project has been killed: a counter update
  // that carried a stale `state: running` alongside it would silently lift the overlay, re-open
  // dispatch, and let the lazy backend respawn, with nobody having decided any of that.
  //
  // Fail closed, like the unreadable case above and for the same reason: this is the one state whose
  // accidental loss cannot be noticed by the person it was protecting.
  if (current.state === 'halted' && next.state !== 'halted') {
    return { ...next, state: 'halted', reason: current.reason, detail: current.detail, at: current.at };
  }
  // The unserialised write: we are already inside the critical section this key protects.
  await write(root, next);
  return next;
}
