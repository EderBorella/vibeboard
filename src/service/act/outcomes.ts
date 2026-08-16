import { burnsAttempt } from '../../core/accounting.js';
import { countLive, createdNothing } from '../../core/created.js';
import { type PhaseName, phase } from '../../core/phases.js';
import { producedNothing, type RunRecord } from '../../core/runs.js';
import type { Card } from '../../core/types.js';
import { unverified } from '../../core/verify.js';
import type { ActResult, TickContext } from '../loop.js';
import { stamp } from '../stamp.js';
import type { ActDeps, Dispatch } from './index.js';
import { refused } from './refusals.js';
import { emptyCreateLine, emptyRunLine, failedRunLine, heldOpenLine, runLine } from './sentences.js';

// WHAT A SETTLED CARD RUN EARNED: the exit stamp, or one of the four endings that do not take it. Which of
// them applies is decided here and nowhere else, so the order the questions are asked in is the behaviour.

// THE THREE PHASES WHOSE ONLY PRODUCT IS CARDS (decision 43). Named here rather than derived from `creates`,
// because the two checkups declare a `creates` too and this rule must not touch them: a checkup's product is a
// REPORT, creating is optional, and a checkup that creates nothing is the ordinary closing case (decision 47) —
// applied to them, this would refuse every close.
const CREATING_PHASES: readonly PhaseName[] = ['bootstrap', 'feature-breakdown', 'story-breakdown'];

// AND THE PHASE WHOSE TWO EXITS DIFFER BY THE SAME COMPARISON. A feature checkup that created stories has
// not finished its feature: it stays OPEN, L2 walks what was created, and the checkup after that work is the
// one that closes it. Stamping `done` regardless orphans everything a checkup creates — `derivePosition`
// picks a feature only out of `todo` or `in-progress`, so a closed feature is never re-entered.
//
// THE FEATURE AND NOT THE STORY, which is ruling 54: creating siblings and closing the story are one act,
// because leaving the story open while its new siblings are worked would mean two open stories at once.
const HOLDS_OPEN_HAVING_CREATED: readonly PhaseName[] = ['feature-checkup'];

// The phases judged on whether the BOARD GREW, for either of the two reasons above. One predicate, so the
// count is taken exactly when one of them will ask for it.
export const countsTheBoard = (name: PhaseName): boolean =>
  CREATING_PHASES.includes(name) || HOLDS_OPEN_HAVING_CREATED.includes(name);

// How many live cards the board holds, or `undefined` when it could not be read. A failed read is stated as
// unknown rather than guessed at: "created no cards" is a verdict, and a failed read is not evidence for it.
export async function liveCount(deps: ActDeps): Promise<number | undefined> {
  const board = await deps.client.board();
  return board.ok ? countLive(board.value.boards) : undefined;
}

// DID THE BOARD GROW while the run went: `true`, `false`, or `undefined` when the comparison could not be
// made — the phase is not judged this way, or one of the two reads failed. Unknown is deliberately not
// folded into either answer: both of this file's callers would take an action on the strength of it, and a
// comparison nobody could make is not evidence for either.
async function boardGrew(deps: ActDeps, before: number | undefined): Promise<boolean | undefined> {
  if (before === undefined) return undefined;
  const after = await liveCount(deps);
  return after === undefined ? undefined : !createdNothing(before, after);
}

