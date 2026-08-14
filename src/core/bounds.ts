import { burnsAttempt } from './accounting.js';
import { phaseForRun } from './phases.js';
import type { RunRecord } from './runs.js';
import type { Card } from './types.js';
import type { Verification } from './verify.js';

// Every count in §5 that `accounting.ts` does not already answer. Pure, and every one of them is a QUERY
// over records already on disk plus the board — no new stored counter to drift out of step (decision 46).
//
// Which phase a run belongs to is asked of the TABLE rather than restated here (`phaseForRun`), so the two
// skills a verdict lands on and the one skill that judges them have a single home.

// Ordering is by WHEN THE RUN STARTED, with the id as the tie-break, so no caller has to pass runs in
// any particular order.
//
// NOT BY ID ALONE, which is what this was and what made the machine wrong about half the time it
// mattered. A run id is `YYYYMMDD-HHMMSS-` plus a RANDOM four-character suffix (src/server/app.ts:149),
// so it is only sortable to the second and two runs inside one second sort at random. An implement run
// and the fix that followed it land in the same second routinely — the end-to-end trace hit it in half
// its runs — and when the fix sorted first, `latestWorkRun` answered with the implement run, whose
// failed gates verdict was therefore still outstanding: the task was re-stamped back to `in-progress`
// and fixed again until the cap blocked a task whose gates had failed exactly once. That is the same
// failure as the one the review trigger was corrected for, arriving through the ordering instead.
//
// `started` is written by the server at dispatch, in ISO with milliseconds, and is the only field that
// says when. Compared as a TIME rather than as a string: the two ISO precisions the codebase holds
// (`…:00Z` and `…:00.500Z`) sort the wrong way round as text, because `Z` is above `.`.
//
// EXPORTED because this is not the machine's rule, it is the rule for reading runs in order, and
// `listRuns` (store/run-store.ts) had the same latent flaw: it sorted newest-first by id alone. No current
// consumer of that list is order-sensitive, so nothing was broken by it — but this class has now bitten
// three times, and a second copy of the comparison is a second thing to get wrong.
export const startedAt = (run: RunRecord): number => {
  const at = Date.parse(run.started);
  // A record with no readable start time — hand-edited, or written by something older — is not assumed
  // to be the newest. It sorts first, and the id decides between it and anything else without one.
  return Number.isFinite(at) ? at : 0;
};

const latest = (runs: RunRecord[]): RunRecord | undefined =>
  [...runs].sort((a, b) => startedAt(a) - startedAt(b) || a.run.localeCompare(b.run)).at(-1);

// A run whose WORK a verdict is written onto: the engineering phases whose exit is `review`, which is
// `implement` and `fix`. Read off the table rather than listed again — and a review run is excluded by
// construction, because a reviewer does not judge itself.
const isWorkRun = (run: RunRecord): boolean => phaseForRun(run.skill, run.board)?.exitPass === 'review';

const isReviewRun = (run: RunRecord): boolean => phaseForRun(run.skill, run.board)?.name === 'task-review';

// The verdict this task currently stands under, or nothing. FILTERED TO RUNS THAT CARRY ONE, which is what
// makes a dead `fix` leave the earlier failure standing: the task was sent back, the fix produced no
// judgement of its own, and the finding is still outstanding. Reading the latest settled run instead would
// clear a real failure because the run after it died.
//
// Pass or fail, both: the caller reads `passed`. P3 dispatches when there is no FAILED verdict, P5 when
// there is one, and P4r re-stamps from whichever it is — three questions, one lookup.
export function outstandingVerdict(runs: RunRecord[], card: string): Verification | undefined {
  return verdictRun(runs, card)?.verification;
}

// THE RUN THAT CARRIES THE VERDICT, which is what a `fix` is handed as `previous`: the findings are on the
// run, not on the card, and a fix told to go and look for them is a fix guessing. Its own export rather than
// a second filter at the call site, so "the latest work run that was judged" has one definition.
export function verdictRun(runs: RunRecord[], card: string): RunRecord | undefined {
  return latest(runs.filter((r) => r.card === card && isWorkRun(r) && r.verification !== undefined));
}

// THE RUN UNDER JUDGEMENT, which is what a `review` is handed as `previous`. Not filtered on carrying a
// verdict — the whole point is that this one has none yet — and the review must be told WHICH run it is
// judging, or an earlier successful run on the same card becomes the work it grades.
export function latestWorkRun(runs: RunRecord[], card: string): RunRecord | undefined {
  return latest(runs.filter((r) => r.card === card && isWorkRun(r)));
}

