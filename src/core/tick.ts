import { burnsAttempt, type Spend } from './accounting.js';
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
import { hasUnfinishedChildren } from './derived-status.js';
import { mayDispatch, type StopReason } from './dispatch-gate.js';
import { liveCards } from './hierarchy.js';
import { ARCHIVE_SLUG } from './layout.js';
import { phase } from './phases.js';
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
): { blocked: Card[]; waiting: Card[]; rest: Card[] } {
  const blocked: Card[] = [];
  const waiting: Card[] = [];
  const rest: Card[] = [];
  for (const card of unfinished) {
    if (isBlockedColumn(ap, card.board, card.columnSlug)) blocked.push(card);
    // The same rule that kept it from being worked, read back as a reason. A parent stuck behind one
    // blocked grandchild is the ordinary shape of a stalled board, and calling it unroutable — which is
    // what the first version of this message did — sends the reader to edit a routing table that is fine.
    else if (hasUnfinishedChildren(ap, card, cards)) waiting.push(card);
    else rest.push(card);
  }
  return { blocked, waiting, rest };
}

// Why the remaining work is stuck, per KIND of stuck. One list of ids with one piece of advice named
// cards the loop had itself blocked and then told the reader to check their routing table — advice that is
// wrong for them. A message about a condition the reader cannot act on is a worse failure than the condition.
function whyStuck(ap: AutopilotConfig, cards: Card[], unfinished: Card[]): string {
  const { blocked, waiting, rest } = partitionStuck(ap, cards, unfinished);
  const parts: string[] = [];
  if (rest.length > 0) {
    parts.push(
      `Nothing can move ${names(rest)} — check that every column that holds a card is routed, terminal or blocked`,
    );
  }
  // Deliberate, and stated because it is surprising: one blocked card means this project can never
  // report `complete` again, since `complete` requires that nothing non-terminal exists anywhere. That
  // is the honest reading — the work is not done — but the reader has to be told why.
  if (blocked.length > 0) {
    parts.push(
      `${names(blocked)} ran out of attempts and ${isAre(blocked)} in ${ap.blockedColumn}, so this project cannot report itself finished until ${blocked.length === 1 ? 'it is' : 'they are'} dealt with`,
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

// No feature to work on. The three endings that look alike and are not, kept apart because conflating them
// produced the worst failure on record: success reported over unfinished work.
//
// `complete` requires that no non-terminal card exists anywhere AND positive evidence that finished work
// does. Absence of unfinished work is not presence of finished work: an empty board, a board archived down
// to nothing, and a fetch that returned nothing all produce the same empty list.
function nothingToWorkOn(ap: AutopilotConfig, cards: Card[], runs: RunRecord[]): TickAction {
  const live = liveCards(cards);
  // A card that is NOT live and NOT in the archive is a half-finished archive, and it was invisible to every
  // set `complete` is decided from. `archiveCard` stamps the frontmatter and THEN moves the file, so a server
  // killed between those two writes leaves exactly this; so does a hand-edit through `PUT /raw`. The board
  // still renders the card, and auto-pilot called the project finished over work the user can see.
  const halfArchived = cards.filter((c) => !liveCards([c]).length && c.columnSlug !== ARCHIVE_SLUG);
  if (halfArchived.length > 0) {
    return stop(
      'stalled',
      `${names(halfArchived)} ${isAre(halfArchived)} marked archived but still in a live column, so auto-pilot cannot tell whether ${halfArchived.length === 1 ? 'it is' : 'they are'} work or not. Archive ${halfArchived.length === 1 ? 'it' : 'them'} properly, or clear the archived field.`,
    );
  }
  const unfinished = live.filter((c) => !isTerminalColumn(ap, c.board, c.columnSlug));
  if (unfinished.length > 0) {
    return stop('stalled', `There is nothing auto-pilot can work on. ${whyStuck(ap, cards, unfinished)}`);
  }
  if (live.length === 0) {
    if (cards.length === 0) return bootstrap(ap, runs) ?? stop('no-op', 'There is no card on any board.');
    return stop('no-op', `Every one of the ${cards.length} cards on this project is archived.`);
  }
  return stop('complete');
}

// WHICH PHASE THE POSITION IS IN, and what to do about it. Tasks 8 and 9 of the lifecycle plan fill this in
// with the feature loop, the story loop, the task loop and the review loop; until then a derived position
// falls through to the same ending as no position at all, which reports the board honestly rather than
// dispatching something the machine has not been taught yet.
//
// Its own function so those tasks add branches without touching the sequence above.
function phaseAction(_input: TickInput, _position: Position): TickAction | undefined {
  return undefined;
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
