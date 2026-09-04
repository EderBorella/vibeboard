import type { RunRecord } from '../../core/runs.js';
import type { Card } from '../../core/types.js';
import type { Verification } from '../../core/verify.js';
import type { TickContext } from '../loop.js';
import type { Dispatch } from './index.js';

// EVERY SENTENCE THIS FEATURE WRITES FOR A PERSON TO READ LATER: the diary lines each exit appends, and the
// message a commit carries. Pure prose generation — no client, no clock, no decision — so a change to how the
// narrative reads cannot change what the loop does, and the wording of two lines about the same event can be
// compared by reading one file.
//
// NOT here: the sentences that ARE a refusal or a stop. Those interpolate the reason the caller just learnt
// and are written where that reason is known, because a refusal whose words live somewhere else is a refusal
// nobody can keep truthful.

// THE AGENT'S OWN SUMMARY, which nothing was appending before. Loop step 12 says "append the run's summary to
// the diary", and decision 10 justifies denying agents diary access on the grounds that auto-pilot appends it
// for them — so without this the narrative contained no agent voice at all.
const said = (run: RunRecord): string => (run.summary ? ` It reported: ${run.summary}` : '');

export function commitMessage(action: Dispatch, context: TickContext): string {
  const what = action.card ? `${action.card.id} ${action.skill}` : `${action.skill} on the empty board`;
  return `autopilot: before ${what} (iteration ${context.iteration + 1})`;
}

// What a person reads afterwards about a dispatch that completed. The PHASE is named as well as the skill,
// because `break-down` is two phases and `in-progress` is stamped by two — so the skill alone does not say
// which part of the machine this line came from.
export function runLine(
  card: Card,
  action: Dispatch,
  settled: RunRecord,
  to: string | undefined,
  context: TickContext,
): string {
  const where = to === undefined ? 'and it stayed where it is' : `so it moved to ${to}`;
  return `Iteration ${context.iteration + 1}: ${card.id} ran ${action.skill} for its ${action.phase} phase; it ended as ${settled.status}, ${where}.${said(settled)}`;
}

// And about a checkup that created work rather than closing its card. Shaped like `runLine` on purpose — a
// reader following the trace should not have to learn a second sentence for the same event — and it names the
// only thing that differs, which is why the card did not move.
export function heldOpenLine(card: Card, action: Dispatch, settled: RunRecord, context: TickContext): string {
  return `Iteration ${context.iteration + 1}: ${card.id} ran ${action.skill} for its ${action.phase} phase; it ended as ${settled.status} and created work, so ${card.id} stays open until that work is done and the checkup after it closes ${card.id}.${said(settled)}`;
}

// DECISION 69: the feature did not close because its smoke command did not pass. Named as its own sentence
// rather than folded into `heldOpenLine`, because the reader's next move is different: that one says work was
// created and the loop will do it, this one says the product does not run and points at the command output.
export function smokeHeldOpenLine(
  card: Card,
  action: Dispatch,
  settled: RunRecord,
  context: TickContext,
): string {
  return `Iteration ${context.iteration + 1}: ${card.id} ran ${action.skill} for its ${action.phase} phase and it ended as ${settled.status}, but the smoke command did not pass — so ${card.id} stays open whatever the checkup concluded. A feature whose product does not run is not finished.${said(settled)}`;
}

// And about one that died. It names the attempt as spent, because a card that has not moved and a card that
// cost nothing look identical on the board and are not the same thing.
export function failedRunLine(
  card: Card,
  action: Dispatch,
  settled: RunRecord,
  context: TickContext,
): string {
  return `Iteration ${context.iteration + 1}: ${card.id} ran ${action.skill} for its ${action.phase} phase and the run failed, so the attempt is spent and ${card.id} has not moved — a run that died does not advance its card.${said(settled)}`;
}

// And about one that left nothing behind. It says the check DID NOT RUN rather than that it failed: a line
// whose opening clause contradicts the reason after it is worse than one that says less.
export function emptyRunLine(
  card: Card,
  action: Dispatch,
  verification: Verification,
  settled: RunRecord,
  context: TickContext,
): string {
  const because = verification.reason ? ` ${verification.reason}` : '';
  return `Iteration ${context.iteration + 1}: ${card.id} ran ${action.skill} for its ${action.phase} phase and left nothing behind, so nothing was checked and it stayed where it is.${because}${said(settled)}`;
}

