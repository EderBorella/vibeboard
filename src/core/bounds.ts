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

// Ordering is by run id, which is a sortable stamp — the same basis the store reads "latest" off
// (src/server/run-store.ts:116-122,172), so no caller has to pass runs in any particular order.
const latest = (runs: RunRecord[]): RunRecord | undefined =>
  [...runs].sort((a, b) => a.run.localeCompare(b.run)).at(-1);

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

// Has this checkup point already had its one creating round (decision 47)?
//
// READ OFF THE BOARD — ruling 58 and finding F. The obvious version reads the checkup run's own `created`
// list, which is the agent's claim about itself: it would refuse a close for a run that listed five cards
// it never made, and grant a second round to one that created five and forgot to list them. `Card.createdBy`
// is stamped by the endpoint from the credential, so the question is whether any card on the board names one
// of this card's own checkup runs as its creator.
//
// Every card, not just the live ones: the round was spent whatever became of what it made afterwards, and
// the other reading hands out a second creating round every time someone archives a story.
export function creatingRoundSpent(cards: Card[], runs: RunRecord[], card: string, skill: string): boolean {
  const mine = new Set(runs.filter((r) => r.card === card && r.skill === skill).map((r) => r.run));
  return cards.some((c) => c.createdBy !== undefined && mine.has(c.createdBy));
}
