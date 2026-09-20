import type { CardProblem } from '../../store/cards/board.js';
import type { DeclaredCommands } from '../../store/project/foundation.js';
import {
  attemptsUsed,
  burnsAttempt,
  consecutiveInfrastructureFailures,
  INFRASTRUCTURE_STREAK,
  type Spend,
} from '../accounting.js';
import type { TickAction } from '../actions.js';
import {
  AUTOPILOT_CONCURRENCY,
  type AutopilotConfig,
  isBlockedColumn,
  isTerminalColumn,
} from '../autopilot.js';
import { shapeProblems } from '../autopilot-cover.js';
import type { AutopilotState } from '../autopilot-state.js';
import { byQueueOrder } from '../board/ordering.js';
import {
  creatingRoundSpent,
  inconclusiveReviews,
  latestWorkRun,
  outstandingVerdict,
  reviewsRun,
  verdictRun,
} from '../bounds.js';
import { allSettled, isSettled } from '../derived-status.js';
import { mayDispatch, type StopReason } from '../dispatch-gate.js';
import { childrenOf, liveCards } from '../hierarchy.js';
import { ARCHIVE_SLUG } from '../layout.js';
import { type PhaseName, phase } from '../phases.js';
import { derivePosition, type Position } from '../position.js';
import { isProjectRun, type RunRecord } from '../runs.js';
import type { BoardName, Card } from '../types.js';
import {
  focusFinishedSentence,
  invalidAttemptCap,
  isAre,
  machineBrokenSentence,
  names,
  smokeIsAGate,
  unreadableSentence,
  whyStuck,
} from './stop-sentences.js';

// One tick of the loop, as one pure function over data. No clock, no disk, no process, no model: it
// looks things up, compares them, and answers with exactly one action. That is what makes the whole
// loop testable — the service that calls this holds no decisions of its own.
//
// A thin ORCHESTRATOR. The table is in phases.ts, the derivation in position.ts, the counting in bounds.ts
// and the settled/blocked questions in derived-status.ts; every branch here is one call into one of them.
// The sentences a person reads are in stop-sentences.ts, for the same reason: what to do and how to say it
// are different subjects, and the prose was two-thirds of this file.
//
// THE ORDER IS THE BEHAVIOUR:
//
//   state       first, so a project somebody killed reports that rather than whatever else is also true;
//   shape       next, because every branch below indexes the config;
//   caps        next, so an over-budget project cannot spend one more dispatch deciding it is over budget;
//   machine     next, and BEFORE anything reads the board: every branch below this line is a claim about
//               a card, and while the machine is failing every one of them is an accusation aimed at the
//               wrong thing;
//   problems    next: a card that will not parse makes the POSITION unknowable, so nothing after this
//               could be trusted (finding C);
//   in flight   next, because concurrency is 1 and a tick with nothing it may start need not work out
//               what it would have started;
//   position    next, derived from the board and never stored (decision 39);
//   phase       last, and it is a lookup on the machine rather than a question about a column.
//
// `rollup` and `checkup` are absent from that sequence deliberately: there are no rollup rules any more
// (decision 42) and the periodic checkup retires into the two lifecycle checkups (decision 47).

export type { TickAction } from '../actions.js';

export interface TickInput {
  ap: AutopilotConfig;
  state: AutopilotState;
  cards: Card[];
  columns: Record<BoardName, string[]>; // ordered slugs per board, for the columns a stamp names
  runs: RunRecord[];
  spend: Spend;
  // The runs queued or running right now, WITH their identities. A bare count was enough for
  // one run and wrong for more than one: `attemptsUsed` deliberately does not
  // count an unfinished run, so the card being worked stays eligible, and the second tick dispatched the
  // same card again — two agents editing one card's work in one repository, which is the collision
  // decision 4 exists to prevent.
  //
  // `card` is absent for a project run (the bootstrap), which counts towards the limit and belongs to no card.
  inFlight: { card?: string; skill: string }[];
  problems: CardProblem[]; // whatever `readBoard` could not parse — required, never optional
  // THE COMMANDS THE FOUNDATION DOCUMENTS DECLARE, gathered by the loop off disk. Required for the same reason
  // `problems` is: an absent field reads as "nothing to say", which is the fail-open default the one check
  // below exists to close.
  //
  // Only `finished` reads them, and only to compare two strings — the RESULT of running either is not the
  // tick's business, and nothing here spawns anything.
  commands: DeclaredCommands;
}

