import { describe, expect, it } from 'vitest';
import { parseRun, type RunRecord, serializeRun, withVerification } from '../src/core/runs.js';
import type { Verification } from '../src/core/verify.js';

// What a run carries about the verdict passed on it (decision 18), and what it carries about a verdict
// it PASSED on something else. Two different fields on purpose: `verification` is what was decided
// about this run, `score` is what this run answered when it was the critic.

const base: RunRecord = {
  run: '20260805-1200-abcd',
  card: 'E-001',
  board: 'engineering',
  skill: 'implement',
  status: 'success',
  started: '2026-08-05T12:00:00.000Z',
  backend: 'claude',
  model: 'm',
  effort: 'e',
  mode: 'bypassPermissions',
  report: 'did the thing',
};

const gatesFailed: Verification = {
  mode: 'gates',
  passed: false,
  at: '2026-08-05T12:05:00.000Z',
  command: 'npm test',
  output: 'expected 1 to be 2',
  reason: '`npm test` exited with 1.',
};

// Injected straight after the opening fence, so a shape the types forbid can still be tested: a run
// file is something a person may edit, and that is the only way this field ever arrives malformed.
const withFrontmatter = (extra: string): string => serializeRun(base).replace('---\n', `---\n${extra}\n`);

describe('verification on a run record', () => {
  it('round-trips through the file', () => {
    const written = serializeRun(withVerification(base, gatesFailed));
    expect(parseRun(written)?.verification).toEqual(gatesFailed);
  });

  it('is absent until something has judged the run, which is not the same as failing', () => {
    expect(parseRun(serializeRun(base))?.verification).toBeUndefined();
  });

  // A hand-edited file can put anything here, and one bad field must not cost the whole record — the
  // rule `usage` already follows.
  it('drops a verification that is not one, keeping the rest of the record', () => {
    const record = parseRun(withFrontmatter('verification: not-an-object'));
    expect(record?.run).toBe('20260805-1200-abcd');
    expect(record?.verification).toBeUndefined();
  });

  it('drops a verification that is a list', () => {
    expect(parseRun(withFrontmatter('verification: [1, 2]'))?.verification).toBeUndefined();
  });

  it('drops a verification whose mode is not a mode', () => {
    const broken = { ...gatesFailed, mode: 'vibes' } as unknown as Verification;
    expect(parseRun(serializeRun(withVerification(base, broken)))?.verification).toBeUndefined();
  });

  // `passed` is the field a caller acts on. Defaulting it either way invents a decision nobody made,
  // and the direction that invents a PASS is how work advances on nothing at all.
  it('drops a verification with no verdict in it', () => {
    const broken = { mode: 'gates', at: 'AT' } as unknown as Verification;
    expect(parseRun(serializeRun(withVerification(base, broken)))?.verification).toBeUndefined();
  });

  it('drops one whose verdict is a string that looks like a verdict', () => {
    expect(
      parseRun(withFrontmatter('verification:\n  mode: gates\n  passed: "false"\n  at: AT'))?.verification,
    ).toBeUndefined();
  });

  it('drops one with no timestamp, since a verdict nobody can place is not evidence', () => {
    const broken = { mode: 'gates', passed: true } as unknown as Verification;
    expect(parseRun(serializeRun(withVerification(base, broken)))?.verification).toBeUndefined();
  });

  it('keeps a passing verification with nothing else on it', () => {
    const passed: Verification = {
      mode: 'critic',
      passed: true,
      at: 'AT',
      score: 0.7,
      threshold: 0.6,
      by: 'R',
    };
    expect(parseRun(serializeRun(withVerification(base, passed)))?.verification).toEqual(passed);
  });

  it('keeps a critic score of zero on the verdict it produced', () => {
    const judged: Verification = {
      mode: 'critic',
      passed: false,
      at: 'AT',
      score: 0,
      threshold: 0.6,
      by: 'R',
    };
    expect(parseRun(serializeRun(withVerification(base, judged)))?.verification?.score).toBe(0);
  });

  // The whole verdict, not just the number. For a critic the score and the threshold ARE the verdict —
  // a 4 clears every bar there is — so a verdict carrying one is damaged rather than merely incomplete.
  // A malformed `command` or `output` is different: those are evidence a verdict can lack and still mean
  // something, and they are dropped field by field.
  it('drops the whole verdict when its score is not a fraction', () => {
    const judged = {
      mode: 'critic',
      passed: true,
      at: 'AT',
      score: 4,
      threshold: 0.6,
      by: 'R',
    } as Verification;
    expect(parseRun(serializeRun(withVerification(base, judged)))?.verification).toBeUndefined();
  });

  it('still drops a malformed detail field on its own, keeping the verdict', () => {
    const v = parseRun(
      withFrontmatter('verification:\n  mode: gates\n  passed: false\n  at: AT\n  command: 42'),
    )?.verification;
    expect(v).toMatchObject({ mode: 'gates', passed: false, at: 'AT' });
    expect(v?.command).toBeUndefined();
  });
});

