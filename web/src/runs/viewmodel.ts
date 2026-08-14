import type { RunRecord, RunStatus } from '../api';

// How the dashboard groups runs. Three columns, because there are three things a person wants to
// know: what is happening, what is waiting for me, and what came back.
type RunGroup = 'active' | 'attention' | 'done';

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

// Where a run belongs once the user has had their say. A resolved run keeps its status — it still
// reads as `attention` or `failed`, because that is how it ended — but it has stopped waiting, so it
// sits with the rest of the history.
//
// An in-flight run is grouped by its status regardless: the server will not resolve one, but a
// hand-edited record must not be able to file a live process under history.
export function groupFor(record: RunRecord): RunGroup {
  const group = groupOf(record.status);
  return record.resolved && group !== 'active' ? 'done' : group;
}

// What the run was about, for a label. A checkup and a pre-flight are about the project itself and
// carry no card, so every place that used to print `record.card` would print nothing at all.
export function runSubject(record: RunRecord): string {
  return record.card ?? 'the project';
}

// Worth a badge: ended in a state only a person can resolve, and nobody has.
export function needsAttention(record: RunRecord): boolean {
  return groupFor(record) === 'attention';
}

// Runs in each group. Order within a group is the order given (the API lists newest first) except
// for the active one, where the oldest is the one that has been going longest and matters most.
export function groupRuns(runs: RunRecord[]): Record<RunGroup, RunRecord[]> {
  const out: Record<RunGroup, RunRecord[]> = { active: [], attention: [], done: [] };
  for (const record of runs) out[groupFor(record)].push(record);
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