const stop = (reason: StopReason, detail?: string): TickAction => ({
  kind: 'stop',
  reason,
  ...(detail === undefined ? {} : { detail }),
});

// A state this function has no business deciding for. The service checks the state before every tick
// (which is what makes a soft stop written between ticks take effect), but the refusal belongs here
// too: Principle 1 puts it where the decision is made rather than trusting a guard upstream.
//
// The reason on the state is preserved where there is one — a halt must keep saying why it halted.
function notRunning(state: AutopilotState): TickAction {
  if (state.reason) return stop(state.reason, state.detail);
  return stop('stopped', `Auto-pilot is ${state.state}, so there is nothing to decide.`);
}

// THE BOOTSTRAP. The one state where the loop derives the board itself: an empty board and a README is a
// project that has said what it wants and has nothing to pick up yet.
//
// The skill comes from the PHASE TABLE (ruling 52), not from `routes` in config.yaml. Bounded by the same
// attempt cap as anything else, counted over PROJECT runs of that skill — a card-less run has no card for
// `attemptsUsed` to count it against, so this is the only tally there is.
function bootstrap(ap: AutopilotConfig, runs: RunRecord[]): TickAction | undefined {
  const skill = phase('bootstrap').skill;
  if (skill === undefined) return undefined;
  const tried = runs.filter((r) => isProjectRun(r) && r.skill === skill && burnsAttempt(r)).length;
  if (tried < ap.attemptCap) return { kind: 'dispatch', phase: 'bootstrap', skill };
  return stop(
    'stalled',
    `The board is empty and ${skill} has used all ${ap.attemptCap} attempts at deriving it from the README. Read its runs: the README may be too thin to derive features from, in which case say more in it, or add the first card by hand.`,
  );
}

// THE OTHER HALF OF NOT BURNING AN ATTEMPT, and without it the fix is worse than the bug it fixes. Once an
// infrastructure failure costs a card nothing, a project whose credential has died retries the same card for
// ever: every tick dispatches, the run fails in 58ms, the tally does not move, and the loop runs to its
// iteration cap having done nothing and explained none of it. The attempt cap used to be what caught this —
// wrongly, by blaming a card — so something else has to, and this is it.
//
// A PROPERTY OF THE PROJECT, not of any card, which is exactly the distinction the user is owed and the
// reason no card id appears in the sentence. The run that produced this reported that one story had used all
// three of its attempts and somebody should read it and change what it asks for; nothing had ever opened it.
//
// WHAT IT SAYS IS IN stop-sentences.ts, and that split is worth more here than anywhere else in this file:
// the sentence had to be corrected because it prescribed a remedy — rebuilding the agent boxes — that was the
// wrong one the morning it mattered, while the branch below, which blames the project rather than a card, was
// right both times. Wording that has to be argued about does not belong in the guard that raises it.
//
// `since` is when auto-pilot last STARTED, and it is what keeps this from bricking the project it
// protects — see `consecutiveInfrastructureFailures`. Pressing Start is the user saying they have fixed
// the machine, and the streak has to be allowed to believe them or nothing can ever get past this guard.
function machineBroken(runs: RunRecord[], since?: string): TickAction | undefined {
  const streak = consecutiveInfrastructureFailures(runs, since);
  if (streak.length < INFRASTRUCTURE_STREAK) return undefined;
  return stop('infrastructure', machineBrokenSentence(streak));
}

// A card that is NOT live and NOT in the archive is a half-finished archive, and it was invisible to every
// set `complete` is decided from. `archiveCard` stamps the frontmatter and THEN moves the file, so a server
// killed between those two writes leaves exactly this; so does a hand-edit through `PUT /raw`. The board
// still renders the card, and auto-pilot called the project finished over work the user can see.
function halfArchivedStop(cards: Card[]): TickAction | undefined {
  const half = cards.filter((c) => !liveCards([c]).length && c.columnSlug !== ARCHIVE_SLUG);
  if (half.length === 0) return undefined;
  return stop(
    'stalled',
    `${names(half)} ${isAre(half)} marked archived but still in a live column, so auto-pilot cannot tell whether ${half.length === 1 ? 'it is' : 'they are'} work or not. Archive ${half.length === 1 ? 'it' : 'them'} properly, or clear the archived field.`,
  );
}

