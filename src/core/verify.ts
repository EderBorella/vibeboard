import type { VerifyMode } from './autopilot.js';

// Did the work pass? A pure decision over evidence — no disk, no clock, no processes — so every
// boundary is assertable and the fail-closed cases can be watched failing.
//
// ALL THREE MODES FAIL CLOSED. An empty gate set fails, a critic that returned no score fails, and a
// missing smoke command fails. Seven of the design review's findings were that one bug, and every one
// of them ended with auto-pilot reporting success over work that never happened.

// One command, as it ended. `code: null` is a command that was KILLED — a timeout, or a signal — and
// it is not zero: an ambiguous timeout read as a pass is the failure the spec cites Copilot's
// documented infinite loop for.
export interface CommandResult {
  command: string;
  code: number | null;
  output: string;
  timedOut: boolean;
}

// What a verdict leaves behind (decision 18). "Verification failed" with nothing behind it is the same
// silence this design exists to remove, so the evidence is part of the verdict rather than a log line
// somewhere else: the failing command AND its output for the two command modes; the score AND the
// threshold it was judged against for the critic, because a score without one means nothing to a later
// reader; and the run that did the judging, so its reasoning is one lookup away rather than a
// correlation by timestamp.
export interface Verification {
  mode: VerifyMode;
  passed: boolean;
  at: string;
  command?: string; // gates/smoke: the one that failed
  output?: string;
  score?: number; // critic: what it answered
  threshold?: number;
  reason?: string; // why this could not pass, or the critic's own words
  by?: string; // the critic run's id
  overshoot?: string; // decision 5: over-delivery passes, and is recorded rather than punished
}

// The tail, because a failing suite prints its diagnosis last. Marked rather than silently cut: a
// reader must not take a fragment for the whole output and go looking for a cause that was dropped.
export const MAX_OUTPUT = 4000;

export function tail(text: string, max = MAX_OUTPUT): string {
  if (text.length <= max) return text;
  return `[earlier output omitted]\n${text.slice(-max)}`;
}

const failed = (result: CommandResult): boolean => result.code !== 0 || result.timedOut;

// The FIRST failure, not the last: the later ones usually fail because of it, and the reader is owed
// the cause rather than its consequences.
export function firstFailure(results: CommandResult[]): CommandResult | undefined {
  return results.find(failed);
}

// A score at or above the threshold. `undefined` is not a low score — it is a critic that did not
// answer — and it fails for the same reason an empty gate set does.
export function criticPassed(score: number | undefined, threshold: number): boolean {
  return score !== undefined && score >= threshold;
}

export function failedVerification(mode: VerifyMode, at: string, reason: string): Verification {
  return { mode, passed: false, at, reason };
}

export function commandVerification(mode: VerifyMode, at: string, results: CommandResult[]): Verification {
  if (results.length === 0) {
    return failedVerification(mode, at, 'There were no commands to run, and nothing can pass an empty set.');
  }
  const failure = firstFailure(results);
  if (!failure) return { mode, passed: true, at };
  return {
    mode,
    passed: false,
    at,
    command: failure.command,
    output: tail(failure.output),
    // "Stopped" and "exited" are different endings, and a run that hung is the case the timeout exists
    // for — saying it exited would hide the one thing worth knowing about it.
    reason: failure.timedOut
      ? `\`${failure.command}\` was still running when it was stopped.`
      : `\`${failure.command}\` exited with ${failure.code ?? 'no code'}.`,
  };
}

export function criticVerification(
  at: string,
  input: { score?: number; threshold: number; reason?: string; by: string; overshoot?: string },
): Verification {
  return {
    mode: 'critic',
    passed: criticPassed(input.score, input.threshold),
    at,
    // Written whenever it exists, ZERO INCLUDED: zero is a critic that judged the work worthless, and
    // omitting it would make that indistinguishable from a critic that never answered.
    ...(input.score === undefined ? {} : { score: input.score }),
    // Always, even with no score: 0.55 is a pass or a failure depending on a number that has to be
    // recorded beside it rather than looked up from config months later.
    threshold: input.threshold,
    ...(input.reason
      ? { reason: input.reason }
      : input.score === undefined
        ? { reason: 'The critic did not report a score, so it cannot have judged the work.' }
        : {}),
    by: input.by,
    ...(input.overshoot ? { overshoot: input.overshoot } : {}),
  };
}
