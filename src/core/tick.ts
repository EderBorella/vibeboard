import { burnsAttempt, type Spend } from './accounting.js';
import {
  AUTOPILOT_CONCURRENCY,
  type AutopilotConfig,
  bootstrapSkill,
  isBlockedColumn,
  isTerminalColumn,
  type Route,
} from './autopilot.js';
import { shapeProblems } from './autopilot-cover.js';
import type { AutopilotState } from './autopilot-state.js';
import type { CardProblem } from './board.js';
import { mayDispatch, type StopReason } from './dispatch-gate.js';
import {
  type EligibilitySet,
  type Eligible,
  eligibility,
  hasUnfinishedChildren,
  pickNext,
} from './eligibility.js';
import { liveCards } from './hierarchy.js';
import { ARCHIVE_SLUG } from './layout.js';
import { type RollupAdvance, rollupOutcomes } from './rollup.js';
import type { RunRecord } from './runs.js';
import { isProjectRun } from './runs.js';
import type { BoardName, Card } from './types.js';

// One tick of the loop, as one pure function over data. No clock, no disk, no process, no model: it
// looks things up, compares them, and answers with exactly one action. That is what makes the whole
// loop testable — the service that calls this holds no decisions of its own.
//
// THE ORDER IS THE BEHAVIOUR, and the spec fixed it after a review finding:
//
//   caps        first, so an over-budget project cannot spend one more dispatch deciding it is over
//               budget;
//   rollup      next, so anything downstream judges a settled board (S12);
//   checkup     next, because it consumes an iteration itself and nothing runs alongside it;
//   eligibility last, and its two empty cases are kept apart — "nothing eligible" and "nothing left"
//               are different facts, and conflating them is what once reported success over unfinished
//               work.

export type TickAction =
  | { kind: 'stop'; reason: StopReason; detail?: string }
  | { kind: 'rollup'; advance: RollupAdvance[] }
  | { kind: 'block'; card: Card; to: string } // an engineering card out of attempts
  | { kind: 'dispatch'; card: Card; route: Route }
  // Derive the board itself, with no card to derive it FOR. The bootstrap: an empty board and a README
  // is a project that has said what it wants and has nothing to pick up yet.
  | { kind: 'bootstrap'; skill: string; detail: string }
  | { kind: 'wait' }; // as much is in flight as the config allows

export interface TickInput {
  ap: AutopilotConfig;
  state: AutopilotState;
  cards: Card[];
  columns: Record<BoardName, string[]>; // ordered slugs per board, for the pick's tie-breaks
  runs: RunRecord[];
  spend: Spend;
  // The runs queued or running right now, WITH their identities. A bare count was enough for
  // one run and wrong for more than one: `attemptsUsed` deliberately does not
  // count an unfinished run, so the card being worked stays eligible, the pick is a total order and
  // therefore deterministic, and the second tick dispatched the same card again — two agents editing one
  // card's work in one repository, which is the collision decision 4 exists to prevent.
  //
  // `card` is absent for a project run (a checkup), which counts towards the limit and belongs to no card.
  inFlight: { card?: string; skill: string }[];
  problems: CardProblem[]; // whatever `readBoard` could not parse — required, see EligibilityInput
}

// How many unfinished cards a stalled stop names before it stops listing them. Long enough to be
// actionable, short enough that the overlay stays a sentence.
const NAMED = 5;

// A state this function has no business deciding for. The service checks the state before every tick
// (which is what makes a soft stop written between ticks take effect), but the refusal belongs here
// too: Principle 1 puts it where the decision is made rather than trusting a guard upstream.
//
// The reason on the state is preserved where there is one — a halt must keep saying why it halted.
function notRunning(state: AutopilotState): TickAction {
  if (state.reason) return { kind: 'stop', reason: state.reason, detail: state.detail };
  return {
    kind: 'stop',
    reason: 'stopped',
    detail: `Auto-pilot is ${state.state}, so there is nothing to decide.`,
  };
}

