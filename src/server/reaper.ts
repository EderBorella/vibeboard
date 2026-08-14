import type { RunRecord } from '../core/runs.js';
import { groupStartTime, isSameGroup, terminateGroup } from '../exec/process-group.js';
import type { Log } from './logging.js';

// Process groups recorded on disk that nothing is watching any more.
//
// Decision 13: "Persist the pgid in the run record, so a restart can reap the previous session's
// strays." A run still marked in flight when a project opens belongs to a server that is gone — its
// children usually died with it, and when they did not, this record is the only account of what to
// kill. The same walk is the blast radius of an emergency stop.
//
// The identity check is the whole of the care here. A pgid written minutes ago may name something
// else entirely by now, and killing a stranger's process group would be far worse than leaving the
// orphan alone. Nothing is signalled unless the group can be shown to be the one recorded.

interface ReapTarget {
  pgid: number;
  // When the group's leader started. Its ABSENCE is a real case — a record written before this field
  // existed, or a platform where /proc could not be read — and it is treated as "cannot be
  // identified", which means "left alone".
  pgstart?: number;
  what: string; // for the log line: nothing should be killed anonymously
}

interface ReapDeps {
  // Injected so the decision is testable without spawning fifteen processes. The defaults are the
  // real thing, so a caller that passes nothing behaves in production.
  isSame?: (pgid: number, started: number) => boolean;
  isLeader?: (pgid: number) => boolean;
  terminate?: (pgid: number) => boolean;
  log?: Log;
}

interface ReapResult {
  reaped: number;
  skipped: number;
}

// Reap what can be identified, leave the rest.
//
// With `pgstart` the check is exact. Without it the group must at least still BE a group leader —
// weaker, and deliberately allowed for one caller only: the auto-pilot service, which is killed by the
// same server that spawned it moments earlier rather than by one reading a file written long ago. Run
// records always carry both, and a record missing `pgstart` is skipped.
export function reapGroups(targets: ReapTarget[], deps: ReapDeps = {}): ReapResult {
  const isSame = deps.isSame ?? isSameGroup;
  const isLeader = deps.isLeader ?? ((pgid: number) => groupStartTime(pgid) !== undefined);
  const terminate = deps.terminate ?? ((pgid: number) => terminateGroup(pgid));
  let reaped = 0;
  let skipped = 0;
  for (const target of targets) {
    const identified =
      target.pgstart === undefined ? isLeader(target.pgid) : isSame(target.pgid, target.pgstart);
    if (!identified) {
      skipped += 1;
      continue;
    }
    if (terminate(target.pgid)) {
      reaped += 1;
      deps.log?.warn({ pgid: target.pgid, what: target.what }, 'killed a process group nobody was watching');
    } else {
      skipped += 1;
    }
  }
  return { reaped, skipped };
}

// Run records worth trying. A record with a pgid and no pgstart cannot be identified, so it is not a
// target at all rather than a target we then refuse — the count of skipped ones should mean "we looked
// and it was not ours", not "we could never have known".
export function groupsOf(records: RunRecord[]): ReapTarget[] {
  return records
    .filter(
      (r): r is RunRecord & { pgid: number; pgstart: number } =>
        r.pgid !== undefined && r.pgstart !== undefined,
    )
    .map((r) => ({ pgid: r.pgid, pgstart: r.pgstart, what: `run ${r.run}` }));
}
