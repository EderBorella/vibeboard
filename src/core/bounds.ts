import { burnsAttempt } from './accounting.js';
import { type PhaseName, phaseForRun } from './phases.js';
import type { RunRecord } from './runs.js';
import type { Card } from './types.js';

// Every count in §5 that `accounting.ts` does not already answer. Pure, and every one of them is a QUERY
// over records already on disk plus the board — no new stored counter to drift out of step (decision 46).
//
// Which phase a run belongs to is asked of the TABLE rather than restated here (`phaseForRun`), so the skills
// a verdict lands on and the skill that judges them have a single home.

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

// ONE COMPARISON FOR EVERY "WHICH CAME FIRST" IN THIS FILE. `latest` ranks by it and `fixedSince` asks it of
// two records directly; a second copy is a second thing to get wrong, and the paragraph above is the record
// of that having happened three times already.
const inOrder = (a: RunRecord, b: RunRecord): number =>
  startedAt(a) - startedAt(b) || a.run.localeCompare(b.run);

const latest = (runs: RunRecord[]): RunRecord | undefined => [...runs].sort(inOrder).at(-1);

// A run whose WORK a verdict is written onto: a dispatching phase that BUILDS rather than judges, which the
// table already says as `bounded: 'skill'`. Since the work moved up to the story too (decision 83) those are
// a story's break-down, its implement and its fix — every run a story-level verdict can land on, and a task
// has none of its own any more.
//
// `exitPass === 'review'` was the marker and could not survive the judgement moving up: no phase exits to a
// review column any more, so it selected nothing at all.
//
// `bounded: 'skill'` IS NOT "EVERY RUN BUT A JUDGING ONE", and the comment here claimed it was. The feature
// checkup carries it too, so a feature's checkup run reads as one of that feature's work runs. Nothing is
// wrong today because nothing asks: `latestWorkRun` is the only caller and its one call site is
// `judgeStory`, which is handed a STORY. But the property a reader would take from "excluded by
// construction" is not one this predicate has, and a second caller reached from the feature loop would
// find it out the hard way.
const isWorkRun = (run: RunRecord): boolean => phaseForRun(run.skill, run.board)?.bounded === 'skill';

const isReviewRun = (run: RunRecord): boolean => phaseForRun(run.skill, run.board)?.bounded === 'review';

// THE PHASE THAT ANSWERS A SEND-BACK. Named rather than read off `skill === 'fix'`, which would also match
// that skill dispatched by hand onto a board no phase owns — a task's own fix among them, which is what a
// person dispatching `fix` on an engineering card is doing since decision 83 retired the phase.
//
// A LIST OF ONE, and it stays a list: it was two until the work moved up to the story, and `fix` is still a
// skill two boards offer.
const FIX_PHASES: readonly PhaseName[] = ['story-fix'];

const isFixRun = (run: RunRecord): boolean => {
  const p = phaseForRun(run.skill, run.board);
  return p !== undefined && FIX_PHASES.includes(p.name);
};

// `outstandingVerdict` AND `verdictRun` WERE HERE, and they went with the task loop (decision 83). They
// answered "the latest work run that CARRIES a verdict", which was how a task in `in-progress` told a fix
// from an implement — a question no card is asked now that the work and the judgement are both the story's,
// and `judgeStory` reads the latest work run's OWN verdict for the reason written beside it in
// core/lifecycle/tick.ts. Recorded rather than silently dropped because the difference between the two
// lookups is a bug this machine has had twice.

// THE RUN UNDER JUDGEMENT, which is what a `review` is handed as `previous`. Not filtered on carrying a
// verdict — the whole point is that this one has none yet — and the review must be told WHICH run it is
// judging, or an earlier successful run on the same card becomes the work it grades.
export function latestWorkRun(runs: RunRecord[], card: string): RunRecord | undefined {
  return latest(runs.filter((r) => r.card === card && isWorkRun(r)));
}

// WHERE A STORY'S VERDICT LIVES WHEN THERE IS NO WORK RUN TO HANG ONE ON (decision 81). A story that skipped
// its break-down because it arrived carrying tasks (decision 50), every one of them already SETTLED — an
// import, or work somebody finished by hand — has no run of its own, so `recordVerdict`
// had nothing to write the judgement onto and wrote it nowhere: every later tick read no verdict, dispatched
// the judgement again, and `story-fix` was unreachable — the send-back could never be answered and the
// review total stopped the whole project. A review run is itself a record, so that is where its verdict goes
// in that case, and this reads it back.
//
// FILTERED TO ONE THAT CARRIES A VERDICT: a review that answered nothing left the story exactly where it
// stood, so it is no more the answer than no review at all.
//
// SECOND TO `latestWorkRun` AT EVERY CALL SITE, never instead of it. The moment a fix has answered, the fix
// is the run under judgement and the review before it is history — reading this first would send the story
// back again after every fix, on a finding the fix had already addressed.
export function reviewVerdictRun(runs: RunRecord[], card: string): RunRecord | undefined {
  return latest(runs.filter((r) => r.card === card && isReviewRun(r) && r.verification !== undefined));
}

// HAS ANYTHING ANSWERED THIS CARD'S SEND-BACK SINCE THAT RUN? The question that tells "the judging point is
// being asked the same thing over again" from "the card was sent back, work answered it, and this is the
// next judgement" — one event while a task's review could not fail, two since decision 80 gave the story's
// judgement an `exitFail`.
//
// A FEATURE HAS NO FIX PHASE, so this is false for every feature by construction. That used to be the
// whole of the story and it left the feature checkup with NO hatch at all — a finished feature whose
// checkup had created one story, and whose story was then delivered, could not be closed by anything
// (decision 86). The feature's analogue is `cardsCreatedBy` below, read as terminal; this one stays the
// story's, and says so.
export function fixedSince(runs: RunRecord[], card: string, since: RunRecord): boolean {
  return runs.some((r) => r.card === card && isFixRun(r) && inOrder(r, since) > 0);
}

