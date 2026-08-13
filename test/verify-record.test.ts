import { describe, expect, it } from 'vitest';
import { parseRun, type RunRecord, serializeRun, withVerification } from '../src/core/runs.js';
import type { Verification } from '../src/core/verify.js';

// What a run carries about the verdict passed on it (decision 18), and what it carries about a verdict it
// PASSED on something else. Two different fields on purpose: `verification` is what was decided about this
// run, `verdict` is what this run answered when it was the review.

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

  it('keeps a passing review verdict, naming the run that judged it', () => {
    const passed: Verification = { mode: 'review', passed: true, at: 'AT', by: 'R' };
    expect(parseRun(serializeRun(withVerification(base, passed)))?.verification).toEqual(passed);
  });

  it('keeps a failing review verdict with the reviewer’s own findings on it', () => {
    const sentBack: Verification = {
      mode: 'review',
      passed: false,
      at: 'AT',
      by: 'R',
      reason: 'The card asks for a refusal on an unreadable file and there is none.',
    };
    expect(parseRun(serializeRun(withVerification(base, sentBack)))?.verification).toEqual(sentBack);
  });

  it('still drops a malformed detail field on its own, keeping the verdict', () => {
    const v = parseRun(
      withFrontmatter('verification:\n  mode: gates\n  passed: false\n  at: AT\n  command: 42'),
    )?.verification;
    expect(v).toMatchObject({ mode: 'gates', passed: false, at: 'AT' });
    expect(v?.command).toBeUndefined();
  });
});

describe('the captured output', () => {
  // Bytes, not a sentence: `asText` trimmed it, so what a gate printed did not survive the round trip.
  it('round-trips exactly, whitespace and all', () => {
    const v: Verification = {
      mode: 'gates',
      passed: false,
      at: 'AT',
      command: 'npm test',
      output: '\n  FAIL  two spaces and a trailing newline\n',
    };
    expect(parseRun(serializeRun(withVerification(base, v)))?.verification?.output).toBe(v.output);
  });

  // A failure that printed NOTHING is a real and informative outcome — a silent non-zero exit — and it
  // used to vanish, leaving a reader unable to tell it from a verdict where nobody captured anything.
  it('survives being empty', () => {
    const v: Verification = { mode: 'gates', passed: false, at: 'AT', command: 'exit 1', output: '' };
    expect(parseRun(serializeRun(withVerification(base, v)))?.verification?.output).toBe('');
  });
});

// WHAT A RUN CARRYING RETIRED FIELDS DOES NOW. `score` and `overshoot` came off RunRecord and off
// AgentReport with the critic, so a record still holding them on disk must round-trip WITHOUT them rather
// than carrying an orphan field the exhaustiveness check at core/runs.ts never sees.
describe('a record written before the critic retired', () => {
  it('round-trips without the score and the overshoot it used to carry', () => {
    const old = { ...base, skill: 'critic', score: 0.9, overshoot: 'built a settings screen' } as RunRecord;
    const back = parseRun(serializeRun(old));
    expect(back).toBeDefined();
    // Everything else survives — this is a drop, not a refusal: a run record is the project's history.
    expect(back?.run).toBe(base.run);
    expect(back?.status).toBe('success');
    expect(back && 'score' in back).toBe(false);
    expect(back && 'overshoot' in back).toBe(false);
  });

  it('drops a verdict claiming the retired mode, rather than reading it as one', () => {
    const stale = { mode: 'critic', passed: true, at: 'AT', by: 'R' } as unknown as Verification;
    expect(parseRun(serializeRun(withVerification(base, stale)))?.verification).toBeUndefined();
  });
});