// No feature to work on. The three endings that look alike and are not, kept apart because conflating them
// produced the worst failure on record: success reported over unfinished work.
//
// `complete` requires that no non-terminal card exists anywhere AND positive evidence that finished work
// does. Absence of unfinished work is not presence of finished work: an empty board, a board archived down
// to nothing, and a fetch that returned nothing all produce the same empty list.
// A FOCUSED RUN THAT FINISHED ITS FEATURE IS A SUCCESS, and this exists because the first version reported
// it as a STALL. Found on a live run rather than by a test: `F-001` closed with its five stories and five
// tasks done and its smoke command passing, and the loop stopped saying "work remains and nothing it can do
// would move it" — true of the untouched feature behind it, false of the thing the person asked for. A stall
// is an alarm, and it sends somebody looking for a fault that is not there.
//
// POSITIVE EVIDENCE, never an implication, which is `finished`'s own rule one level in: the focused card has
// to be ON the board and IN a terminal column. A focus naming a card that has gone is already refused by
// `derivePosition`, and inferring success from "nothing eligible" is how a board holding one blocked card
// came to report a project finished.
//
// BLOCKED CARDS ARE COUNTED UNDER THE FOCUS ONLY. One belonging to another feature is work this run was told
// not to do, so naming it here would report as a hazard of the run something the run was instructed to leave.
function focusFinished(
  ap: AutopilotConfig,
  live: Card[],
  commands: DeclaredCommands,
): TickAction | undefined {
  if (ap.focus === undefined) return undefined;
  const feature = live.find((c) => c.id === ap.focus);
  if (!feature || !isTerminalColumn(ap, feature.board, feature.columnSlug)) return undefined;
  const stories = childrenOf(feature, live);
  const subtree = [...stories, ...stories.flatMap((story) => childrenOf(story, live))];
  const blocked = subtree.filter((c) => isBlockedColumn(ap, c.board, c.columnSlug));
  // `smokeIsAGate` applies here for the reason it applies to an unfocused finish (ruling 66): a smoke command
  // that IS one of the gate commands has exercised nothing, so there is no evidence the product runs — and a
  // focused run reaching that state is no better placed to claim success than a whole project is.
  const unexercised = smokeIsAGate(commands);
  if (unexercised !== undefined && blocked.length === 0) return stop('stalled', unexercised);
  const untouched = live.filter((c) => c.board === 'features' && c.id !== feature.id && !isSettled(ap, c));
  return stop('complete', focusFinishedSentence(feature.id, untouched, blocked));
}

function nothingToWorkOn(
  ap: AutopilotConfig,
  cards: Card[],
  runs: RunRecord[],
  commands: DeclaredCommands,
): TickAction {
  const live = liveCards(cards);
  const halfArchived = halfArchivedStop(cards);
  if (halfArchived) return halfArchived;
  const blocked = live.filter((c) => isBlockedColumn(ap, c.board, c.columnSlug));
  // CHANGE 2 of decision 45's repeal: `unfinished` counts what is not SETTLED, so a blocked task leaves it.
  // Change 1 alone — dropping the sentence — would have left `complete` exactly as unreachable as before,
  // because `complete`'s condition is computed from this set.
  // BEFORE THE STALL, because under a focus the two are the same board state and only one of them is true:
  // the features left in the backlog ARE unfinished, and they are unfinished by instruction.
  const focused = focusFinished(ap, live, commands);
  if (focused) return focused;
  const unfinished = live.filter((c) => !isSettled(ap, c));
  if (unfinished.length > 0) {
    return stop(
      'stalled',
      `There is nothing auto-pilot can work on. ${whyStuck(ap, cards, unfinished, blocked)}`,
    );
  }
  if (live.length === 0) {
    if (cards.length === 0) return bootstrap(ap, runs) ?? stop('no-op', 'There is no card on any board.');
    return stop('no-op', `Every one of the ${cards.length} cards on this project is archived.`);
  }
  return finished(ap, live, blocked, commands);
}

