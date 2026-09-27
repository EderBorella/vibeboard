import type { RunRecord, RunStatus } from './types.js';

// A run id that sorts chronologically as a string: the store lists a card's runs by filename, so
// ordering must not depend on reading every file. `at` is the caller's clock — nothing here reads
// the time, so a test can pin it.
export function runId(at: Date, suffix: string): string {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${stamp}-${suffix}`;
}

// What may be interpolated into a path as a run id. It exists because the id arrives from a URL
// segment: Fastify decodes `%2F` AFTER matching the route, so `..%2F..%2Fsecret` reached the store as
// `../../secret` and read a file outside it.
//
// A character class rather than the timestamp shape `runId` produces, and the distinction is the whole
// point: what closes the traversal is the absence of `.`, `/` and `\`, not the presence of a
// timestamp. Demanding the exact shape would additionally reject any id written by an older version —
// and would have meant rewriting a hundred fixtures whose readable names are why the suites are
// legible, buying nothing for the boundary.
const RUN_ID = /^[A-Za-z0-9_-]+$/;

export function isRunId(run: string): boolean {
  return RUN_ID.test(run);
}

// About the project, not a card. One predicate rather than two `undefined` checks at every call
// site: the store dispatches on it, the accounting excludes these from per-card totals, and the
// dashboard labels them.
export function isProjectRun(record: RunRecord): boolean {
  return record.card === undefined && record.board === undefined;
}

export function isHandRun(record: Pick<RunRecord, 'dispatchedBy'>): boolean {
  return record.dispatchedBy === 'person';
}

// In-flight statuses cannot survive a restart: the child process is gone with the server that
// spawned it, so a record still claiming to run is stale rather than live.
export function isInFlight(status: RunStatus): boolean {
  return status === 'queued' || status === 'running';
}

// Statuses that leave something for a person to decide. `success` and `cancelled` do not: one is
// finished work, the other is a decision already taken. In-flight runs are not resolvable either —
// they have not ended, and stopping one is `cancel`, not a resolution.
export const RESOLVABLE_STATUSES: readonly RunStatus[] = ['attention', 'failed', 'interrupted'];

// Still asking for a decision. The single source for that question: the server filters on it when a
// card closes, and the dashboard's grouping is asserted against it in test/mirror.test.ts.
export function needsResolution(record: RunRecord): boolean {
  return record.resolved === undefined && RESOLVABLE_STATUSES.includes(record.status);
}

// A run that left NOTHING behind — no report, no files, no cards. Asked before a card's work is verified,
// because verifying nothing is the shape that advances a card over work that never happened: a `gates` route
// whose run died runs its commands over an unchanged tree, which was green before and is green now, and the
// card advances having implemented nothing. Found by the first hand-run through the critic; the same hole is
// wider under `gates`, where no model is involved to notice.
//
// FAIL CLOSED, and the direction matters: every clause must hold, so the answer is "nothing" only when there
// is nothing on any of the three counts. Being wrong the other way costs a wasted verification, which is
// ordinary; being wrong this way is a card advanced over an empty run.
//
// Each clause earns its place:
// - `failed` only. `attention` is a run that finished and SAID it could not do the work — it has a report and
//   a verdict is exactly what should judge it. A run whose report claimed success and which was then killed by
//   the clock is `failed` WITH an `outcome`, and the clause below keeps it verifiable.
// - `outcome === undefined` is "the agent never delivered a report", and it is the whole of that question.
//   `withReport` is the only producer of `outcome`, so its absence means no report was ever folded in.
// - `filesChanged === 0` and never `!filesChanged`: absent means the measurement could not be taken, which is
//   not evidence that nothing changed. And files alone are never enough — `derive-features` writes cards
//   through the API and legitimately changes no files, so a files-only test would call a real derivation empty.
//
// NOT `record.report`, and this is the correction a review had to make (2026-08-06): `withoutReport` puts the
// TRANSCRIPT TAIL in that field precisely when there is no agent report, so `!record.report?.trim()` was false
// for exactly the dead run this predicate exists to catch — `{"kind":"text","text":"[opencode failed: fetch
// failed]"}` is a non-empty `report`. The refusal was dead in production, and the tests did not notice because
// they hand-built `report: ''`, a shape the runner never writes. Compose the real functions in a test, or a
// field's NAME will keep standing in for what actually goes in it.
export function producedNothing(record: RunRecord): boolean {
  return record.status === 'failed' && record.outcome === undefined && record.filesChanged === 0;
}