// And about a creating run whose board did not grow. It names what the phase produces rather than what the run
// claimed, and points at the report: deciding there was nothing to create is a judgement a person needs to see.
export function emptyCreateLine(
  card: Card,
  action: Dispatch,
  settled: RunRecord,
  context: TickContext,
): string {
  return `Iteration ${context.iteration + 1}: ${card.id} ran ${action.skill} for its ${action.phase} phase and created no card, so it stayed where it is.${said(settled)}`;
}

// THE GATES' OWN WORDS. The command and how it ended, in the diary, so a person reads why a card went back
// without opening a run record — and no model was involved, which the line says because a reader would
// otherwise assume one was.
export function gatesLine(card: Card, gates: Verification): string {
  const evidence = gates.command === undefined ? '' : ` \`${gates.command}\` is the one that failed.`;
  const because = gates.reason ? ` ${gates.reason}` : '';
  return `${card.id} failed its gates, so it goes back to be fixed — no model was asked and no iteration was spent.${evidence}${because}`;
}

export function reviewLine(card: Card, review: RunRecord, passed: boolean, context: TickContext): string {
  const what = passed ? 'passed it' : 'sent it back';
  return `Iteration ${context.iteration + 1}: ${card.id}'s review ${what}.${said(review)}`;
}

// A review that ran and answered nothing. It says so plainly rather than reporting the run's own outcome: a
// review whose turn went perfectly and which decided nothing has not passed anything.
export function inconclusiveLine(card: Card, review: RunRecord, context: TickContext): string {
  return `Iteration ${context.iteration + 1}: ${card.id}'s review ended as ${review.status} and reported no verdict, so nothing was decided and it stays in review.${said(review)}`;
}

// The smoke command's result, handed to the diary as EVIDENCE and not as a verdict — which is why the line
// ends by saying who decides what it means.
export function smokeRanLine(action: Dispatch, smoke: Verification, context: TickContext): string {
  return `Iteration ${context.iteration + 1}: auto-pilot ran the smoke command before ${action.card?.id ?? 'the'} checkup — it ${smoke.passed ? 'passed' : 'did not pass'}. The checkup decides what that means.`;
}

// What a person reads afterwards about a bootstrap. The count is what happened; the run's own summary is what
// it says about it, and the two are kept apart deliberately — a run reporting success over an empty board is
// exactly the disagreement worth being able to see.
export function bootstrapLine(
  skill: string,
  settled: RunRecord,
  // Absent when the board could not be read back. Stated as unknown rather than guessed at: "created no cards"
  // is a verdict, and a failed read is not evidence for it.
  cards: number | undefined,
  context: TickContext,
): string {
  const outcome =
    cards === undefined
      ? 'the board could not be read back, so what it produced is unknown'
      : cards === 0
        ? 'the board is still empty'
        : `the board now has ${cards} card${cards === 1 ? '' : 's'}`;
  return `Iteration ${context.iteration + 1}: ${skill} ran against the project to derive the board — ${outcome}.${said(settled)}`;
}

// WHY THIS FEATURE IS FIRST, said once on the board rather than left for a reader to infer from a flag. The
// wording names what a scaffolding feature is for, because the flag itself is what makes an absent gate set
// expected instead of a failure and a person reading `setup: true` cannot see that.
export function scaffoldingFeatureLine(card: Card): string {
  return `${card.id} is this project's scaffolding feature: it establishes the toolchain, the test runner and the gate commands, and it is worked first.`;
}

// AND WHY THE HARNESS IS LAST. Same reason: the ordering is a construction detail of the bootstrap's exit, and
// the only place it is ever explained to a person is here.
export function harnessFeatureLine(id: string): string {
  return `${id} is this project's smoke harness: it makes the product runnable the way the README describes, with a command that is not one of the gates, and it is built last because there is nothing to smoke test before the product exists.`;
}
