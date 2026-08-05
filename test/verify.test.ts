import { describe, expect, it } from 'vitest';
import type { CommandResult, Verification } from '../src/core/verify.js';
import {
  commandVerification,
  criticPassed,
  criticVerification,
  failedVerification,
  firstFailure,
  MAX_OUTPUT,
  tail,
} from '../src/core/verify.js';

// The verdict, as data. Every fail-closed case here is a project that would otherwise pass every card
// it has: seven of the design review's findings were that one bug, and each of them ended with
// auto-pilot reporting success over work that never happened.

const ok = (command: string): CommandResult => ({ command, code: 0, output: '', timedOut: false });
const bad = (command: string, output = 'boom'): CommandResult => ({
  command,
  code: 1,
  output,
  timedOut: false,
});

describe('which command failed', () => {
  it('is the first one, so the reader is shown the cause and not the consequences', () => {
    expect(firstFailure([ok('lint'), bad('test', 'one'), bad('types', 'two')])?.command).toBe('test');
  });

  it('is nothing when they all passed', () => {
    expect(firstFailure([ok('lint'), ok('test')])).toBeUndefined();
  });

  // A killed command has NO exit code, and `null !== 0` is true only by luck of how it is written.
  // Asserted, because a timeout read as a pass is the ambiguous-timeout failure the spec cites
  // Copilot's documented infinite loop for.
  it('counts a command that was killed, which has no exit code at all', () => {
    const killed: CommandResult = { command: 'test', code: null, output: '', timedOut: true };
    expect(firstFailure([killed])).toBe(killed);
  });
});

describe('an empty gate set', () => {
  // Principle 1. A project whose test harness was never installed must not pass every card, which is
  // exactly what "nothing failed" means when nothing ran.
  it('fails, rather than passing because nothing failed', () => {
    const v = commandVerification('gates', 'AT', []);
    expect(v.passed).toBe(false);
    expect(v.reason).toMatch(/no commands/i);
  });
});

describe('the critic', () => {
  it('passes at the threshold and above, and fails below it', () => {
    expect(criticPassed(0.6, 0.6)).toBe(true);
    expect(criticPassed(0.61, 0.6)).toBe(true);
    expect(criticPassed(0.59, 0.6)).toBe(false);
  });

  // Absence is not a low score and it is not a pass: it is a critic that did not answer.
  it('fails when no score came back', () => {
    expect(criticPassed(undefined, 0.6)).toBe(false);
  });

  // Zero is a real verdict — the critic judged the work worthless — and must not be read as absence.
  it('treats a zero score as a judgement, not as a gap', () => {
    expect(criticPassed(0, 0.6)).toBe(false);
    expect(criticVerification('AT', { score: 0, threshold: 0.6, by: 'R1' }).score).toBe(0);
  });

  it('records the score, the threshold and the run that judged it', () => {
    const v = criticVerification('AT', {
      score: 0.8,
      threshold: 0.6,
      reason: 'Meets the criterion; tests name the behaviour.',
      by: '20260805-1200-abcd',
      overshoot: 'Also added a settings screen nobody asked for.',
    });
    expect(v).toEqual({
      mode: 'critic',
      passed: true,
      at: 'AT',
      score: 0.8,
      threshold: 0.6,
      reason: 'Meets the criterion; tests name the behaviour.',
      by: '20260805-1200-abcd',
      overshoot: 'Also added a settings screen nobody asked for.',
    });
  });

  // A score with no threshold beside it means nothing to a later reader: 0.55 is a pass or a failure
  // depending on a number that has to be recorded WITH it, not looked up from config months later.
  it('records the threshold even when the score is missing', () => {
    const v = criticVerification('AT', { threshold: 0.6, by: 'R1' });
    expect(v.threshold).toBe(0.6);
    expect(v.score).toBeUndefined();
    expect(v.passed).toBe(false);
    expect(v.reason).toMatch(/did not report a score/i);
  });

  // Decision 5: over-delivery PASSES and is recorded. Failing a card for doing too much discards
  // working code and burns one of three attempts to rebuild it.
  it('passes a run that overshot, and keeps the note', () => {
    const v = criticVerification('AT', { score: 0.9, threshold: 0.6, by: 'R1', overshoot: 'gold-plated' });
    expect(v.passed).toBe(true);
    expect(v.overshoot).toBe('gold-plated');
  });
});

describe('the recorded output', () => {
  it('keeps the END of a long output, which is where a failing suite says why', () => {
    const long = `${'x'.repeat(MAX_OUTPUT)}THE ACTUAL FAILURE`;
    const kept = tail(long);
    expect(kept.endsWith('THE ACTUAL FAILURE')).toBe(true);
    expect(kept.length).toBeLessThanOrEqual(MAX_OUTPUT + 64);
    // Says what was dropped rather than silently shortening: a reader must not take a fragment for
    // the whole output and go looking for a cause that was cut off.
    expect(kept).toMatch(/earlier output omitted/i);
  });

  it('leaves a short output exactly as it was', () => {
    expect(tail('two lines\nof output')).toBe('two lines\nof output');
  });

  it('is carried on the failing verification, with the command that produced it', () => {
    const v = commandVerification('gates', 'AT', [ok('lint'), bad('npm test', 'expected 1 to be 2')]);
    expect(v).toMatchObject({ mode: 'gates', passed: false, command: 'npm test' });
    expect(v.output).toContain('expected 1 to be 2');
  });

  // Nothing to show when everything passed, and no empty strings pretending to be evidence.
  it('carries no command and no output when every gate passed', () => {
    expect(commandVerification('gates', 'AT', [ok('lint')])).toEqual({
      mode: 'gates',
      passed: true,
      at: 'AT',
    });
  });

  it('says a command was stopped rather than that it exited', () => {
    const v = commandVerification('smoke', 'AT', [
      { command: './smoke.sh', code: null, output: 'started', timedOut: true },
    ]);
    expect(v.reason).toMatch(/still running/i);
    expect(v.output).toBe('started');
  });
});

describe('a mode that could not run at all', () => {
  it('is a failure carrying the reason the reader has to act on', () => {
    const v: Verification = failedVerification(
      'smoke',
      'AT',
      'foundation/TESTING.md declares no `smoke:` command.',
    );
    expect(v).toEqual({
      mode: 'smoke',
      passed: false,
      at: 'AT',
      reason: 'foundation/TESTING.md declares no `smoke:` command.',
    });
  });
});
