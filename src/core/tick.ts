import { attemptsUsed, burnsAttempt, type Spend } from './accounting.js';
import type { TickAction } from './actions.js';
import {
  AUTOPILOT_CONCURRENCY,
  type AutopilotConfig,
  isBlockedColumn,
  isTerminalColumn,
} from './autopilot.js';
import { shapeProblems } from './autopilot-cover.js';
import type { AutopilotState } from './autopilot-state.js';
import type { CardProblem } from './board.js';
import {
  creatingRoundSpent,
  inconclusiveReviews,
  latestWorkRun,
  outstandingVerdict,
  reviewsRun,
  verdictRun,
} from './bounds.js';
import { allSettled, hasUnfinishedChildren, isSettled } from './derived-status.js';
import { mayDispatch, type StopReason } from './dispatch-gate.js';
import { liveCards } from './hierarchy.js';
import { ARCHIVE_SLUG } from './layout.js';
import { type PhaseName, phase } from './phases.js';
import { derivePosition, type Position } from './position.js';
import { isProjectRun, type RunRecord } from './runs.js';
import type { BoardName, Card } from './types.js';

// One tick of the loop, as one pure function over data. No clock, no disk, no process, no model: it
// looks things up, compares them, and answers with exactly one action. That is what makes the whole
// loop testable — the service that calls this holds no decisions of its own.
//
// A thin ORCHESTRATOR. The table is in phases.ts, the derivation in position.ts, the counting in bounds.ts
// and the settled/blocked questions in derived-status.ts; every branch here is one call into one of them.
//
// THE ORDER IS THE BEHAVIOUR:
//
//   state       first, so a project somebody killed reports that rather than whatever else is also true;
//   shape       next, because every branch below indexes the config;
//   caps        next, so an over-budget project cannot spend one more dispatch deciding it is over budget;
//   problems    next: a card that will not parse makes the POSITION unknowable, so nothing after this
//               could be trusted (finding C);
//   in flight   next, because concurrency is 1 and a tick with nothing it may start need not work out
//               what it would have started;
//   position    next, derived from the board and never stored (decision 39);
//   phase       last, and it is a lookup on the machine rather than a question about a column.
//
// `rollup` and `checkup` are absent from that sequence deliberately: there are no rollup rules any more
// (decision 42) and the periodic checkup retires into the two lifecycle checkups (decision 47).

export type { TickAction } from './actions.js';

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
}

// How many unfinished cards a stalled stop names before it stops listing them. Long enough to be
// actionable, short enough that the overlay stays a sentence.
const NAMED = 5;

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

// MOVED HERE FROM eligibility.ts WITH THE COMPARISON IT GUARDS. Every bound in the machine is now counted by
// the tick — the bootstrap's attempts and each phase's — so this is where the number reaches a comparison.
// The same shape as `invalidCap` in dispatch-gate.ts and for the same reason: `used >= NaN` is false, so a cap
// that is not a number does not raise the limit, it deletes it. Fail closed and name the field.
function invalidAttemptCap(ap: AutopilotConfig): string | undefined {
  if (Number.isInteger(ap.attemptCap) && ap.attemptCap > 0) return undefined;
  return `attemptCap is ${JSON.stringify(ap.attemptCap)}, which is not a whole number above zero, so no attempt cap can bind. Set it in Settings.`;
}

// FINDING C. Carried here from eligibility.ts:73-77, whose deletion in slice 3 would otherwise take the only
// route by which an unreadable card reaches the loop — and Principle 1 says an absence must fail closed.
//
// The sentence is rewritten rather than copied: the old one explained the refusal in terms of the setup
// barrier's eligibility effect, which decision 44 removes. What makes it fail closed now is that the broken
// file could BE the open feature, or a child that would change which story is next.
function unreadableSentence(problems: CardProblem[]): string {
  const first = problems[0];
  const rest = problems.length > 1 ? ` (and ${problems.length - 1} more)` : '';
  return `${first?.path} could not be read: ${first?.reason}${rest}. Until every card parses, auto-pilot cannot tell where it is on the board — the broken file could be the feature it is in the middle of — so it has stopped rather than guess.`;
}