// THE ONLY SUCCESS, asserted rather than implied — CHANGE 4, and it exists because the other three open a
// false success. Positive evidence used to be an IMPLICATION of "nothing unfinished and something live"
// rather than a test, and taking blocked tasks out of `unfinished` breaks the implication: a board holding
// nothing but a blocked task would report the project finished.
function finished(
  ap: AutopilotConfig,
  live: Card[],
  blocked: Card[],
  commands: DeclaredCommands,
): TickAction {
  if (!live.some((c) => isTerminalColumn(ap, c.board, c.columnSlug))) {
    const left = blocked.length > 0 ? blocked : live;
    return stop(
      'stalled',
      `${names(left)} ${isAre(left)} all that is left on this project and nothing on it is finished, so there is work outstanding and nothing auto-pilot can do about it.`,
    );
  }
  const unexercised = smokeIsAGate(commands);
  // NOT WHILE SOMETHING IS BLOCKED, which is decision 45's argument unchanged one level out: a card that ran out
  // of attempts has had every attempt it is allowed, and a project holding one must not be held hostage over a
  // command no run can now change. So the ending is `complete` and it names BOTH facts — what it left behind and
  // that nothing exercised the product — because naming it is what makes carrying on safe.
  if (unexercised !== undefined && blocked.length === 0) return stop('stalled', unexercised);
  // AND `complete` SAYS WHAT IT LEFT BEHIND (decision 45). Without the sentence the repeal would be a silent
  // success over work a person still has to deal with.
  if (blocked.length === 0) return stop('complete');
  // "CARD" AND NOT "TASK", because a story can be blocked too since decision 45's 2026-08-13 correction.
  // The sentence is the whole visible part of that repeal — a `complete` that did not say what it left
  // behind would be a silent success over work a person still has to deal with — so naming the wrong kind
  // of thing in it is not a wording detail.
  const count = `${blocked.length} card${blocked.length === 1 ? '' : 's'}`;
  return stop(
    'complete',
    `Auto-pilot finished. ${count} ${isAre(blocked)} blocked and ${blocked.length === 1 ? 'needs' : 'need'} you: ${names(blocked)}.${unexercised === undefined ? '' : ` ${unexercised}`}`,
  );
}

// The two columns a card sits in on its way INTO the machine. Not read from config: `terminal` says where
// work ends, and these say a card has been picked up but its children are not being worked yet.
const ENTERING = ['backlog', 'todo'];

// THE PHASES THAT LEAVE THEIR CARD BLOCKED RATHER THAN STOPPING THE PROJECT, above engineering.
//
// A STORY'S BREAK-DOWN, by decision 45's 2026-08-13 correction. "Tasks only" was argued from a failed
// break-down having nothing below it to carry on with — true of a feature, false of a story, which sits
// among siblings exactly as a task does. The run that produced this had P-001 delivered and closed, then
// P-002 — the same story under another title — could not be broken down three times because P-001's tasks
// had already satisfied it, and the loop stopped the whole project over it with three features queued
// behind. Blocked settles the story, the feature carries on with the next one, and the checkups see it.
//
// NOT THE FEATURE'S, and not its checkup: a feature has no sibling to carry on with, and a checkup point
// that will not close is a judgement about work that is already done rather than work nobody could start.
// Both still stop the loop and name themselves (the spec's own cycle table).
const BLOCKS_AT_CAP: readonly PhaseName[] = ['story-breakdown'];

