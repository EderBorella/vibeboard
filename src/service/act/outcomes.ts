import { burnsAttempt } from '../../core/accounting.js';
import { DEFAULT_AUTOPILOT } from '../../core/autopilot.js';
import { coveredBy } from '../../core/covered.js';
import { countLive, createdNothing } from '../../core/created.js';
import { type PhaseName, phase } from '../../core/phases.js';
import { producedNothing, type RunRecord } from '../../core/runs.js';
import { BOARDS, type BoardName, type Card } from '../../core/types.js';
import { unverified, type Verification } from '../../core/verify.js';
import type { ActResult, TickContext } from '../loop.js';
import { stamp } from '../stamp.js';
import { settleGroup } from './group.js';
import type { ActDeps, Dispatch } from './index.js';
import { refused } from './refusals.js';
import {
  coveredLine,
  emptyCreateLine,
  emptyRunLine,
  failedRunLine,
  heldOpenLine,
  runLine,
  smokeHeldOpenLine,
} from './sentences.js';

// WHAT A SETTLED CARD RUN EARNED: the exit stamp, or one of the four endings that do not take it. Which of
// them applies is decided here and nowhere else, so the order the questions are asked in is the behaviour.

// THE THREE PHASES WHOSE ONLY PRODUCT IS CARDS (decision 43). Named here rather than derived from `creates`,
// because the feature checkup and the story's judgement declare one too and this rule must not touch them:
// a judging run's product is a VERDICT, creating is optional, and one that creates nothing is the ordinary
// closing case (decision 47) — applied to them, this would refuse every close.
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
  // The smoke result the LOOP produced before this dispatch, for a feature checkup (decision 69). Threaded
  // rather than persisted: `act` gathers it, dispatches, waits and lands here inside one call, so the value is
  // already in scope. A field on the run record would be a second copy of a fact with one reader.
  smoke: Verification | undefined,
): Promise<ActResult> {
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
  const emptied = await whenNoCardWasCreated(deps, action, card, settled, context, grew);
  if (emptied) return emptied;

  // AND A FEATURE CHECKUP THAT DID GROW IT takes its other exit: the feature stays open and L2 walks the
  // stories it created (decision 47 allows that once; `creatingRoundStop` in core/lifecycle/tick.ts is what
  // bounds it, and since decision 86 it re-opens only once that created work is itself finished).
  if (grew === true && HOLDS_OPEN_HAVING_CREATED.includes(action.phase)) {
    return await heldOpen(deps, action, card, settled, context);
  }

  // AND A `failed` RUN NEVER ADVANCES ITS CARD — decision 40's third clause, asserted on its own because
  // `producedNothing` does not cover it. A run killed by the clock after touching one file HAS changed a file,
  // and one whose report claimed success before the clock got it HAS an `outcome`, so neither of that
  // predicate's other two clauses holds and both reached the exit stamp. The worst case reaching HERE is the
  // feature checkup, whose `exitPass` is `done`: a dead run must not be able to close a feature. The story's
  // judgement has the same exit and does not come through this function at all since decision 80 — its
  // gates-first path bypasses it, so `judge` in review.ts asserts the clause again for itself.
  //
  // No verdict, deliberately. The attempt is burned by the record (accounting.ts) and the card retries its OWN
  // phase until that phase's cap gives up — a failed verdict here would spend the fix budget on a run that
  // produced no finding to fix.
  if (settled.status === 'failed') return await recordFailedRun(deps, action, card, settled, context);

  // DECISION 69, AND IT REVERSES HALF OF RULING 55. That ruling made the smoke result EVIDENCE rather than a
  // gate, so a failing one could not stall a project — and the consequence was a feature closing over a product
  // that does not run, which is the whole of decision 66's incident. What has changed since is that the
  // objection is answered elsewhere: `creatingRoundStop` stops a feature whose created work nobody finished,
  // with a sentence asking for a person, and the `checkup-feature` attempt cap ends it in every other case —
  // so refusing the close here cannot loop forever. NAMED AS TWO BOUNDS since decision 86, because it is: the
  // creating round re-opens when the work it asked for lands, and what stops a feature whose smoke keeps
  // failing over work that keeps landing is the cap rather than that stop.
  //
  // THE MACHINE DECIDES, NOT THE MODEL, which is the point. Asked to judge a failing smoke, a model reads the
  // output and talks itself into "environmental" — observed twice on 2026-09-03, once correctly and once from a
  // stale document. A command that did not pass is a fact, and a fact a machine can check is not a prompt.
  //
  // Only the FEATURE checkup: no other phase runs the command, so `smoke` is undefined everywhere else and this
  // is the same as absent.
  //
  // `command` AND NOT JUST `passed`, AND THE DIFFERENCE IS THE WHOLE OF THE CARE HERE. `verifySmoke` answers a
  // FAILED verification for two unrelated situations: a command ran and did not pass, and there is no command
  // to run at all (`failedVerification` in core/verify.ts, which sets no `command`). Refusing on `passed` alone
  // would hold every feature in a project that has not declared a smoke command yet — a stall on a project that
  // has done nothing wrong, and exactly the outcome ruling 55 was protecting against. `command` is set only by
  // `commandVerification`, and only for a command that really ran and really failed.
  //
  // The undeclared case is somebody else's job and already has an owner: decision 66 gives every project a
  // mandatory smoke-harness feature, and `complete` refuses while the smoke command is one of the gates.
  if (smoke?.command !== undefined && !smoke.passed) {
    await deps.client.log('run', smokeHeldOpenLine(card, action, settled, context), {
      iteration: context.iteration + 1,
      card: card.id,
      board: card.board,
      skill: action.skill,
      outcome: settled.status,
    });
    return { dispatches: 1 };
  }

  return await earnedItsExit(deps, action, card, settled, context);
}