// HOW A CARD'S OWN WORK LAST ENDED, which is what a checkup is told about each of its children (ruling 60).
//
// A REVIEW RUN IS EXCLUDED AND NOTHING ELSE IS. A review's `status` is how the REVIEWER'S turn went, not how
// the work went: a task sent back with findings has a review run that ended `success`, so reading the latest
// run of any kind described that task to the checkup as having succeeded. Same conflation as the one the
// review trigger was corrected for, one module over.
//
// NOT `latestWorkRun`, which is the right predicate for a task and answers nothing for anything else: it is
// engineering-only by construction — the phases whose exit is `review` — and a story's own runs are its
// break-down and its checkup, so filtering to work runs would tell a feature checkup nothing at all about
// any of its children.
export function latestOwnRun(runs: RunRecord[], card: string): RunRecord | undefined {
  return latest(runs.filter((r) => r.card === card && !isReviewRun(r)));
}

// INCONCLUSIVE reviews, not reviews — finding A. `BURNS.success` is true (accounting.ts:98), deliberately,
// and `attemptsUsed` filters on `burnsAttempt` — so a cap over every review run would stop the loop
// `stalled` on a perfectly healthy task after three completed reviews, while the spec's own arithmetic row
// expects `attemptCap + 1` of them per task.
//
// A review is inconclusive when it burned an attempt and answered nothing. That is not a blocked task:
// `blocked` means judged unfixable, and a dead API key or a full disk is an infrastructure failure rather
// than work nobody can fix — so this bound stops the loop naming THE REVIEW.
export function inconclusiveReviews(runs: RunRecord[], card: string): number {
  return runs.filter(
    (r) => r.card === card && isReviewRun(r) && burnsAttempt(r.status) && r.verdict === undefined,
  ).length;
}

// EVERY REVIEW THIS TASK HAS COST, which is the bound the spec's arithmetic row already states: per task at
// most `attemptCap` fix runs and `attemptCap + 1` review runs.
//
// It exists because `inconclusiveReviews` counts one way a review can repeat and the review phase's trigger
// admits others. The trigger dispatches whenever the LATEST WORK RUN carries no `verification`, so any failure
// to record a verdict — `POST …/verification` refused non-fatally, for instance — leaves the work run exactly
// as it was while the review itself answered perfectly. Nothing counts that: the review has a verdict, so it is
// not inconclusive, and `dispatches: 1` resets the idle counter so `MAX_IDLE_TICKS` never arrives either. The
// task pays for a full review, every tick, for as long as the write keeps failing.
//
// A TOTAL rather than a second special case, chosen deliberately: it catches every way a review can repeat
// without progress, including the ones nobody has thought of, where counting the unrecordable verdict as
// inconclusive would blur what that word means and still only cover the one route. And `attemptCap + 1` cannot
// stall a healthy task, because it is exactly the healthy maximum — implement, then a review and a fix for each
// of `attemptCap` send-backs, then the review that passes.
//
// Filtered on `burnsAttempt`, like `attemptsUsed`: a review you cancelled is not a review the task spent.
export function reviewsRun(runs: RunRecord[], card: string): number {
  return runs.filter((r) => r.card === card && isReviewRun(r) && burnsAttempt(r.status)).length;
}

// Has this checkup point already had its one creating round (decision 47)?
//
// READ OFF THE BOARD — ruling 58 and finding F. The obvious version reads the checkup run's own `created`
// list, which is the agent's claim about itself: it would refuse a close for a run that listed five cards
// it never made, and grant a second round to one that created five and forgot to list them. `Card.createdBy`
// is stamped by the endpoint from the credential, so the question is whether any card on the board names one
// of this card's own checkup runs as its creator.
//
// Every card the caller passed, and the caller is the tick — which means the LIVE board and nothing else,
// because `readBoard` walks the configured columns only, so an archived card never reaches `decideTick` at
// all. Stated because the comment here used to claim the other reading "hands out a second creating round
// every time someone archives a story", which cannot happen through this caller.
//
// It is worth knowing rather than fixing: the round was spent whatever became of what it made afterwards, so
// seeing the archive would be strictly more correct — and a second creating round after a person archives a
// story is not a failure worth an extra read of the archive on every tick.
export function creatingRoundSpent(cards: Card[], runs: RunRecord[], card: string, skill: string): boolean {
  const mine = new Set(runs.filter((r) => r.card === card && r.skill === skill).map((r) => r.run));
  return cards.some((c) => c.createdBy !== undefined && mine.has(c.createdBy));
}