const names = (cards: Card[]): string => {
  const shown = cards
    .slice(0, NAMED)
    .map((c) => c.id)
    .join(', ');
  return cards.length > NAMED ? `${shown} (and ${cards.length - NAMED} more)` : shown;
};

const isAre = (cards: Card[]): string => (cards.length === 1 ? 'is' : 'are');

// Each unfinished card in exactly one bucket, most specific first: a card the loop itself blocked is
// blocked whatever else is true of it.
//
// There is no `barred` bucket. It existed only for the setup barrier's EFFECT ON ELIGIBILITY, which decision
// 44 removes — the barrier is a feature now, worked in its turn like any other — and a sentence about a rule
// that no longer exists is worse than no sentence.
function partitionStuck(
  ap: AutopilotConfig,
  cards: Card[],
  unfinished: Card[],
): { waiting: Card[]; rest: Card[] } {
  const waiting: Card[] = [];
  const rest: Card[] = [];
  for (const card of unfinished) {
    // The same rule that kept it from being worked, read back as a reason. A parent stuck behind one
    // blocked grandchild is the ordinary shape of a stalled board, and calling it unroutable — which is
    // what the first version of this message did — sends the reader to edit a routing table that is fine.
    if (hasUnfinishedChildren(ap, card, cards)) waiting.push(card);
    else rest.push(card);
  }
  return { waiting, rest };
}