// The two numbers only the tick compares. THE SPLIT RULE, because there are three homes for this kind
// of check and that needs saying: `mayDispatch` validates the two caps IT compares (maxIterations,
// budgetUsd); `eligibility` validates `attemptCap`, which only it compares; and these two are the
// tick's own. Each check sits with the comparison it protects, because a number reaching a comparison
// unvalidated is the failure — `9 >= NaN` is false, so an unusable interval does not mean "later", it
// means "never", and an unusable concurrency limit does not queue, it lets everything through.
function unusableNumber(ap: AutopilotConfig): string | undefined {
  if (!Number.isInteger(ap.checkupEvery) || ap.checkupEvery <= 0) {
    return `checkupEvery is ${JSON.stringify(ap.checkupEvery)}, which is not a whole number above zero, so no checkup would ever be due. Set it in Settings.`;
  }
  return undefined;
}

// C2 STOPS HERE. The checkup is slice C3, and a tick that owes one must not keep dispatching: decision
// 15 makes the supervisor pass mandatory on resume, and "mandatory" cannot mean "skipped because the
// code is not written". C3 replaces this branch with a dispatch, and the test that pins it changes with
// it — deliberately.
function checkupOwed(ap: AutopilotConfig, state: AutopilotState): string | undefined {
  const owed = state.needsCheckup
    ? 'This project owes a supervisor checkup before it dispatches anything else.'
    : state.dispatchesSinceCheckup >= ap.checkupEvery
      ? `There have been ${state.dispatchesSinceCheckup} dispatches since the last supervisor checkup, which is the interval of ${ap.checkupEvery}.`
      : undefined;
  return (
    owed &&
    `${owed} The checkup is not built yet, so auto-pilot has stopped rather than carry on unsupervised.`
  );
}