// A card that has used every attempt at one skill.
function capReached(input: TickInput, name: PhaseName, card: Card, skill: string): TickAction | undefined {
  const { ap } = input;
  if (attemptsUsed(input.runs, card.id, skill) < ap.attemptCap) return undefined;
  const used = `${card.id} has used all ${ap.attemptCap} attempts at ${skill}`;
  if (!BLOCKS_AT_CAP.includes(name)) {
    // IT DOES NOT SAY "this board has no blocked column", which is what it used to say and which is a claim
    // about the board rather than about this branch. Nor may the two branches share a phrase — while they
    // did, planting `feature-breakdown` into the list above changed the answer for a feature from this
    // sentence to the one below and no test could tell.
    return stop(
      'stalled',
      `${used}, and there is nothing else auto-pilot can try on it: read its runs, then move ${card.id} or change what it asks for.`,
    );
  }
  // FAIL CLOSED WHERE THE STAMP CANNOT LAND. Product gained its blocked column on 2026-08-13 and there is
  // no migration (ruling 59), so every project scaffolded before that has none — and a column IS a folder,
  // so stamping one the board does not have does not fail: it CREATES the folder and puts the card where
  // `readBoard` never looks. The honest answer there is the old one, naming what the board is missing.
  if (!(input.columns[card.board] ?? []).includes(ap.blockedColumn)) {
    return stop(
      'stalled',
      `${used}, and the ${card.board} board has no ${ap.blockedColumn} column to leave it in, so auto-pilot cannot carry on to the next one. Add a ${ap.blockedColumn} column to that board, or read ${card.id}'s runs and change what it asks for.`,
    );
  }
  return stampTo(
    name,
    card,
    ap.blockedColumn,
    `it has used all ${ap.attemptCap} attempts at ${skill} and still has nothing under it, so auto-pilot has left it for you and carried on.`,
  );
}

// A dispatching phase, bounded. The skill comes from the TABLE rather than the call site, so the one place
// that says which skill a phase runs is the table — and `undefined` falls through rather than throwing,
// because a phase with no skill is one the loop carries out alone and never dispatches.
function dispatchPhase(input: TickInput, name: PhaseName, card: Card): TickAction | undefined {
  const skill = phase(name).skill;
  if (skill === undefined) return undefined;
  return capReached(input, name, card, skill) ?? { kind: 'dispatch', phase: name, skill, card };
}

// A phase the loop carries out alone. `exitPass` rather than a column named here: the table already says
// where a skipped break-down lands, and naming it twice is two places for it to disagree.
function skipPhase(name: PhaseName, card: Card, why: string): TickAction | undefined {
  const to = phase(name).exitPass;
  return to === undefined ? undefined : { kind: 'stamp', phase: name, card, to, why };
}

// EITHER POINT WHERE A CARD IS CLOSED BY A JUDGEMENT, and the one bound that is not an attempt count.
// DECISION 47: such a point gets ONE round of creation, and after that it may only close the card or stop.
//
// The round is read off the BOARD — a card stamped `createdBy` one of this card's own runs of that skill — and
// never out of the run's own `created` list, which is the agent's claim about itself (ruling 58, finding F).
//
// `> 1` because the run that created is itself one of them: more than one means the point has already had its
// close-or-stop turn and left the card open. Asking again is asking a model to change its mind, which
// decision 47 rejects as an exit condition.
//
// THE STORY'S IS ASKED TOO, and that is a correction. Ruling 54 makes creating siblings and closing the story
// ONE act, so there looks to be no second visit to bound — but that holds only while the exit stamp SUCCEEDS.
// A refused move leaves the story settled and in `in-progress`, and the next tick dispatches another
// judgement with a fresh creating round, up to `attemptCap` of them, each entitled to create more siblings.
function creatingRoundStop(
  input: TickInput,
  name: 'story-review' | 'feature-checkup',
  card: Card,
  skill: string,
): TickAction | undefined {
  const spent = creatingRoundSpent(input.cards, input.runs, card.id, skill);
  if (!spent || attemptsUsed(input.runs, card.id, skill) <= 1) return undefined;
  const what = name === 'feature-checkup' ? 'feature' : 'story';
  const after = name === 'feature-checkup' ? 'checkup' : 'review';
  return stop(
    'stalled',
    `${card.id} has already had its one round of creating work, and the ${after} after it still did not close the ${what}. Read its runs: what it believes is missing needs a person now, or belongs in a suggestion.`,
  );
}

// THE FEATURE CHECKUP, which is the only checkup left: the story's retired into `story-review` (decision 80).
function checkupPhase(input: TickInput, card: Card): TickAction | undefined {
  const skill = phase('feature-checkup').skill;
  if (skill === undefined) return undefined;
  return (
    creatingRoundStop(input, 'feature-checkup', card, skill) ?? dispatchPhase(input, 'feature-checkup', card)
  );
}

