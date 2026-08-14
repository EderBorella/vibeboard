// One writer at a time, per key.
//
// Two modules need this and for the same reason: a project file with more than one writer, where the
// write is not a single atomic call. The diary appends; the auto-pilot state does read-modify-write. Both
// lose data without it, differently — appends arrive out of order, and an update overwrites one it never
// read.
//
// Deliberately NOT a lock on disk, and this paragraph used to be wrong about why.
//
// It claimed every write to either file goes through the server "including the ones slice C's service
// makes, because it reaches the board over HTTP like anything else". True of the diary — that is an
// endpoint — and FALSE of the auto-pilot state, which is decision 20's one deliberate carve-out: the
// service writes `autopilot-state.json` directly, because routing an iteration counter through HTTP on
// every tick would be chatty for no gain.
//
// So from slice C2 the state file has two writers in two processes, and this queue orders only the ones
// inside each. **Ruled 2026-08-05: accepted and documented rather than locked.** What that costs is
// bounded, and it is worth being exact about:
//
//   - Corruption is not reachable. Every write is a temp file plus a rename, so a reader sees the old
//     state or the new one, never half of one.
//   - The two processes write DISJOINT fields — the service owns the counters and its pgid, the server
//     owns `state`/`reason`/`detail`/`at` — and each goes through a read-modify-write, so an ordinary
//     write preserves the other's fields.
//   - What can be lost is one counter increment, in one window: the server reads, the service ticks and
//     writes, the server writes back what it read. The window is the emergency-stop path, which is
//     exactly when the service is about to be killed, and the value at risk is an iteration count for a
//     run that is being abandoned. A lockfile would remove that and add a failure mode of its own — a
//     stale lock left by a killed process is worse than a counter off by one.
//
// If a future slice ever needs the counters to be exact across processes, that is the trigger to revisit.

import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const chains = new Map<string, Promise<unknown>>();

// Runs `fn` after everything already queued under `key`, and answers with its result. A rejection reaches
// the caller that queued it and nobody else: the stored link is deliberately caught, so one failed write
// cannot poison every write behind it.
export function serialise<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const mine = previous.then(fn, fn);
  chains.set(
    key,
    mine.catch(() => undefined),
  );
  return mine;
}

// Temp file plus rename, so a reader sees the old bytes or the new ones and never half of either. The
// queue above cannot promise that — it orders writers inside one process, and only the rename holds
// against a writer outside it, or against the process dying mid-write.
//
// `mode` applies only where the write CREATES the file and the umask may narrow it further, so it is
// re-applied explicitly: a 0600 file left world-readable by an earlier version is tightened on the
// next write rather than staying open forever.
//
// autopilot-store.ts and run-store.ts each grew their own copy of this before it lived anywhere; they
// predated it rather than disagreed with it, and both now call this one.
//
// THE TEMPORARY NAME MUST NOT END IN THE EXTENSION THE CALLER'S READERS FILTER ON, and for the run
// store that extension is `.md`: an interrupted write must leave something its listers ignore rather
// than something that half-parses as a run. `.tmp` satisfies that for every caller there is, and
// test/atomic-write.test.ts pins it — the requirement arrived here with a caller whose own copy
// carried the reason, and a shared helper that silently lost it would take a store's invariant with it.
let writeSeq = 0;
export async function writeAtomic(path: string, content: string, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Unique per WRITE, not per path: two overlapping writes sharing one temp name race for it, and the
  // loser's rename finds the file already gone.
  const temp = `${path}.${process.pid}.${++writeSeq}.tmp`;
  try {
    await writeFile(temp, content, mode === undefined ? 'utf8' : { encoding: 'utf8', mode });
    if (mode !== undefined) await chmod(temp, mode);
    await rename(temp, path);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}