// HOW A CARD'S OWN WORK LAST ENDED, which is what a checkup is told about each of its children (ruling 60).
//
// A REVIEW RUN IS EXCLUDED AND NOTHING ELSE IS. A review's `status` is how the REVIEWER'S turn went, not how
// the work went: a task sent back with findings has a review run that ended `success`, so reading the latest
// run of any kind described that task to the checkup as having succeeded. Same conflation as the one the
// review trigger was corrected for, one module over.
//
// NOT `latestWorkRun`, and the difference is what counts as a card's OWN work. That one selects the phases
// the table marks `bounded: 'skill'`, which is the lifecycle's own set — a story's break-down, implement and
// fix, and nothing on engineering at all since decision 83. A checkup is describing a CHILD, and a child's
// last run may be a skill a person dispatched by hand, which belongs in that sentence and is in no phase at
// all. Excluding the reviews and nothing else is the rule that matches the question.
export function latestOwnRun(runs: RunRecord[], card: string): RunRecord | undefined {
  return latest(runs.filter((r) => r.card === card && !isReviewRun(r)));
}

// INCONCLUSIVE reviews, not reviews — finding A. `BURNS.success` is true (accounting.ts:98), deliberately,
// and `attemptsUsed` filters on `burnsAttempt` — so a cap over every review run would stop the loop
// `stalled` on a perfectly healthy story after three completed reviews, while the spec's own arithmetic row
// expects `attemptCap + 1` of them.
//
// A STORY, and no longer a task: since decision 80 the only judging point below a feature is the story's,
// so this and the total below are asked of one card kind and the wording had stopped saying which.
//
// A review is inconclusive when it burned an attempt and answered nothing. That is not a blocked card:
// `blocked` means judged unfixable, and a dead API key or a full disk is an infrastructure failure rather
// than work nobody can fix — so this bound stops the loop naming THE REVIEW.
export function inconclusiveReviews(runs: RunRecord[], card: string): number {
  return runs.filter((r) => r.card === card && isReviewRun(r) && burnsAttempt(r) && r.verdict === undefined)
    .length;
}

// EVERY REVIEW THIS STORY HAS COST, which is the bound the spec's arithmetic row already states: at most
// `attemptCap` fix runs and `attemptCap + 1` review runs.
//
// It exists because `inconclusiveReviews` counts one way a review can repeat and the review phase's trigger
// admits others. The trigger dispatches whenever the LATEST WORK RUN carries no `verification`, so any failure
// to record a verdict — `POST …/verification` refused non-fatally, for instance — leaves the work run exactly
// as it was while the review itself answered perfectly. Nothing counts that: the review has a verdict, so it is
// not inconclusive, and `dispatches: 1` resets the idle counter so `MAX_IDLE_TICKS` never arrives either. The
// story pays for a full review, every tick, for as long as the write keeps failing.
//
// IT IS NO LONGER THE BOUND FOR A STORY WITH NO WORK RUN, which is what it was quietly doing and doing badly:
// there was nowhere to record that story's verdict at all, so this counted to four and stopped the project
// with a sentence blaming the server for a write nobody had attempted. `reviewVerdictRun` gives that verdict
// a home (decision 81); what is left here is the case the sentence actually describes — a verdict the server
// refused to write.
//
// A TOTAL rather than a second special case, chosen deliberately: it catches every way a review can repeat
// without progress, including the ones nobody has thought of, where counting the unrecordable verdict as
// inconclusive would blur what that word means and still only cover the one route. And `attemptCap + 1` cannot
// stall a healthy story, because it is exactly the healthy maximum — the work, then a review and a fix for
// each of `attemptCap` send-backs, then the review that passes.
//
// Filtered on `burnsAttempt`, like `attemptsUsed`: a review you cancelled is not a review the card spent.
export function reviewsRun(runs: RunRecord[], card: string): number {
  return runs.filter((r) => r.card === card && isReviewRun(r) && burnsAttempt(r)).length;
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
  return creatingRun(cards, runs, card, skill) !== undefined;
}

// WHICH RUN SPENT IT, for the caller that has to ask what happened AFTER. `creatingRoundSpent` answers the
// yes/no above and is the whole of what decision 47 needs; separating a story's send-back from a second ask
// needs the round's position in the order as well (decision 81).
export function creatingRun(
  cards: Card[],
  runs: RunRecord[],
  card: string,
  skill: string,
): RunRecord | undefined {
  const creators = new Set(cards.map((c) => c.createdBy).filter((id) => id !== undefined));
  return latest(runs.filter((r) => r.card === card && r.skill === skill && creators.has(r.run)));
}

// WHAT THAT ROUND ACTUALLY MADE, as it stands on the board now — the other half of the question
// `creatingRun` answers, and the feature's substitute for `fixedSince` (decision 86). A story's
// send-back is answered by a FIX RUN; a feature's checkup is answered by the work it asked for being
// finished, and there is no run on the feature to read that off.
//
// HERE RATHER THAN AT THE CALL SITE, so `Card.createdBy` is read in one module. Ruling 58's whole point
// is that the board answers this and the run's own `created` list — the agent's claim about itself —
// does not, and a second reading of the field somewhere else is a second chance to reach for the wrong
// one.
//
// The LIVE board, like `creatingRoundSpent`: `readBoard` walks the configured columns only, so a card
// somebody archived is not here. That direction is the safe one — an archived card cannot hold the
// hatch shut over work that no longer exists.
export function cardsCreatedBy(cards: Card[], run: RunRecord): Card[] {
  return cards.filter((c) => c.createdBy === run.run);
}