describe('a verdict that contradicts its own evidence', () => {
  // Every field was validated on its own and nothing checked them against each other, so a hand-edited
  // file could carry a PASS whose score is below its own threshold — and `passed` is the field the loop
  // will act on. Dropped whole rather than recomputed: recomputing would quietly overwrite what the file
  // says, and this is the one field where inventing a decision is the failure being guarded against.
  it('is dropped, rather than believed', () => {
    const lying = { mode: 'critic', passed: true, at: 'AT', score: 0.1, threshold: 0.9 } as Verification;
    expect(parseRun(serializeRun(withVerification(base, lying)))?.verification).toBeUndefined();
  });

  it('is dropped the other way round too — a failure that cleared its own bar', () => {
    const lying = { mode: 'critic', passed: false, at: 'AT', score: 0.95, threshold: 0.6 } as Verification;
    expect(parseRun(serializeRun(withVerification(base, lying)))?.verification).toBeUndefined();
  });

  it('keeps one whose score and threshold agree with its verdict', () => {
    for (const v of [
      { mode: 'critic', passed: true, at: 'AT', score: 0.6, threshold: 0.6 },
      { mode: 'critic', passed: false, at: 'AT', score: 0.59, threshold: 0.6 },
    ] as Verification[]) {
      expect(parseRun(serializeRun(withVerification(base, v)))?.verification).toEqual(v);
    }
  });

  // Only checkable when BOTH numbers are there. A verdict with one of them is the ordinary case for the
  // two command modes, and for a critic that never answered.
  it('is left alone when there is nothing to check it against', () => {
    const v: Verification = { mode: 'critic', passed: false, at: 'AT', threshold: 0.6, reason: 'no score' };
    expect(parseRun(serializeRun(withVerification(base, v)))?.verification).toEqual(v);
  });

  // A threshold outside the window config enforces is not a bar at all, and it is what the consistency
  // check above compares against — so it is range-checked like the score.
  it('drops a threshold config could never have produced', () => {
    const v = { mode: 'critic', passed: true, at: 'AT', score: 0.5, threshold: 99 } as Verification;
    expect(parseRun(serializeRun(withVerification(base, v)))?.verification).toBeUndefined();
  });
});

describe('what a critic run itself reported', () => {
  // The critic's OWN record: what it answered, not what was decided about it.
  it('keeps a score of zero, and drops one that is not a fraction', () => {
    const critic: RunRecord = { ...base, skill: 'critic', score: 0 };
    expect(parseRun(serializeRun(critic))?.score).toBe(0);
    expect(parseRun(serializeRun({ ...critic, score: 4 }))?.score).toBeUndefined();
    expect(parseRun(serializeRun({ ...critic, score: -1 }))?.score).toBeUndefined();
  });

  it('keeps the overshoot it noticed', () => {
    const critic: RunRecord = { ...base, skill: 'critic', score: 0.9, overshoot: 'built a settings screen' };
    expect(parseRun(serializeRun(critic))?.overshoot).toBe('built a settings screen');
  });

  it('has neither on an ordinary run', () => {
    const back = parseRun(serializeRun(base));
    expect(back?.score).toBeUndefined();
    expect(back?.overshoot).toBeUndefined();
  });
});
