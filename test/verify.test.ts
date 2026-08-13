import { describe, expect, it } from 'vitest';
import type { CommandResult, Verification } from '../src/core/verify.js';
import {
  commandVerification,
  failedVerification,
  firstFailure,
  isVerifyMode,
  MAX_OUTPUT,
  tail,
  unverified,
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

describe('the sentence a failure carries', () => {
  // Three endings, not two. `exited with -1` describes a command that never started as though it had run
  // and returned a code, which sends the reader looking for something that does not exist.
  it('says a command could not be run, rather than inventing an exit code for it', () => {
    const v = commandVerification('gates', 'AT', [
      { command: 'npm test', code: -1, output: 'spawn ENOENT', timedOut: false },
    ]);
    expect(v.reason).toMatch(/could not be run at all/);
    expect(v.reason).not.toMatch(/-1/);
  });
});

// THE CRITIC IS GONE (decision 40), and this is what holds its absence rather than a comment claiming it.
// A TypeScript-only field removal is invisible at runtime once every producer of it is gone, so the mode
// list is the thing with teeth: a verdict read back off disk carrying `mode: 'critic'` is a verdict
// nothing in this machine could have written, and reading it as one would revive the retired path through
// the parser.
describe('the retired critic mode', () => {
  it('is not a verify mode, so a verdict claiming it cannot be read back', () => {
    expect(isVerifyMode('critic')).toBe(false);
    // The three that ARE, so a list that had emptied itself would not pass this.
    expect(isVerifyMode('gates')).toBe(true);
    expect(isVerifyMode('smoke')).toBe(true);
    expect(isVerifyMode('review')).toBe(true);
  });

  it('leaves `review` as the mode a judged verdict wears', () => {
    const v = unverified('review', 'AT', 'The run produced nothing, so there was nothing to review.');
    expect(v).toEqual({
      mode: 'review',
      passed: false,
      at: 'AT',
      reason: 'The run produced nothing, so there was nothing to review.',
    });
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