// What a card's run earned. DECISION 40, and precisely: `status` is NOT a value the agent cannot reach —
// `withReport` copies it out of the agent's own `outcome` — so what stops a run moving its own card is that
// the only two outcomes it may write are treated identically here, that VibeBoard overrides the status on
// timeout and cancellation, and that a `failed` run never advances. All three are below.
export async function afterCardRun(
  deps: ActDeps,
  action: Dispatch,
  card: Card,
  settled: RunRecord,
  context: TickContext,
  // The live-card count before the dispatch, for a phase whose product is cards. See `CREATING_PHASES`.
  before: number | undefined,
): Promise<ActResult> {
  const p = phase(action.phase);
  // An ending nobody is answerable for: the user cancelled it, a restart left it stale, the MACHINE
  // failed rather than the work, or a person has forgiven it. No attempt is burned (accounting.ts),
  // and the card does not move — as far as the card is concerned the work never happened.
  if (!burnsAttempt(settled)) {
    // Named separately, because these two sentences send the reader to different places. "ended as
    // failed" invites them to read the card; an infrastructure fault is about the machine and the
    // card is not worth opening.
    const why =
      settled.fault === 'infrastructure'
        ? `could not run — ${settled.note ?? 'the machine failed, not the work'}`
        : `ended as ${settled.status}`;
    await deps.client.log(
      'run',
      `${card.id}: ${action.skill} ${why}, so no attempt was used and the card has not moved.`,
    );
    return { dispatches: 1 };
  }

  // A run that left NOTHING behind does not advance, and this is a correctness rule rather than an economy
  // one: the gates would answer about a tree the run never touched — commands that were passing before the
  // dispatch and are passing now — so the card would advance having implemented nothing. The attempt is still
  // burned: the agent had its chance (accounting.ts).
  if (producedNothing(settled)) return await recordEmptyRun(deps, action, card, settled, context);

  // WHETHER THE BOARD GREW, which two different phases ask for two different reasons. Read once: two reads
  // would be two answers to one question, and the second could disagree with the first.
  const grew = await boardGrew(deps, before);

  // A CREATING PHASE WHOSE RUN PRODUCED NO CARD has not done its job, whatever it reported (decision 43).
  // A different question from `producedNothing`, and both earn their place: that one asks whether the run left
  // anything behind at all, and this one asks whether the board GREW — which is the only honest measure for a
  // phase whose product goes through the API and therefore changes no files.
  if (grew === false && CREATING_PHASES.includes(action.phase)) {
    return await recordEmptyCreate(deps, action, card, settled, context);
  }

  // AND A FEATURE CHECKUP THAT DID GROW IT takes its other exit: the feature stays open and L2 walks the
  // stories it created (decision 47 allows that once, and `creatingRoundSpent` is what bounds it).
  if (grew === true && HOLDS_OPEN_HAVING_CREATED.includes(action.phase)) {
    return await heldOpen(deps, action, card, settled, context);
  }

  // AND A `failed` RUN NEVER ADVANCES ITS CARD — decision 40's third clause, asserted on its own because
  // `producedNothing` does not cover it. A run killed by the clock after touching one file HAS changed a file,
  // and one whose report claimed success before the clock got it HAS an `outcome`, so neither of that
  // predicate's other two clauses holds and both reached the exit stamp. The worst case is a checkup, whose
  // `exitPass` is `done`: a dead run must not be able to close a story or a feature.
  //
  // No verdict, deliberately. The attempt is burned by the record (accounting.ts) and the card retries its OWN
  // phase until that phase's cap gives up — a failed verdict here would send a task to `fix` instead, spending
  // the fix budget on a run that produced no finding to fix.
  if (settled.status === 'failed') return await recordFailedRun(deps, action, card, settled, context);

  // THE EXIT STAMP, written because the run COMPLETED, whatever it says about itself.
  if (p.exitPass) {
    const stamped = await stamp(deps, card, p.exitPass, `its ${action.skill} run completed.`);
    // `dispatches: 1` EVEN HERE, and that is not tidiness: a dispatch that happened and then failed to move
    // its card was reported as no dispatch at all, so neither cap was told about a real agent run, the tick
    // counted as idle, and the next tick re-picked the same card and dispatched over work that had already
    // passed — three times over, until the attempt cap caught it.
    if (!stamped.ok) {
      return refused(deps, `could not advance ${card.id} to ${p.exitPass}`, stamped.reason, stamped.fatal, 1);
    }
  }
  // The STRUCTURED fields as well as the sentence. `DiaryEntry` carries `iteration`, `card`, `board`, `skill`
  // and `outcome` precisely so the diary's readers do not have to regex prose.
  await deps.client.log('run', runLine(card, action, settled, p.exitPass, context), {
    iteration: context.iteration + 1,
    card: card.id,
    board: card.board,
    skill: action.skill,
    outcome: settled.status,
  });
  return { dispatches: 1 };
}