// THE STORY LOOP, rows P2, P2s and P6 — and since decision 80, rows P4, P4r and P5 as well: every task
// settled is not a checkup point any more, it is where the story is JUDGED.
function storyPhase(input: TickInput, story: Card, tasks: Card[]): TickAction | undefined {
  if (tasks.length === 0) return dispatchPhase(input, 'story-breakdown', story);
  if (ENTERING.includes(story.columnSlug)) {
    return skipPhase('story-breakdown-skip', story, 'it already has tasks, so its break-down is skipped.');
  }
  if (allSettled(input.ap, tasks)) return judgeStory(input, story);
  return taskPhase(input, tasks);
}

// A phase the loop carries out alone, to a column the CALLER names. The two send-back destinations and the
// blocked column are not the phase's `exitPass`, so they cannot be read off the table like a skip's.
const stampTo = (name: PhaseName, card: Card, to: string, why: string): TickAction => ({
  kind: 'stamp',
  phase: name,
  card,
  to,
  why,
});

// ROW P3. A task in `backlog`, or in `in-progress` with no outstanding failed verdict — a crashed dispatch
// left it there and it has not been sent back, so it is still implement's phase.
//
// AT THE CAP IT IS SETTLED ANYWAY, which is the one bound in the machine that neither stops nor blocks: the
// gates and the judge are better placed to say what three failed attempts left behind than a counter is, and
// since decision 80 both of those run over the STORY — which a settled task is what lets reach them.
function implementPhase(input: TickInput, task: Card): TickAction | undefined {
  const skill = phase('task-implement').skill;
  const to = phase('task-implement').exitPass;
  if (skill === undefined || to === undefined) return undefined;
  if (attemptsUsed(input.runs, task.id, skill) < input.ap.attemptCap) {
    return { kind: 'dispatch', phase: 'task-implement', skill, card: task };
  }
  return stampTo(
    'task-implement',
    task,
    to,
    `it has used all ${input.ap.attemptCap} attempts at ${skill}, so its story's gates and judgement take it as it stands.`,
  );
}

// ROW P5, AT EITHER LEVEL. ONE FIX BUDGET FOR BOTH SEND-BACK KINDS: a card can be sent back by a gate or by
// the judge and both spend the same count. Two budgets would let it alternate — fail the gates three times,
// then fail the judgement three times — and spend twice what the cap says while looking compliant.
//
// TWO PHASES SHARE THIS because the rule is the same one level up: since decision 80 the judgement is the
// STORY's, so a story sent back needs the same answer a task did. The name decides which row is stamped and
// which board the run lands on; nothing else differs, and writing it twice is two places for the budget to
// stop being one.
//
// AT THE CAP IT IS BLOCKED AND THE LOOP CARRIES ON (decision 45). `blocked` means judged unfixable, and it
// settles the card so the level above can close: stopping the project instead means one card nobody can fix
// costs you every feature after it.
function fixPhase(
  input: TickInput,
  name: 'task-fix' | 'story-fix',
  card: Card,
  carrying: RunRecord,
): TickAction | undefined {
  const skill = phase(name).skill;
  if (skill === undefined) return undefined;
  if (attemptsUsed(input.runs, card.id, skill) < input.ap.attemptCap) {
    return { kind: 'dispatch', phase: name, skill, card, previous: carrying.run };
  }
  return stampTo(
    name,
    card,
    input.ap.blockedColumn,
    `it has used all ${input.ap.attemptCap} attempts at ${skill} and still cannot pass, so auto-pilot has left it for you and carried on.`,
  );
}

// ROWS P4, P4r AND P5, AT THE STORY (decision 80). Which of the three this position is in is answered from
// the RECORD and not from a column, because product has none that means "awaiting judgement" and the format
// is frozen. The latest work run — a story's break-down, or the fix that answered a send-back — says it:
//
//   no verdict on it      the judgement has not happened      P4, judge it
//   a verdict that passed the judgement happened and only the move failed   P4r, re-stamp
//   a verdict that failed the story was sent back and nothing has answered  P5, fix it
//
// THE LATEST WORK RUN's own verdict, never `outstandingVerdict`, which answers "the latest work run that
// CARRIES a verdict" and is a different question. With that one a story sent back could never pass: the
// send-back's failure stays outstanding after the fix, so the fix would be dispatched again and again until
// the cap blocked a story that had been refused exactly once. That bug was found at task level and it is
// the same bug here, reached through the same lookup.
function judgeStory(input: TickInput, story: Card): TickAction | undefined {
  const judging = latestWorkRun(input.runs, story.id);
  const already = judging?.verification;
  if (already?.passed === true) {
    const to = phase('story-review').exitPass;
    if (to === undefined) return undefined;
    return stampTo('story-review', story, to, 'it has already passed; only the move was outstanding.');
  }
  if (already !== undefined && judging !== undefined) return fixPhase(input, 'story-fix', story, judging);
  return reviewPhase(input, story, judging);
}

