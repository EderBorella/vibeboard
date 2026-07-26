import type { RunRecord, RunStatus } from '../api';

// How the dashboard groups runs. Three columns, because there are three things a person wants to
// know: what is happening, what is waiting for me, and what came back.
export type RunGroup = 'active' | 'attention' | 'done';

const GROUPS: Record<RunStatus, RunGroup> = {
  queued: 'active',
  running: 'active',
  attention: 'attention',
  // A failed or interrupted run is not "done" — it is something to look at, and burying it under
  // successes is how a broken run goes unnoticed for a week.
  failed: 'attention',
  interrupted: 'attention',
  success: 'done',
  cancelled: 'done',
};

export function groupOf(status: RunStatus): RunGroup {
  return GROUPS[status];
}

// Worth a badge: something ended in a state only a person can resolve.
export function needsAttention(status: RunStatus): boolean {
  return groupOf(status) === 'attention';
}

// Runs in each group. Order within a group is the order given (the API lists newest first) except
// for the active one, where the oldest is the one that has been going longest and matters most.
export function groupRuns(runs: RunRecord[]): Record<RunGroup, RunRecord[]> {
  const out: Record<RunGroup, RunRecord[]> = { active: [], attention: [], done: [] };
  for (const record of runs) out[groupOf(record.status)].push(record);
  out.active.reverse();
  return out;
}

// How long a run has been going, or took: "1m 20s". Whole seconds — a run is minutes of work, and
// milliseconds would be false precision.
export function elapsed(record: RunRecord, now: number): string {
  const from = Date.parse(record.started);
  const to = record.finished ? Date.parse(record.finished) : now;
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return '';
  const seconds = Math.floor((to - from) / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}
