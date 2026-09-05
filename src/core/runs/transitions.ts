import type { Verification } from '../verify.js';
import type { AgentReport, RunRecord, RunStatus, RunUsage } from './types.js';

// Every function here returns a NEW record. A run record is read by the accounting, the dashboard and
// the loop at once, so a transition that mutated in place would change what a caller already holds.

// Written whenever the count SUCCEEDED, zero included; absent only when it could not be taken.
//
// The earlier version omitted zero to keep records tidy, which collapsed three facts into one:
// "filed none", "filed none as far as we know" and "the store was unreadable" all looked
// identical. The checkup reads this to decide whether a card was scoped wrongly, and "no findings"
// is a very different input from "we did not look".
export function withSuggestions(record: RunRecord, count: number | undefined): RunRecord {
  return count === undefined ? record : { ...record, suggestions: count };
}

// Same shape and same reason as withSuggestions: zero is a real answer — a run that changed nothing —
// and absence means there was no repository to ask. A `filesChanged: 0` invented for a project without
// git would read as a run that did nothing, which is the opposite of what it would mean.
export function withFilesChanged(record: RunRecord, count: number | undefined): RunRecord {
  return count === undefined ? record : { ...record, filesChanged: count };
}

// Fold the agent's report into the record VibeBoard owns. The agent decides `outcome`, `summary`,
// `options`, `created` and the body; VibeBoard decides `status` and the timings, so an agent that
// rewrites its file wholesale can never lose them.
export function withReport(record: RunRecord, report: AgentReport, finished: string): RunRecord {
  return {
    ...record,
    status: report.outcome,
    outcome: report.outcome,
    finished,
    ...(report.summary ? { summary: report.summary } : {}),
    ...(report.options ? { options: report.options } : {}),
    ...(report.created ? { created: report.created } : {}),
    ...(report.covered ? { covered: report.covered } : {}),
    // The review's own record carries what it SAID; the run it judged carries what came of it as
    // `verification` — one fact, one home, on each side.
    ...(report.verdict === undefined ? {} : { verdict: report.verdict }),
    // THE SERVER'S OWN FAILURE, RECORDED ON THE RUN. `burnsAttempt` reads this and stops charging the
    // card, which is the whole point — but the record keeps it, because an attempt that costs nothing
    // must not also vanish. A parse fault that were merely free would repeat for ever with nobody able
    // to see that it was happening.
    // `!repeat`, so the second unreadable report on a card is recorded with NO fault and burns like any
    // other failure. See `AgentReport.repeat` for the livelock that closes.
    ...(report.unreadable === undefined || report.repeat ? {} : { fault: 'unreadable-report' as const }),
    report: report.body,
  };
}

// End a run that produced no usable report. `status` is the caller's (failed, cancelled,
// interrupted, or attention for "finished and said nothing"), and the note is what the UI shows in
// place of a report — never a blank pane.
export function withoutReport(
  record: RunRecord,
  status: RunStatus,
  note: string,
  finished: string,
  transcriptTail = '',
): RunRecord {
  return { ...record, status, finished, note, report: transcriptTail.trim() };
}

// What the turn cost, attached before either ending is decided — a run that failed or was cancelled
// still spent tokens, and that is exactly when knowing so matters. Absent usage leaves the record
// untouched rather than writing an empty `usage: {}`.
export function withUsage(record: RunRecord, usage: RunUsage | undefined): RunRecord {
  return usage === undefined ? record : { ...record, usage };
}

// The verdict, attached after the run settled and after whatever verified it has answered. Its own
// function rather than a spread at the call site, so there is ONE statement of what "this run was
// judged" writes — and so a loop cannot half-write it.
export function withVerification(record: RunRecord, verification: Verification): RunRecord {
  return { ...record, verification };
}

export function withResolution(record: RunRecord, at: string): RunRecord {
  return { ...record, resolved: at };
}

// A person clearing this attempt, so the card can be tried again. Nothing about how the run ended
// changes — `status`, the report and the timings are all facts about the agent — and `burnsAttempt`
// stops counting it (core/accounting.ts), which is the whole of the effect.
//
// Its own function for the same reason `withResolution` is one: there is ONE statement of what
// "somebody forgave this" writes. Whether a record SHOULD be stamped is the caller's question and is
// answered by `burnsAttempt`, because a record that no longer burns must not be re-stamped — that
// would rewrite the timestamp of a decision taken earlier, and the timestamp is the point.
export function withForgiveness(record: RunRecord, at: string): RunRecord {
  return { ...record, forgiven: at };
}
