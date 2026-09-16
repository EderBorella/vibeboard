import type { Spend } from './accounting.js';
import type { AutopilotConfig } from './autopilot.js';
import { oneOf } from './types.js';

// May the loop dispatch? Asked BETWEEN dispatches, in backend code, over numbers summed from disk.
//
// This is the function two well-known projects did not have. AutoGPT accumulated real cost, stored a
// real budget, and injected the balance into the prompt as "BUDGET EXCEEDED! SHUT DOWN!" — an
// instruction, not a control. AgentGPT shipped a UI dial its backend schema never received. Nothing
// here is delegated to a model, and nothing here reads a clock or a file: it is a comparison over
// values, so every boundary is assertable.

// Every stop resolves to a NAMED reason. OpenHands returns "complete" or "capped"; the loop study
// names success, no-op, blocked, stalled, exhausted, and states the rule bluntly: "an error or an
// exhausted budget never counts as success".
//
// `blocked` is deliberately absent: it is a per-CARD outcome (the card moves to the blocked column
// and the loop continues), not a reason the run stopped.
export const STOP_REASONS = [
  'stopped', // the user asked for a soft stop
  'killed', // emergency stop; the project is halted
  'exhausted', // spend reached budgetUsd
  'capped', // iteration reached maxIterations
  'stalled', // work remains and nothing can move it
  'complete', // nothing eligible and nothing unfinished anywhere — the only success
  // There was nothing to do in the first place: no live card on any board. Named separately from
  // `complete` because the absence of unfinished work is not the presence of finished work — a board
  // that is empty, or whose every card was archived, or that a fetch returned nothing for, would
  // otherwise report the project's only success. The loop study the design cites names this apart from
  // success for the same reason.
  'no-op',
  'interrupted', // the server died under it; a checkup is owed before it resumes
  // THE MACHINE FAILED, NOT THE WORK, and no card is to blame. Its own reason rather than a `stalled`
  // with a different sentence, because `stalled` means "work remains and nothing it can do would move
  // it" — a statement about the BOARD, which is precisely the accusation this exists to stop making.
  // Measured 2026-08-15: every run died in 58ms against a replaced credential, and the loop reported
  // that one card had used all its attempts and somebody should change what it asks for.
  'infrastructure',
  // Not a stop the loop chose: the state file itself could not be read, so the project is halted
  // until a person says otherwise (S13). Named here so a halt always has a reason with a sentence
  // behind it, rather than an overlay that can only say something went wrong.
  'unreadable',
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

// Beside the list, because the one caller that needs it is agent-reachable: a loop reports its own stop
// over HTTP, and an unrecognised reason would render in the overlay as a raw word with no sentence
// behind it.
export const isStopReason = oneOf(STOP_REASONS);

// The refusal a halted project gives, wherever it is given.
//
// TWO GUARDS PRODUCE IT AND BOTH STAY: the route refuses before the record exists, and the runner
// refuses again on the far side of every await, because a kill landing in that gap left a run to start
// milliseconds after the project was recorded halted. That is deliberate defence in depth. What is
// shared is the SENTENCE — two literals drifting apart would mean the same refusal read differently
// depending on which layer caught it, and the one the user sees is decided by a race.
export const HALTED_DISPATCH =
  'This project is halted, so nothing can be dispatched. Restart it from the auto-pilot panel first.';

// One reason, and it is not the two that look like it. An exhausted budget and a reached cap both
// end tidily and neither means the work is done — rendering either as success is the failure this
// whole design exists to remove.
export function isSuccessReason(reason: StopReason): boolean {
  return reason === 'complete';
}

const SENTENCES: Record<StopReason, string> = {
  stopped: 'Auto-pilot stopped because you asked it to. Nothing else was touched.',
  killed: 'Everything in this project was killed by an emergency stop.',
  exhausted: 'Auto-pilot stopped because this project reached its budget. The work is not finished.',
  capped: 'Auto-pilot stopped at its iteration cap. The work is not finished.',
  stalled: 'Auto-pilot stopped because work remains and nothing it can do would move it.',
  complete: 'Auto-pilot finished: nothing is eligible and nothing is unfinished.',
  'no-op': 'Auto-pilot had nothing to work on, which is not the same as being finished.',
  // NOT "by a restart". This reason covers three endings — a server that died under a running loop, a loop
  // killed from outside, and a loop that crashed — and the detail beside it says which. Naming one of them in
  // the canned sentence told a user whose loop had been SIGKILLed that they had restarted something.
  //
  // AND NOT "it owes this project a checkup", which is what it used to say. `needsCheckup` retired with the
  // periodic checkup (decision 47) and so did the refusal that made the promise true — `stateConflict` no
  // longer returns a 409 for an owed one, so pressing Start resumes at whatever phase the board derives.
  // Nothing owes, tracks or enforces a checkup, and a sentence promising one is a dead end.
  interrupted:
    'Auto-pilot stopped before it could finish. Its position is re-derived from the board when it resumes.',
  // NO CARD IS NAMED HERE OR IN THE DETAIL BESIDE IT, and that is the whole point of the reason: the
  // failure this covers is one in which nothing on the board was ever read, so any card the sentence
  // named would be a card the machine had never opened.
  infrastructure:
    'Auto-pilot stopped because the machine failed, not the work. No card is to blame for this.',
  unreadable:
    'This project is halted because VibeBoard could not read its auto-pilot state. Restart it to start again from idle.',
};

// A DETAIL ON A `complete` REPLACES THE CANNED SENTENCE RATHER THAN FOLLOWING IT, and every other reason
// keeps the old behaviour. The reason is that `complete`'s sentence makes a claim about the WHOLE BOARD —
// "nothing is unfinished" — which both details that exist contradict or repeat:
//
//   focused:  "…nothing is unfinished. Auto-pilot finished F-001. …the rest of the board was left alone:
//              F-002 is untouched." — the first clause is simply false, beside a sentence saying so.
//   blocked:  "…nothing is unfinished. Auto-pilot finished. 2 cards are blocked and need you: …" — the
//              words "Auto-pilot finished" twice in one line.
//
// Both details already open with the ending in their own words, so they stand alone. Read live on a focused
// run: the loop reported success and contradicted itself in the same breath.
const REPLACES_ITS_SENTENCE: readonly StopReason[] = ['complete'];

// The sentence a person reads, with the specifics appended. A reason on its own is a code; a code is
// something the reader has to look up, and a stalled board that cannot name its card is a dead end.
export function stopSentence(reason: StopReason, detail?: string): string {
  if (!detail) return SENTENCES[reason];
  return REPLACES_ITS_SENTENCE.includes(reason) ? detail : `${SENTENCES[reason]} ${detail}`;
}

// Which cap is unusable, as a sentence, or `undefined` when both are fine. A missing field reaches
// here as `undefined` despite the type: `AutopilotConfig` describes a parsed YAML file, and YAML is
// not typed.
function invalidCap(ap: AutopilotConfig): string | undefined {
  if (!Number.isInteger(ap.maxIterations) || ap.maxIterations <= 0) {
    return `maxIterations is ${JSON.stringify(ap.maxIterations)}, which is not a whole number above zero, so no iteration cap can bind. Set it in Settings.`;
  }
  if (!Number.isFinite(ap.budgetUsd) || ap.budgetUsd < 0) {
    return `budgetUsd is ${JSON.stringify(ap.budgetUsd)}, which is not a number of dollars, so no budget can bind. Set it in Settings.`;
  }
  return undefined;
}

interface GateInput {
  ap: AutopilotConfig;
  iteration: number; // dispatches so far this run
  spend: Spend; // summed from every run record in the project, card and project runs alike
}

export type Gate = { ok: true } | { ok: false; reason: StopReason; message: string };

// Budget first. When both caps are reached at once the bill is the fact that matters, and `capped`
// would say the run finished its allotted work when in truth it ran out of money.
//
// `budgetUsd > 0` guards the "no dollar budget" case: zero means the project is not bounded by money
// (a subscription or a local model), never "stop before the first dispatch" — which is what a bare
// `spend >= budget` comparison would have made it. `costUsd !== undefined` guards the other half of
// the same idea: a backend that reported nothing has not spent everything.
export function mayDispatch({ ap, iteration, spend }: GateInput): Gate {
  // Before either comparison, because a comparison against a non-number SILENTLY PASSES: `iteration >=
  // NaN` is false, so a hand-written `maxIterations: .nan` removed the only cap a project with no
  // dollar budget has — the S10 case — and the loop became unbounded. `checkNumbers` catches this on
  // the way in, but that is a different module which this gate does not call, and Principle 1 puts the
  // refusal where the decision is made rather than trusting a guard somewhere upstream.
  //
  // `stalled` because its sentence is already "work remains and nothing it can do would move it",
  // which is exactly true of a project whose own caps are unusable; the detail names the real cause,
  // since a reason alone would send the reader looking at their board instead of their config.
  const invalid = invalidCap(ap);
  if (invalid) return { ok: false, reason: 'stalled', message: invalid };
  if (ap.budgetUsd > 0 && spend.costUsd !== undefined && spend.costUsd >= ap.budgetUsd) {
    return {
      ok: false,
      reason: 'exhausted',
      message: `This project's runs have cost $${spend.costUsd} against a budget of $${ap.budgetUsd}. Raise the budget in Settings to continue.`,
    };
  }
  if (iteration >= ap.maxIterations) {
    return {
      ok: false,
      reason: 'capped',
      message: `Auto-pilot has dispatched ${iteration} times, which is its cap of ${ap.maxIterations}. Raise it in Settings to continue.`,
    };
  }
  return { ok: true };
}