// Why the remaining work is stuck, per KIND of stuck. One list of ids with one piece of advice named
// cards the loop had itself blocked and then told the reader to check their routing table — advice that is
// wrong for them. A message about a condition the reader cannot act on is a worse failure than the condition.
// `blocked` comes in SEPARATELY rather than out of `unfinished`, and that is decision 45's repeal: a blocked
// task is settled, so it is no longer part of what stops the project finishing. It is still NAMED, because a
// reader looking at a stalled board needs to know it is there — but the clause claiming it makes `complete`
// unreachable for ever is gone, since that is no longer true.
function whyStuck(ap: AutopilotConfig, cards: Card[], unfinished: Card[], blocked: Card[]): string {
  const { waiting, rest } = partitionStuck(ap, cards, unfinished);
  const parts: string[] = [];
  if (rest.length > 0) {
    // WHAT ACTUALLY PLACES A CARD, which is not a table the reader can edit. Under ruling 52 the phase table
    // is code and a column dispatches nothing, so "check that every column is routed, terminal or blocked" —
    // which this said — sent the reader to a routing table that no longer decides anything. What leaves a card
    // here is its column: one the phase table has no row for, so no phase claims it and every branch falls
    // through.
    parts.push(
      `Nothing can move ${names(rest)}: ${isAre(rest)} in a column the lifecycle has no phase for — a folder added by hand, or one taken out of the board's columns with cards still in it. Move ${rest.length === 1 ? 'it' : 'them'} to a column the board still has`,
    );
  }
  if (blocked.length > 0) {
    parts.push(
      `${names(blocked)} ran out of attempts and ${isAre(blocked)} in ${ap.blockedColumn}, waiting for you`,
    );
  }
  if (waiting.length > 0) {
    parts.push(
      `${names(waiting)} ${isAre(waiting)} waiting for ${waiting.length === 1 ? 'its' : 'their'} own cards further down to finish`,
    );
  }
  return `${parts.join('. ')}.`;
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
  const tried = runs.filter((r) => isProjectRun(r) && r.skill === skill && burnsAttempt(r.status)).length;
  if (tried < ap.attemptCap) return { kind: 'dispatch', phase: 'bootstrap', skill };
  return stop(
    'stalled',
    `The board is empty and ${skill} has used all ${ap.attemptCap} attempts at deriving it from the README. Read its runs: the README may be too thin to derive features from, in which case say more in it, or add the first card by hand.`,
  );
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
function nothingToWorkOn(ap: AutopilotConfig, cards: Card[], runs: RunRecord[]): TickAction {
  const live = liveCards(cards);
  const halfArchived = halfArchivedStop(cards);
  if (halfArchived) return halfArchived;
  const blocked = live.filter((c) => isBlockedColumn(ap, c.board, c.columnSlug));
  // CHANGE 2 of decision 45's repeal: `unfinished` counts what is not SETTLED, so a blocked task leaves it.
  // Change 1 alone — dropping the sentence — would have left `complete` exactly as unreachable as before,
  // because `complete`'s condition is computed from this set.
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
  return finished(ap, live, blocked);
}

// THE ONLY SUCCESS, asserted rather than implied — CHANGE 4, and it exists because the other three open a
// false success. Positive evidence used to be an IMPLICATION of "nothing unfinished and something live"
// rather than a test, and taking blocked tasks out of `unfinished` breaks the implication: a board holding
// nothing but a blocked task would report the project finished.
function finished(ap: AutopilotConfig, live: Card[], blocked: Card[]): TickAction {
  if (!live.some((c) => isTerminalColumn(ap, c.board, c.columnSlug))) {
    const left = blocked.length > 0 ? blocked : live;
    return stop(
      'stalled',
      `${names(left)} ${isAre(left)} all that is left on this project and nothing on it is finished, so there is work outstanding and nothing auto-pilot can do about it.`,
    );
  }
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
    `Auto-pilot finished. ${count} ${isAre(blocked)} blocked and ${blocked.length === 1 ? 'needs' : 'need'} you: ${names(blocked)}.`,
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
// NOT THE FEATURE'S, and not either checkup: a feature has no sibling to carry on with, and a checkup point
// that will not close is a judgement about work that is already done rather than work nobody could start.
// Both still stop the loop and name themselves (the spec's own cycle table).
const BLOCKS_AT_CAP: readonly PhaseName[] = ['story-breakdown'];

// A card that has used every attempt at one skill.
function capReached(input: TickInput, name: PhaseName, card: Card, skill: string): TickAction | undefined {
  const { ap } = input;
  if (attemptsUsed(input.runs, card.id, skill) < ap.attemptCap) return undefined;
  const used = `${card.id} has used all ${ap.attemptCap} attempts at ${skill}`;
  if (!BLOCKS_AT_CAP.includes(name)) {
    // IT DOES NOT SAY "this board has no blocked column", which is what it used to say and is now false for
    // two of the three phases that reach here: a story checkup's card sits on a board that HAS one, and the
    // loop declines to use it because the story's own work is already delivered. Nor may the two branches
    // share a phrase — while they did, planting `feature-breakdown` into the list above changed the answer
    // for a feature from this sentence to the one below and no test could tell.
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

// EITHER CHECKUP, and the one bound that is not an attempt count. DECISION 47: a checkup point gets ONE round
// of creation, and after that it may only close the card or stop.
//
// The round is read off the BOARD — a card stamped `createdBy` one of this card's own checkup runs — and never
// out of the run's own `created` list, which is the agent's claim about itself (ruling 58, finding F).
//
// `> 1` because the run that created is itself one of this card's checkup runs: more than one means a checkup
// has already had its close-or-stop turn and left the card open. Asking again is asking a model to change its
// mind, which decision 47 rejects as an exit condition.
//
// THE STORY'S IS ASKED TOO, and that is a correction. Ruling 54 makes creating siblings and closing the story
// ONE act, so there looks to be no second visit to bound — but that holds only while the exit stamp SUCCEEDS.
// A refused move leaves the story settled and in `in-progress`, and the next tick dispatches another checkup
// with a fresh creating round, up to `attemptCap` of them, each entitled to create more siblings.
function checkupPhase(
  input: TickInput,
  name: 'story-checkup' | 'feature-checkup',
  card: Card,
): TickAction | undefined {
  const skill = phase(name).skill;
  if (skill === undefined) return undefined;
  const spent = creatingRoundSpent(input.cards, input.runs, card.id, skill);
  if (spent && attemptsUsed(input.runs, card.id, skill) > 1) {
    const what = name === 'feature-checkup' ? 'feature' : 'story';
    return stop(
      'stalled',
      `${card.id} has already had its one round of creating work, and the checkup after it still did not close the ${what}. Read its runs: what it believes is missing needs a person now, or belongs in a suggestion.`,
    );
  }
  return dispatchPhase(input, name, card);
}

// THE STORY LOOP, rows P2, P2s and P6.
function storyPhase(input: TickInput, story: Card, tasks: Card[]): TickAction | undefined {
  if (tasks.length === 0) return dispatchPhase(input, 'story-breakdown', story);
  if (ENTERING.includes(story.columnSlug)) {
    return skipPhase('story-breakdown-skip', story, 'it already has tasks, so its break-down is skipped.');
  }
  if (allSettled(input.ap, tasks)) return checkupPhase(input, 'story-checkup', story);
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
// AT THE CAP IT GOES TO REVIEW ANYWAY, which is the one bound in the machine that neither stops nor blocks:
// the gates and the reviewer are better placed to judge three failed attempts than a counter is.
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
    `it has used all ${input.ap.attemptCap} attempts at ${skill}, so the gates and the reviewer judge it as it stands.`,
  );
}

// ROW P5. ONE FIX BUDGET FOR BOTH SEND-BACK KINDS: a task can be sent back by a gate or by the reviewer and
// both spend the same count. Two budgets would let a task alternate — fail the gates three times, then fail
// the review three times — and spend twice what the cap says while looking compliant.
//
// AT THE CAP IT IS BLOCKED AND THE LOOP CARRIES ON (decision 45). `blocked` means judged unfixable, and it
// settles the story so the checkup can close it: stopping the project instead means one task nobody can fix
// costs you every feature after it.
function fixPhase(input: TickInput, task: Card, carrying: RunRecord): TickAction | undefined {
  const skill = phase('task-fix').skill;
  if (skill === undefined) return undefined;
  if (attemptsUsed(input.runs, task.id, skill) < input.ap.attemptCap) {
    return { kind: 'dispatch', phase: 'task-fix', skill, card: task, previous: carrying.run };
  }
  return stampTo(
    'task-fix',
    task,
    input.ap.blockedColumn,
    `it has used all ${input.ap.attemptCap} attempts at ${skill} and still cannot pass, so auto-pilot has left it for you and carried on.`,
  );
}

// ROWS P4 and P4r. A task in review whose work run ALREADY carries a verdict is re-stamped and never
// re-judged — "has this already been done", answered from the record rather than paid for twice.
//
// The review's bound counts INCONCLUSIVE reviews only, and exhausting it stops the loop naming THE REVIEW
// rather than blocking the task: `blocked` means judged unfixable, and a review that failed, timed out or
// crashed produced no verdict at all. Marking its task blocked would put a dead API key on the board
// permanently as work nobody can fix.
function reviewPhase(input: TickInput, task: Card): TickAction | undefined {
  const judging = latestWorkRun(input.runs, task.id);
  // THE LATEST WORK RUN's own verdict, which is what P4 and P4r are asked of — not `outstandingVerdict`, which
  // answers "the latest work run that carries a verdict" and is a different question. With that one, a task
  // sent back by its gates could never pass: the implement run's failure stayed outstanding after the fix, so
  // a fix that landed back in review was re-stamped to in-progress and fixed again, until the cap blocked a
  // task whose gates had failed exactly once. P5 still reads `outstandingVerdict`, where it IS the question.
  const already = judging?.verification;
  if (already) {
    const remove = phase('task-review-remove');
    const to = already.passed ? remove.exitPass : remove.exitFail;
    if (to === undefined) return undefined;
    const why = already.passed
      ? 'it has already passed; only the move was outstanding.'
      : 'it was already sent back; only the move was outstanding.';
    return stampTo('task-review-remove', task, to, why);
  }
  const skill = phase('task-review').skill;
  if (skill === undefined || judging === undefined) return undefined;
  if (inconclusiveReviews(input.runs, task.id) >= input.ap.attemptCap) {
    return stop(
      'stalled',
      `${task.id}'s review has failed to reach a verdict ${input.ap.attemptCap} times. That is a review that cannot complete rather than work nobody can fix, so auto-pilot has stopped: read the review runs — an API key, a disk or a model is the likelier cause than the card.`,
    );
  }
  // AND A TOTAL, which is the number the spec's arithmetic row already states. The trigger above asks whether
  // the latest WORK run carries a verification, so a review that answered and whose verdict could not be
  // WRITTEN leaves that run exactly as it was: it is not inconclusive — it has a verdict — and `dispatches: 1`
  // resets the idle counter, so neither of the other two bounds ever arrives and the task pays for a full
  // review every tick for as long as the write keeps failing.
  //
  // `attemptCap + 1` is the healthy maximum rather than a margin: implement, then a review and a fix for each
  // of `attemptCap` send-backs, then the review that passes. So this cannot stall a task that is making
  // progress, and it stops the loop naming THE REVIEW rather than blocking the task — same distinction as the
  // bound above, and for the same reason.
  if (reviewsRun(input.runs, task.id) >= input.ap.attemptCap + 1) {
    return stop(
      'stalled',
      `${task.id} has had ${input.ap.attemptCap + 1} reviews, which is every review its fix budget can justify, and it is still in review. Read the review runs and the run they judged: a verdict that cannot be recorded looks exactly like this, and it is a problem with this server rather than with the card.`,
    );
  }
  return { kind: 'dispatch', phase: 'task-review', skill, card: task, previous: judging.run };
}

const byQueueOrder = (a: Card, b: Card): number =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ONE TASK AT A TIME, and the first unsettled one by (order, then id). The trace's own shape: a task goes all
// the way to done before the next is picked up, which is what `AUTOPILOT_CONCURRENCY = 1` means one level in.
function taskPhase(input: TickInput, tasks: Card[]): TickAction | undefined {
  const next = [...tasks].sort(byQueueOrder).find((t) => !isSettled(input.ap, t));
  if (next === undefined) return undefined;
  if (next.columnSlug === 'review') return reviewPhase(input, next);
  const verdict = outstandingVerdict(input.runs, next.id);
  // An OUTSTANDING FAILED verdict is what tells P5 from P3 in the same column: `in-progress` is stamped both
  // before an implement run and while a fix one runs, and which of the two it means is derived rather than
  // given a column of its own (ruling 53).
  if (verdict && !verdict.passed) {
    const carrying = verdictRun(input.runs, next.id);
    if (carrying) return fixPhase(input, next, carrying);
  }
  if (next.columnSlug === 'backlog' || next.columnSlug === 'in-progress') {
    return implementPhase(input, next);
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
  return allSettled(input.ap, stories) ? checkupPhase(input, 'feature-checkup', feature) : undefined;
}

export function decideTick(input: TickInput): TickAction {
  const { ap, state, cards, runs, spend, inFlight, problems } = input;
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

  if (problems.length > 0) return stop('stalled', unreadableSentence(problems));

  // BEFORE the position is derived, and that is a change from the old sequence. There, a card with a run in
  // flight was still eligible and the wait had to come after the empty check or a healthy loop reported
  // `stalled` over the work it was waiting for. Nothing in the derivation reads a run, so there is no
  // eligibility to fall out of — and a tick that may start nothing need not work out what it would have.
  if (inFlight.length >= AUTOPILOT_CONCURRENCY) return { kind: 'wait' };

  const found = derivePosition(cards);
  if ('problem' in found) return stop('stalled', found.problem);
  if ('position' in found) {
    const action = phaseAction(input, found.position);
    if (action) return action;
  }
  return nothingToWorkOn(ap, cards, runs);
}