// ROW P4. The judgement's bound counts INCONCLUSIVE judgements only, and exhausting it stops the loop naming
// THE REVIEW rather than blocking the story: `blocked` means judged unfixable, and a review that failed,
// timed out or crashed produced no verdict at all. Marking its story blocked would put a dead API key on the
// board permanently as work nobody can fix.
//
// `judging` may be ABSENT, and the dispatch still goes: a story whose tasks were made by hand, or one that
// skipped its break-down because it arrived with tasks attached, has no work run of its own — and refusing
// to judge it would leave the story unsettled for ever over a record that was never written. There is then
// nowhere to record a verdict, which the total below is exactly the bound for.
function reviewPhase(input: TickInput, story: Card, judging: RunRecord | undefined): TickAction | undefined {
  const skill = phase('story-review').skill;
  if (skill === undefined) return undefined;
  const creating = creatingRoundStop(input, 'story-review', story, skill);
  if (creating) return creating;
  if (inconclusiveReviews(input.runs, story.id) >= input.ap.attemptCap) {
    return stop(
      'stalled',
      `${story.id}'s review has failed to reach a verdict ${input.ap.attemptCap} times. That is a review that cannot complete rather than work nobody can fix, so auto-pilot has stopped: read the review runs — an API key, a disk or a model is the likelier cause than the card.`,
    );
  }
  // AND A TOTAL, which is the number the spec's arithmetic row already states. The trigger above asks whether
  // the latest WORK run carries a verification, so a review that answered and whose verdict could not be
  // WRITTEN leaves that run exactly as it was: it is not inconclusive — it has a verdict — and `dispatches: 1`
  // resets the idle counter, so neither of the other two bounds ever arrives and the story pays for a full
  // review every tick for as long as the write keeps failing.
  //
  // `attemptCap + 1` is the healthy maximum rather than a margin: the work, then a review and a fix for each
  // of `attemptCap` send-backs, then the review that passes. So this cannot stall a story that is making
  // progress, and it stops the loop naming THE REVIEW rather than blocking the story — same distinction as
  // the bound above, and for the same reason.
  if (reviewsRun(input.runs, story.id) >= input.ap.attemptCap + 1) {
    return stop(
      'stalled',
      `${story.id} has had ${input.ap.attemptCap + 1} reviews, which is every review its fix budget can justify, and it is still not closed. Read the review runs and the run they judged: a verdict that cannot be recorded looks exactly like this, and it is a problem with this server rather than with the card.`,
    );
  }
  return {
    kind: 'dispatch',
    phase: 'story-review',
    skill,
    card: story,
    ...(judging === undefined ? {} : { previous: judging.run }),
  };
}

// ONE TASK AT A TIME, and the first unsettled one by (order, then id). The trace's own shape: a task goes all
// the way to done before the next is picked up, which is what `AUTOPILOT_CONCURRENCY = 1` means one level in.
function taskPhase(input: TickInput, tasks: Card[]): TickAction | undefined {
  const next = [...tasks].sort(byQueueOrder).find((t) => !isSettled(input.ap, t));
  if (next === undefined) return undefined;
  const verdict = outstandingVerdict(input.runs, next.id);
  // An OUTSTANDING FAILED verdict is what tells P5 from P3 in the same column: `in-progress` is stamped both
  // before an implement run and while a fix one runs, and which of the two it means is derived rather than
  // given a column of its own (ruling 53). Since decision 80 only the loop's own correctness refusal writes
  // one here — a run that left nothing behind — because the judgement is the story's.
  if (verdict && !verdict.passed) {
    const carrying = verdictRun(input.runs, next.id);
    if (carrying) return fixPhase(input, 'task-fix', next, carrying);
  }
  if (next.columnSlug === 'backlog' || next.columnSlug === 'in-progress') {
    return implementPhase(input, next);
  }
  // A TASK THE OLD MACHINE LEFT IN `review`, which every board mid-flight when decision 80 landed is holding.
  // Its work is on the tree, and that is the whole of what `done` means for a task now — so it is settled
  // rather than left to make its story unjudgeable for ever. The column keeps its place in the scaffolder's
  // defaults; this is simply the only thing the loop does with one.
  const settle = phase('task-implement').exitPass;
  if (next.columnSlug === 'review' && settle !== undefined) {
    return stampTo(
      'task-implement',
      next,
      settle,
      'its work has landed, and what auto-pilot judges now is the story it belongs to.',
    );
  }
  // A column the machine has no row for — a folder somebody made, or one removed from the config with cards
  // still in it. Falling through reports it rather than guessing which phase it meant.
  return undefined;
}

