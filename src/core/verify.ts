import { VERIFY_MODES, type VerifyMode } from './autopilot.js';
import { oneOf } from './types.js';

// Did the work pass? A pure decision over evidence — no disk, no clock, no processes — so every
// boundary is assertable and the fail-closed cases can be watched failing.
//
// EVERY MODE FAILS CLOSED. An empty gate set fails, a missing smoke command fails, and a review that
// answered nothing is not a pass. Seven of the design review's findings were that one bug, and every one
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
// somewhere else: the failing command AND its output for the two command modes; and the run that did the
// judging, so its reasoning is one lookup away rather than a correlation by timestamp.
//
// NO `score`, `threshold` or `overshoot`. They were the critic's, which is now a review answering
// done/sent-back (ruling 57) — a verdict rather than a number to compare against a bar.
export interface Verification {
  mode: VerifyMode;
  passed: boolean;
  at: string;
  command?: string; // gates/smoke: the one that failed
  output?: string;
  reason?: string; // why this could not pass, or the judge's own words
  by?: string; // the judging run's id
}

// Here rather than beside the modes themselves, because this is the only kind of caller that needs it:
// something reading a verdict back off disk, where the mode is whatever a person left in the file.
export const isVerifyMode = oneOf(VERIFY_MODES);

// The tail, because a failing suite prints its diagnosis last. Marked rather than silently cut: a
// reader must not take a fragment for the whole output and go looking for a cause that was dropped.
export const MAX_OUTPUT = 4000;

export function tail(text: string, max = MAX_OUTPUT): string {
  if (text.length <= max) return text;
  return `[earlier output omitted]\n${text.slice(-max)}`;
}

// Exported because the verifier needs the same question to decide whether to keep going, and it had its
// own copy — whose `timedOut` half nothing constrained. One statement, so the two cannot drift.
export const commandFailed = (result: CommandResult): boolean => result.code !== 0 || result.timedOut;

// The FIRST failure, not the last: the later ones usually fail because of it, and the reader is owed
// the cause rather than its consequences.
export function firstFailure(results: CommandResult[]): CommandResult | undefined {
  return results.find(commandFailed);
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
    reason: commandReason(failure),
  };
}

// Why this command counts as a failure, in a sentence a person can act on. Three endings, not two: a
// command that never STARTED reported `exited with -1`, which is not what happened and sends the reader
// looking for an exit code that does not exist. `code: -1` is this module's own marker for "could not be
// spawned", set where the spawn fails (server/commands.ts).
function commandReason(failure: CommandResult): string {
  if (failure.timedOut) return `\`${failure.command}\` was still running when it was stopped.`;
  if (failure.code === -1) return `\`${failure.command}\` could not be run at all.`;
  return `\`${failure.command}\` exited with ${failure.code ?? 'no code'}.`;
}

// A verdict for work that was never done, recorded WITHOUT running the verifier — see `producedNothing`
// in core/runs.ts for why a verifier must not be consulted at all in this case.
//
// It wears the phase's own mode rather than a fourth one: a `none` added here would read as a verifier,
// and "this card is checked by nothing" is not a check. The reason says plainly that the check did not
// run, which is the fact a reader needs.
export function unverified(mode: VerifyMode, at: string, why: string): Verification {
  return { mode, passed: false, at, reason: why };
}