// A RUN THAT DIED. The card is held where its phase put it and nothing is judged: what a dead run left behind
// is not a state anything can have an opinion about, and its own phase will try again under its cap.
async function recordFailedRun(
  deps: ActDeps,
  action: Dispatch,
  card: Card,
  settled: RunRecord,
  context: TickContext,
): Promise<ActResult> {
  await deps.client.log('run', failedRunLine(card, action, settled, context), {
    iteration: context.iteration + 1,
    card: card.id,
    board: card.board,
    skill: action.skill,
    outcome: settled.status,
  });
  return { dispatches: 1 };
}

// THE OTHER EXIT OF A CHECKUP THAT CREATED WORK. No verdict and no move: the run did what it is for, and what
// it found is on the board rather than being a failure of its own. Leaving the card where it is IS the exit —
// the position derives from the board, so the next tick finds the feature still open and walks what appeared
// under it.
async function heldOpen(
  deps: ActDeps,
  action: Dispatch,
  card: Card,
  settled: RunRecord,
  context: TickContext,
): Promise<ActResult> {
  await deps.client.log('run', heldOpenLine(card, action, settled, context), {
    iteration: context.iteration + 1,
    card: card.id,
    board: card.board,
    skill: action.skill,
    outcome: settled.status,
  });
  return { dispatches: 1 };
}

// A failing verdict for a creating run whose board did not grow. The card stays where its entry stamp put it
// and the attempt is burned by the record, exactly as an empty run's is — there is nothing to advance to,
// because the thing this phase exists to produce does not exist.
async function recordEmptyCreate(
  deps: ActDeps,
  action: Dispatch,
  card: Card,
  settled: RunRecord,
  context: TickContext,
): Promise<ActResult> {
  const verification = unverified(
    'gates',
    deps.now().toISOString(),
    `The ${action.skill} run created no card, and cards are the only thing this phase produces — so ${card.id} has not moved. Read its report: it may have decided there was nothing to create, which is a judgement a person needs to see.`,
  );
  const recorded = await deps.client.verdict(card.board, card.id, settled.run, verification);
  if (!recorded.ok) {
    return refused(
      deps,
      `could not record the verdict on ${settled.run}`,
      recorded.reason,
      recorded.fatal,
      1,
    );
  }
  await deps.client.log('run', emptyCreateLine(card, action, settled, context), {
    iteration: context.iteration + 1,
    card: card.id,
    board: card.board,
    skill: action.skill,
    outcome: settled.status,
  });
  return { dispatches: 1 };
}

// A failing verdict for work that was never done, recorded WITHOUT running anything over the tree.
async function recordEmptyRun(
  deps: ActDeps,
  action: Dispatch,
  card: Card,
  settled: RunRecord,
  context: TickContext,
): Promise<ActResult> {
  const verification = unverified(
    // `gates` is the mode the loop's own check wears under this machine (decision 51's first step). Not a
    // fourth mode invented for this case: `unverified` wears a real one deliberately, because "this card is
    // checked by nothing" is not a check.
    'gates',
    deps.now().toISOString(),
    // "nothing this server can see", not "nothing": a run killed by the clock may really have created cards
    // through the API, and its report is deliberately not folded — so what is absent here is the evidence
    // rather than necessarily the work. The verdict fails either way, and the sentence should not overclaim.
    `The ${action.skill} run left nothing this server can see — it failed, changed no files and delivered no report — so nothing was checked and the card has not moved.`,
  );
  const recorded = await deps.client.verdict(card.board, card.id, settled.run, verification);
  if (!recorded.ok) {
    return refused(
      deps,
      `could not record the verdict on ${settled.run}`,
      recorded.reason,
      recorded.fatal,
      1,
    );
  }
  await deps.client.log('run', emptyRunLine(card, action, verification, settled, context), {
    iteration: context.iteration + 1,
    card: card.id,
    board: card.board,
    skill: action.skill,
    outcome: settled.status,
  });
  return { dispatches: 1 };
}