// WHICH PHASE THE POSITION IS IN, and what to do about it. The order is the machine: a feature enters before
// its stories are worked, and L2 drains before L1 advances — a feature with an unsettled story must not reach
// its own checkup.
function phaseAction(input: TickInput, position: Position): TickAction | undefined {
  const { feature, story, stories, tasks } = position;
  if (stories.length === 0) return dispatchPhase(input, 'feature-breakdown', feature);
  // DECISION 50: a card that already has children skips its break-down, or a follow-up feature — which
  // arrives with its stories already attached — would get a second set of them.
  if (ENTERING.includes(feature.columnSlug)) {
    return skipPhase(
      'feature-breakdown-skip',
      feature,
      'it already has stories, so its break-down is skipped.',
    );
  }
  if (story) return storyPhase(input, story, tasks);
  // No story left to work. Every one of them settled is the checkup's trigger; anything else is a board the
  // machine cannot place, and falling through reports it rather than guessing.
  return allSettled(input.ap, stories) ? checkupPhase(input, feature) : undefined;
}

export function decideTick(input: TickInput): TickAction {
  const { ap, state, cards, runs, spend, inFlight, problems, commands } = input;
  if (state.state !== 'running') return notRunning(state);

  // The keys the tick INDEXES rather than compares — `terminal`, `blockedColumn`. Same reason as the numbers
  // below, and the failure was worse: with `terminal` absent, a board of childless cards never reached
  // `isTerminalColumn` and DISPATCHED — into a project where nothing could ever finish — while the same
  // config threw a TypeError out of `decideTick` as soon as one card had a child, ending the run rather than
  // the tick. `shapeProblems` is already pure and already exported.
  const shape = shapeProblems(ap);
  if (shape.length > 0) return stop('stalled', shape.join(' '));

  const gate = mayDispatch({ ap, iteration: state.iteration, spend });
  if (!gate.ok) return stop(gate.reason, gate.message);
  const capProblem = invalidAttemptCap(ap);
  if (capProblem) return stop('stalled', capProblem);

  // BEFORE THE BOARD IS READ AT ALL, which is the whole of what makes this a fix rather than a rewording:
  // every stop below names a card, and the failure being caught here is one in which no card was ever
  // opened. It sits after the caps because a project that is over budget is over budget whatever else is
  // also true, and the bill is a fact about the project too.
  const machine = machineBroken(runs, state.at);
  if (machine) return machine;

  if (problems.length > 0) return stop('stalled', unreadableSentence(problems));

  // BEFORE the position is derived, and that is a change from the old sequence. There, a card with a run in
  // flight was still eligible and the wait had to come after the empty check or a healthy loop reported
  // `stalled` over the work it was waiting for. Nothing in the derivation reads a run, so there is no
  // eligibility to fall out of — and a tick that may start nothing need not work out what it would have.
  if (inFlight.length >= AUTOPILOT_CONCURRENCY) return { kind: 'wait' };

  // THE FOCUS, from the config rather than from a field of its own on the input: it is a person's standing
  // instruction about this project, which is what that block holds, and a second home for it would be a
  // second answer the moment somebody edited one.
  const found = derivePosition(cards, ap.focus);
  if ('problem' in found) return stop('stalled', found.problem);
  if ('position' in found) {
    const action = phaseAction(input, found.position);
    if (action) return action;
  }
  return nothingToWorkOn(ap, cards, runs, commands);
}