// WHAT A RUN THAT EARNED ITS EXIT LEAVES BEHIND, and the ORDER is the behaviour. One function rather than
// three blocks at the end of `afterCardRun`, which the complexity gate decides: that function is at the
// ceiling, and flattening beats a suppression.
async function earnedItsExit(
  deps: ActDeps,
  action: Dispatch,
  card: Card,
  settled: RunRecord,
  context: TickContext,
): Promise<ActResult> {
  const p = phase(action.phase);
  // THE CARDS ONE LEVEL DOWN THIS RUN DELIVERED, stamped TOGETHER and before anything else in here
  // (decision 83). What "together" buys is held by test/service-act-group.test.ts: a refusal part-way
  // returns from this line, so no exit stamp is written and the diary does not report the run as completed
  // — the side the machine recovers from, because the next dispatch re-forms the group out of what is left.
  //
  // BEING AHEAD OF THE EXIT STAMP IS DEFENSIVE, AND NOTHING EXERCISES IT — said plainly rather than as a
  // live rule, because `story-implement` is the only phase that carries a group and its `exitPass` IS its
  // `entry`, so `moved` below is always undefined and no test can tell the two orders apart. It is written
  // this way for the table row that does not exist yet: a group-carrying phase whose exit differed from its
  // entry would advance its card while a task under it was still outstanding, and the level above is judged
  // on its children being settled.
  const group = await settleGroup(deps, action, 1);
  if (group) return group;

  // THE EXIT STAMP, written because the run COMPLETED, whatever it says about itself.
  //
  // AND ONLY WHERE THE CARD IS NOT ALREADY THERE, which is the same care `stampEntry` and `recordVerdict`
  // each take at their own end. The entry stamp has already run, so where the card stands now is the phase's
  // `entry` if it declares one — and `story-implement` exits into the column it runs in, so without this it
  // would move a story to where it stands and write a diary line about an event that did not happen.
  const at = p.entry ?? card.columnSlug;
  const moved = p.exitPass !== undefined && p.exitPass !== at ? p.exitPass : undefined;
  if (moved !== undefined) {
    const stamped = await stamp(deps, card, moved, `its ${action.skill} run completed.`);
    // `dispatches: 1` EVEN HERE, and that is not tidiness: a dispatch that happened and then failed to move
    // its card was reported as no dispatch at all, so neither cap was told about a real agent run, the tick
    // counted as idle, and the next tick re-picked the same card and dispatched over work that had already
    // passed — three times over, until the attempt cap caught it.
    if (!stamped.ok) {
      return refused(deps, `could not advance ${card.id} to ${moved}`, stamped.reason, stamped.fatal, 1);
    }
  }
  // The STRUCTURED fields as well as the sentence. `DiaryEntry` carries `iteration`, `card`, `board`, `skill`
  // and `outcome` precisely so the diary's readers do not have to regex prose.
  await deps.client.log('run', runLine(card, action, settled, moved, context), {
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
// A CREATING PHASE THAT PRODUCED NO CARD, and the two endings it now has. `undefined` means this was not
// that case, so the caller falls through to everything else.
//
// ONE FUNCTION RATHER THAN TWO BRANCHES IN `afterCardRun`, for a measured reason. The branches took that
// function to a cognitive complexity of 17 against a ceiling of 15, and flattening the nesting first —
// which is what CODE-QUALITY.md says to try before extracting — moved it not at all.
async function whenNoCardWasCreated(
  deps: ActDeps,
  action: Dispatch,
  card: Card,
  settled: RunRecord,
  context: TickContext,
  grew: boolean | undefined,
): Promise<ActResult | undefined> {
  if (grew !== false || !CREATING_PHASES.includes(action.phase)) return undefined;
  // UNLESS IT CREATED NOTHING BECAUSE THERE WAS NOTHING TO CREATE (decision 71). A card whose work already
  // exists cannot be finished by a phase that only succeeds by producing more of it: the attempt burns,
  // three times, and the loop stops on a card that was done before it was written. The claim is CHECKED —
  // see `coverageHolds` — which is what separates it from the unverifiable claim decision 43 refuses.
  const covered = await coverageHolds(deps, settled, card.board);
  if (covered.holds) {
    return await advanceOnCoverage(deps, action, card, settled, context, covered.terminal);
  }
  return await recordEmptyCreate(deps, action, card, settled, context);
}

// THE CLAIM, VERIFIED AGAINST THE BOARD. Reads the board only when a claim was actually made, so the
// ordinary empty create — the one decision 43 is about — costs no extra request.
//
// A board that cannot be read answers `false`: a citation nobody could check is not a citation, and the
// safe direction here is the one that burns the attempt rather than the one that advances the card.
async function coverageHolds(
  deps: ActDeps,
  settled: RunRecord,
  cardBoard: BoardName,
): Promise<{ holds: boolean; terminal?: string }> {
  const claimed = settled.covered;
  if (claimed === undefined || claimed.length === 0) return { holds: false };
  const board = await deps.client.board();
  if (!board.ok) return { holds: false };
  const ap = board.value.config.autopilot ?? DEFAULT_AUTOPILOT;
  const cards = BOARDS.flatMap((b) => board.value.boards[b] ?? []);
  if (!coveredBy(ap, cards, claimed)) return { holds: false };
  // The board's FIRST terminal column. A board may name several and any of them settles a card; the
  // first is the one a person would have dragged it to, and autopilot-cover.ts already refuses a board
  // that names none.
  return { holds: true, terminal: (ap.terminal[cardBoard] ?? [])[0] };
}

// The card advances exactly as a creating run that DID grow the board would have — same exit stamp, same
// attempt accounting. The diary says which cards were cited, because "closed having created nothing" is a
// sentence a person will otherwise come looking for an explanation of.
async function advanceOnCoverage(
  deps: ActDeps,
  action: Dispatch,
  card: Card,
  settled: RunRecord,
  context: TickContext,
  terminal: string | undefined,
): Promise<ActResult> {
  // A TERMINAL COLUMN, AND NOT THE PHASE'S `exitPass` — found by running this live, because a unit test
  // that asserts the card moved cannot see what the tick does next.
  //
  // `phaseAction` in core/lifecycle/tick.ts opens with `if (stories.length === 0) return
  // dispatchPhase('feature-breakdown')`, BEFORE it looks at any column. A card that closed on coverage
  // has no children and never will — the work is under other cards — so moving it to `in-progress`,
  // which is this phase's `exitPass`, left the tick re-dispatching the same break-down until the attempt
  // cap stopped the project. Observed live: three break-downs, all three declaring coverage, all three
  // advancing the column, and the loop stalling anyway.
  //
  // Settled is what the tick reads, so settled is where the card has to go.
  if (terminal !== undefined) {
    const stamped = await stamp(deps, card, terminal, `its ${action.skill} run found the work already done.`);
    if (!stamped.ok) {
      return refused(deps, `could not advance ${card.id} to ${terminal}`, stamped.reason, stamped.fatal, 1);
    }
  }
  await deps.client.log('run', coveredLine(card, action, settled, context), {
    iteration: context.iteration + 1,
    card: card.id,
    board: card.board,
    skill: action.skill,
    outcome: settled.status,
  });
  return { dispatches: 1 };
}

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
