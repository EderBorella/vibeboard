import type { Spend } from './accounting.js';
import { type AutopilotConfig, isTerminalColumn, type Route } from './autopilot.js';
import type { AutopilotState } from './autopilot-state.js';
import type { CardProblem } from './board.js';
import { mayDispatch, type StopReason } from './dispatch-gate.js';
import { type EligibilitySet, type Eligible, eligibility, pickNext } from './eligibility.js';
import { liveCards } from './hierarchy.js';
import { type RollupAdvance, rollupOutcomes } from './rollup.js';
import type { RunRecord } from './runs.js';
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
  | { kind: 'wait' }; // as much is in flight as the config allows

export interface TickInput {
  ap: AutopilotConfig;
  state: AutopilotState;
  cards: Card[];
  columns: Record<BoardName, string[]>; // ordered slugs per board, for the pick's tie-breaks
  runs: RunRecord[];
  spend: Spend;
  inFlight: number; // runs queued or running right now
  problems?: CardProblem[]; // whatever `readBoard` could not parse
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
  if (!Number.isInteger(ap.autoPilotConcurrency) || ap.autoPilotConcurrency <= 0) {
    return `autoPilotConcurrency is ${JSON.stringify(ap.autoPilotConcurrency)}, which is not a whole number above zero, so nothing would limit how many runs start at once. Set it in Settings.`;
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
function outOfAttempts(ap: AutopilotConfig, el: EligibilitySet): TickAction | undefined {
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
  if (engineering) return { kind: 'block', card: engineering.card, to: ap.blockedColumn };
  return undefined;
}

// The only success, and the stop most easily mistaken for it. `complete` requires that NO non-terminal
// card exists anywhere — not merely that none is eligible.
function nothingEligible(ap: AutopilotConfig, cards: Card[]): TickAction {
  const unfinished = liveCards(cards).filter((c) => !isTerminalColumn(ap, c.board, c.columnSlug));
  if (unfinished.length === 0) return { kind: 'stop', reason: 'complete' };
  const named = unfinished.slice(0, NAMED).map((c) => c.id);
  const more = unfinished.length > NAMED ? ` and ${unfinished.length - NAMED} more` : '';
  return {
    kind: 'stop',
    reason: 'stalled',
    detail: `Nothing is eligible, but ${unfinished.length} card${unfinished.length === 1 ? '' : 's'} ${unfinished.length === 1 ? 'is' : 'are'} unfinished: ${named.join(', ')}${more}. Check that every column is routed, terminal or blocked.`,
  };
}

export function decideTick(input: TickInput): TickAction {
  const { ap, state, cards, runs, spend, inFlight, columns, problems = [] } = input;
  if (state.state !== 'running') return notRunning(state);

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

  const capped = outOfAttempts(ap, el);
  if (capped) return capped;

  if (el.eligible.length === 0) return nothingEligible(ap, cards);
  if (inFlight >= ap.autoPilotConcurrency) return { kind: 'wait' };

  const pick = pickNext(el.eligible, eligibilityInput);
  // Unreachable: the list is not empty and the pick is a total order over it. Fail closed rather than
  // assert, because an exception here would end the run instead of the tick.
  if (!pick)
    return { kind: 'stop', reason: 'stalled', detail: 'Cards are eligible but none could be picked.' };
  return { kind: 'dispatch', card: pick.card, route: pick.route };
}
