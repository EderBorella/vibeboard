import type { Spend } from './accounting.js';
import type { AutopilotConfig } from './autopilot.js';

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
  'interrupted', // the server died under it; a checkup is owed before it resumes
  // Not a stop the loop chose: the state file itself could not be read, so the project is halted
  // until a person says otherwise (S13). Named here so a halt always has a reason with a sentence
  // behind it, rather than an overlay that can only say something went wrong.
  'unreadable',
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

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
  interrupted: 'Auto-pilot was interrupted by a restart, so it owes this project a checkup.',
  unreadable:
    'This project is halted because VibeBoard could not read its auto-pilot state. Restart it to start again from idle.',
};

// The sentence a person reads, with the specifics appended. A reason on its own is a code; a code is
// something the reader has to look up, and a stalled board that cannot name its card is a dead end.
export function stopSentence(reason: StopReason, detail?: string): string {
  return detail ? `${SENTENCES[reason]} ${detail}` : SENTENCES[reason];
}

export interface GateInput {
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