// A card that has used every attempt. Engineering has somewhere to put it; nothing else does, and a
// card in the setup subtree has nowhere either — blocking that one would leave the barrier unfinished
// for ever, which stalls the whole project without ever saying so.
function outOfAttempts(ap: AutopilotConfig, el: EligibilitySet, columns: string[]): TickAction | undefined {
  const detail = (e: Eligible, why: string): TickAction => ({
    kind: 'stop',
    reason: 'stalled',
    detail: `${e.card.id} has used all ${ap.attemptCap} attempts at ${e.route.skill}. ${why}`,
  });
  const elsewhere = el.blockedByAttempts.find((e) => e.card.board !== 'engineering');
  if (elsewhere) {
    return detail(
      elsewhere,
      `A ${elsewhere.card.board} card has no blocked column to go to, so this needs a person: read its runs, then move it or change what it asks for.`,
    );
  }
  const inSetup = el.blockedByAttempts.find((e) => el.setupIds.has(e.card.id));
  if (inSetup) {
    return detail(
      inSetup,
      'It is part of the setup feature, and nothing outside the setup feature can start until that is finished — so blocking it would stall the project in silence.',
    );
  }
  const engineering = el.blockedByAttempts[0];
  if (!engineering) return undefined;
  // Checked HERE because this is where it is emitted, not compared — the same split rule as the numbers.
  // `coverageProblems` refuses a bad blocked column when the config is saved, but config.yaml is a file a
  // person can edit while the loop is running, and a `block` action carrying `to: undefined` would either
  // move a card into a folder named after nothing or be refused by the endpoint — and since a block
  // consumes no iteration and no budget, neither of the loop's two backstops would ever end the retry.
  if (!columns.includes(ap.blockedColumn)) {
    return {
      kind: 'stop',
      reason: 'stalled',
      detail: `${engineering.card.id} has used all ${ap.attemptCap} attempts at ${engineering.route.skill} and should move to the blocked column, but blockedColumn is ${JSON.stringify(ap.blockedColumn)}, which is not a column on the engineering board. Set it in Settings.`,
    };
  }
  return { kind: 'block', card: engineering.card, to: ap.blockedColumn };
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
function partitionStuck(
  ap: AutopilotConfig,
  cards: Card[],
  unfinished: Card[],
  el: EligibilitySet,
): { blocked: Card[]; barred: Card[]; waiting: Card[]; rest: Card[] } {
  const blocked: Card[] = [];
  const barred: Card[] = [];
  const waiting: Card[] = [];
  const rest: Card[] = [];
  for (const card of unfinished) {
    if (isBlockedColumn(ap, card.board, card.columnSlug)) blocked.push(card);
    else if (el.barrier === 'unfinished' && !el.setupIds.has(card.id)) barred.push(card);
    // The same rule that excluded it from eligibility, read back as a reason. A parent stuck behind one
    // blocked grandchild is the ordinary shape of a stalled board, and calling it unroutable — which is
    // what the first version of this message did — sends the reader to edit a routing table that is fine.
    else if (hasUnfinishedChildren(ap, card, cards)) waiting.push(card);
    else rest.push(card);
  }
  return { blocked, barred, waiting, rest };
}

// Why the remaining work is stuck, per KIND of stuck. One list of ids with one piece of advice named
// cards barred by the setup barrier and cards the loop had itself blocked, and then told the reader to
// check their routing table — advice that is wrong for both. A message about a condition the reader
// cannot act on is a worse failure than the condition.
function whyStuck(ap: AutopilotConfig, cards: Card[], unfinished: Card[], el: EligibilitySet): string {
  const { blocked, barred, waiting, rest } = partitionStuck(ap, cards, unfinished, el);
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
  if (barred.length > 0) {
    parts.push(`${names(barred)} ${isAre(barred)} waiting for the setup feature, which is not finished yet`);
  }
  if (waiting.length > 0) {
    parts.push(
      `${names(waiting)} ${isAre(waiting)} waiting for ${waiting.length === 1 ? 'its' : 'their'} own cards further down to finish`,
    );
  }
  return `${parts.join('. ')}.`;
}

// The only success, and the two stops most easily mistaken for it.
//
// `complete` requires that no non-terminal card exists anywhere — and, since the review, POSITIVE
// EVIDENCE that finished work exists. Absence of unfinished work is not presence of finished work: an
// empty board, a board whose every card was archived, and a fetch that returned nothing all produce an
// empty list, and all three used to answer with the project's only success.
function nothingEligible(
  ap: AutopilotConfig,
  cards: Card[],
  el: EligibilitySet,
  // For the bootstrap only: which skill derives the board, and whether it has already tried.
  columns: Record<BoardName, string[]>,
  runs: RunRecord[],
): TickAction {
  const live = liveCards(cards);
  // A card that is NOT live and NOT in the archive is a half-finished archive, and it was invisible to all
  // three sets `complete` is decided from — eligible, unfinished, and problems. `archiveCard` stamps the
  // frontmatter and THEN moves the file, so a server killed between those two writes leaves exactly this; so
  // does a hand-edit through `PUT /raw`. The board still renders the card, and auto-pilot called the project
  // finished over work the user can see sitting in Backlog. The fourth route to the failure this design exists
  // to prevent, and the same shape as the other three: an absence read as evidence.
  const halfArchived = cards.filter((c) => !liveCards([c]).length && c.columnSlug !== ARCHIVE_SLUG);
  if (halfArchived.length > 0) {
    return {
      kind: 'stop',
      reason: 'stalled',
      detail: `${names(halfArchived)} ${isAre(halfArchived)} marked archived but still in a live column, so auto-pilot cannot tell whether ${halfArchived.length === 1 ? 'it is' : 'they are'} work or not. Archive ${halfArchived.length === 1 ? 'it' : 'them'} properly, or clear the archived field.`,
    };
  }
  const unfinished = live.filter((c) => !isTerminalColumn(ap, c.board, c.columnSlug));
  if (unfinished.length > 0) {
    return {
      kind: 'stop',
      reason: 'stalled',
      detail: `Nothing is eligible. ${whyStuck(ap, cards, unfinished, el)}`,
    };
  }
  if (live.length === 0) {
    // THE BOOTSTRAP. An empty board used to be the end: `no-op`, "nothing to work on, which is not the
    // same as being finished". It is instead the one state where the loop derives the board itself — see
    // `bootstrapSkill` in autopilot.ts for why a card-less dispatch is the only shape that can.
    //
    // Capped by the same attempt cap as anything else, counted over PROJECT runs of that skill, so a
    // derivation that keeps failing stops rather than looping on an empty board for ever.
    const boot = bootstrapSkill(ap, columns.features);
    if (cards.length === 0 && boot) {
      const tried = runs.filter((r) => isProjectRun(r) && r.skill === boot && burnsAttempt(r.status)).length;
      if (tried < ap.attemptCap) {
        return {
          kind: 'bootstrap',
          skill: boot,
          detail: `The board is empty, so auto-pilot is deriving it from the README with ${boot}.`,
        };
      }
      return {
        kind: 'stop',
        reason: 'stalled',
        detail: `The board is empty and ${boot} has used all ${ap.attemptCap} attempts at deriving it from the README. Read its runs: the README may be too thin to derive features from, in which case say more in it, or add the first card by hand.`,
      };
    }
    return {
      kind: 'stop',
      reason: 'no-op',
      detail:
        cards.length === 0
          ? 'There is no card on any board.'
          : `Every one of the ${cards.length} cards on this project is archived.`,
    };
  }
  return { kind: 'stop', reason: 'complete' };
}

export function decideTick(input: TickInput): TickAction {
  const { ap, state, cards, runs, spend, inFlight, columns, problems } = input;
  if (state.state !== 'running') return notRunning(state);

  // The keys the tick INDEXES rather than compares — `terminal`, `routes`, `rollup`, `blockedColumn`.
  // Same reason as the numbers below, and the failure was worse: with `terminal` absent, a board of
  // childless cards never reached `isTerminalColumn` and DISPATCHED — into a project where nothing could
  // ever finish — while the same config threw a TypeError out of `decideTick` as soon as one card had a
  // child, ending the run rather than the tick. `shapeProblems` is already pure and already exported.
  const shape = shapeProblems(ap);
  if (shape.length > 0) {
    return { kind: 'stop', reason: 'stalled', detail: shape.join(' ') };
  }

  const gate = mayDispatch({ ap, iteration: state.iteration, spend });
  if (!gate.ok) return { kind: 'stop', reason: gate.reason, detail: gate.message };
  const unusable = unusableNumber(ap);
  if (unusable) return { kind: 'stop', reason: 'stalled', detail: unusable };

  const rollup = rollupOutcomes(ap, cards);
  if (rollup.advance.length > 0) return { kind: 'rollup', advance: rollup.advance };

  const owed = checkupOwed(ap, state);
  if (owed) return { kind: 'stop', reason: 'stalled', detail: owed };

  const eligibilityInput = { ap, cards, runs, columns, rollupEligible: rollup.eligible, problems };
  const el = eligibility(eligibilityInput);
  if (el.problem) return { kind: 'stop', reason: 'stalled', detail: el.problem };

  const capped = outOfAttempts(ap, el, columns.engineering ?? []);
  if (capped) return capped;

  if (el.eligible.length === 0) return nothingEligible(ap, cards, el, columns, runs);

  // BOTH waits come after the empty check and before the pick, and that order is load-bearing. A card
  // with a run in flight is still eligible — on purpose, because `attemptsUsed` does not count an
  // unfinished run — so filtering it out of eligibility instead would make a healthy loop at
  // concurrency 1 report `stalled` over the very work it was waiting for.
  if (inFlight.length >= AUTOPILOT_CONCURRENCY) return { kind: 'wait' };
  const free = el.eligible.filter((e) => !inFlight.some((f) => f.card === e.card.id));
  if (free.length === 0) return { kind: 'wait' };

  const pick = pickNext(free, eligibilityInput);
  // Unreachable: the list is not empty and the pick is a total order over it. Fail closed rather than
  // assert, because an exception here would end the run instead of the tick.
  if (!pick)
    return { kind: 'stop', reason: 'stalled', detail: 'Cards are eligible but none could be picked.' };
  return { kind: 'dispatch', card: pick.card, route: pick.route };
}
