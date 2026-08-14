import { describe, expect, it } from 'vitest';
import { DOCS_DIR } from '../src/core/layout.js';
import { asVerification, parseAgentReport, parseRun } from '../src/core/runs/parse.js';
import { serializeRun } from '../src/core/runs/serialize.js';
import type { RunRecord } from '../src/core/runs/types.js';

const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  run: '20260726-143012-a1b2',
  card: 'E-010',
  board: 'engineering',
  skill: 'execute',
  status: 'running',
  started: '2026-07-26T14:30:12.000Z',
  backend: 'claude-code',
  model: 'opus',
  effort: 'high',
  mode: 'bypassPermissions',
  report: '',
  ...over,
});

// `serializeRun` appears throughout: a round trip is the only assertion that pins what parseRun
// reads to what the writer actually produces, and a hand-written YAML fixture drifts from both.
describe('serializeRun / parseRun', () => {
  it('round-trips a full record', () => {
    const full = record({
      status: 'attention',
      outcome: 'attention',
      finished: '2026-07-26T14:41:55.000Z',
      previous: '20260726-141000-9f3e',
      prompt: 'focus on the token store',
      attached: [`${DOCS_DIR}/api.md`],
      summary: 'bigger than one card',
      options: ['split it', 'do the store only'],
      created: ['E-041', 'E-042'],
      usage: { costUsd: 0.0421, durationMs: 62431, turns: 7, contextTokens: 48210, outputTokens: 1832 },
      report: '## What I found\n\nThree cards, not one.',
    });
    expect(parseRun(serializeRun(full))).toEqual(full);
  });

  it('round-trips a minimal record without inventing fields', () => {
    const min = record();
    const parsed = parseRun(serializeRun(min));
    expect(parsed).toEqual(min);
    expect(Object.keys(parsed ?? {})).not.toContain('summary');
  });

  it('keeps the report body verbatim, blank line and all', () => {
    const body = 'line one\n\n    indented\n- bullet';
    const parsed = parseRun(serializeRun(record({ report: body })));
    expect(parsed?.report).toBe(body);
  });

  it.each([
    ['no frontmatter at all', '# just a note\n'],
    ['missing run id', '---\ncard: E-1\nskill: x\nboard: engineering\nstatus: running\n---\n'],
    ['missing card', '---\nrun: r\nskill: x\nboard: engineering\nstatus: running\n---\n'],
    ['missing skill', '---\nrun: r\ncard: E-1\nboard: engineering\nstatus: running\n---\n'],
    ['missing board', '---\nrun: r\ncard: E-1\nskill: x\nstatus: running\n---\n'],
    ['unknown status', '---\nrun: r\ncard: E-1\nskill: x\nboard: engineering\nstatus: dunno\n---\n'],
    ['no status', '---\nrun: r\ncard: E-1\nskill: x\nboard: engineering\n---\n'],
  ])('refuses %s rather than inventing a run', (_case, content) => {
    // A results folder is ordinary disk. A stray file there must not become a phantom run.
    expect(parseRun(content)).toBeNull();
  });

  it('refuses malformed YAML instead of throwing', () => {
    expect(parseRun('---\nrun: [unclosed\n---\nbody\n')).toBeNull();
  });

  it('drops blank entries from a list rather than carrying empty strings', () => {
    const parsed = parseRun(
      '---\nrun: r\ncard: E-1\nskill: x\nboard: engineering\nstatus: success\nattached: ["a.md", "  ", ""]\n---\nb\n',
    );
    expect(parsed?.attached).toEqual(['a.md']);
  });

  it('treats an all-blank list as absent', () => {
    const parsed = parseRun(
      '---\nrun: r\ncard: E-1\nskill: x\nboard: engineering\nstatus: success\noptions: ["", " "]\n---\nb\n',
    );
    expect(parsed?.options).toBeUndefined();
  });
});

describe('parseRun usage', () => {
  const withUsageYaml = (yaml: string): RunRecord | null =>
    parseRun(`---\nrun: r\ncard: E-1\nskill: x\nboard: engineering\nstatus: success\n${yaml}---\nb\n`);

  it('keeps a zero cost, because a free model really did cost nothing', () => {
    // The trap this exists for: `if (usage.costUsd)` anywhere on the read or render path turns a
    // genuine zero into "unknown", and free models are the common case on OpenCode.
    const parsed = withUsageYaml('usage:\n  costUsd: 0\n  turns: 3\n');
    expect(parsed?.usage).toEqual({ costUsd: 0, turns: 3 });
  });

  it.each([
    ['a string', 'usage:\n  costUsd: "0.04"\n'],
    ['a negative', 'usage:\n  costUsd: -1\n'],
    ['not a number at all', 'usage:\n  costUsd: yesterday\n'],
    ['null', 'usage:\n  costUsd: null\n'],
    ['a nested object', 'usage:\n  costUsd:\n    amount: 4\n'],
  ])('drops %s rather than rendering it', (_case, yaml) => {
    expect(withUsageYaml(yaml)?.usage).toBeUndefined();
  });

  it('keeps the good fields when only some are junk', () => {
    expect(withUsageYaml('usage:\n  costUsd: bogus\n  durationMs: 1500\n')?.usage).toEqual({
      durationMs: 1500,
    });
  });

  it('ignores keys it does not know', () => {
    // Frontmatter is hand-editable, and a stray key must not reach the UI as a mystery row.
    expect(withUsageYaml('usage:\n  turns: 2\n  bananas: 9\n')?.usage).toEqual({ turns: 2 });
  });

  it.each([
    ['usage is a scalar', 'usage: 4\n'],
    ['usage is a string', 'usage: expensive\n'],
    ['usage is absent', ''],
    ['usage is an empty map', 'usage: {}\n'],
  ])('treats %s as no usage at all', (_case, yaml) => {
    expect(withUsageYaml(yaml)?.usage).toBeUndefined();
  });
});

describe('parseAgentReport', () => {
  it('reads the agent contract', () => {
    const text = [
      '---',
      'outcome: attention',
      'summary: Auth refactor is 3 cards, not 1',
      'options:',
      '  - Split into E-041/E-042 and close this',
      '  - Do just the token store now',
      'created: [E-041]',
      '---',
      '## What I found',
    ].join('\n');
    expect(parseAgentReport(text)).toEqual({
      outcome: 'attention',
      summary: 'Auth refactor is 3 cards, not 1',
      options: ['Split into E-041/E-042 and close this', 'Do just the token store now'],
      created: ['E-041'],
      body: '## What I found',
    });
  });

  it('defaults to attention when the agent claims no outcome', () => {
    // Silence is not success: an agent that did not say it succeeded gets looked at.
    expect(parseAgentReport('---\nsummary: did stuff\n---\nbody\n').outcome).toBe('attention');
  });

  it('defaults to attention for an outcome it does not recognise', () => {
    expect(parseAgentReport('---\noutcome: probably-fine\n---\nbody\n').outcome).toBe('attention');
  });

  it('keeps the body of a report with no frontmatter, still as attention', () => {
    expect(parseAgentReport('I did the thing.\n')).toEqual({
      outcome: 'attention',
      body: 'I did the thing.',
    });
  });

  it('keeps the whole text when the frontmatter is malformed', () => {
    const bad = '---\noutcome: [unclosed\n---\nstill worth reading\n';
    const report = parseAgentReport(bad);
    expect(report.outcome).toBe('attention');
    expect(report.body).toBe(bad.trim());
  });

  it('accepts success only when the agent says so exactly', () => {
    expect(parseAgentReport('---\noutcome: success\n---\ndone\n').outcome).toBe('success');
    expect(parseAgentReport('---\noutcome: Success\n---\ndone\n').outcome).toBe('attention');
  });
});

// The RECORD half of the review verdict. Moved here from Task 11 by the ruling of 2026-08-13, because
// core/bounds.ts counts inconclusive reviews and could not compile without it: a data field lands before
// its readers. The FOLD half — what `withReport` does with an agent's verdict — is in
// test/runs-transitions.test.ts.
describe('a review run verdict', () => {
  it('parses a verdict of done and of sent-back', () => {
    for (const verdict of ['done', 'sent-back'] as const) {
      expect(parseRun(serializeRun(record({ skill: 'review', verdict })))?.verdict, verdict).toBe(verdict);
    }
  });

  it('drops a verdict that is neither', () => {
    // `verdict: maybe` is not an answer, and guessing at `done` would advance a card on a word nobody
    // defined. Absent is what an inconclusive review looks like, which is exactly the fact the bound counts.
    const raw = serializeRun(record({ skill: 'review' })).replace(
      'skill: review',
      'skill: review\nverdict: maybe',
    );
    expect(parseRun(raw)?.verdict).toBeUndefined();
  });

  it('round-trips verdict through serializeRun and parseRun', () => {
    const judged = record({ skill: 'review', status: 'success', outcome: 'success', verdict: 'sent-back' });
    expect(parseRun(serializeRun(judged))?.verdict).toBe('sent-back');
  });

  it('is absent from the file when the review reported none', () => {
    expect(parseRun(serializeRun(record({ skill: 'review' })))).not.toHaveProperty('verdict');
  });

  // The verdict's OTHER home (ruling 57): the judged run carries a `Verification` with `mode: 'review'`, and
  // `asVerification` drops any mode it does not recognise — so a verdict the loop writes for the review phase
  // would be silently unreadable until `review` is one of the modes.
  it('accepts a verification whose mode is review', () => {
    const verification = asVerification({ mode: 'review', passed: true, at: 'T', by: 'REV-1' });
    expect(verification).toMatchObject({ mode: 'review', passed: true, by: 'REV-1' });
  });
});

describe('the suggestion count on a run record', () => {
  it('survives a round trip through the file', () => {
    const withCount = { ...record(), suggestions: 3 };
    expect(parseRun(serializeRun(withCount))?.suggestions).toBe(3);
  });

  it('is absent, not zero, when the run filed none', () => {
    expect(parseRun(serializeRun(record()))).not.toHaveProperty('suggestions');
  });

  it('drops a value that is not a count', () => {
    // A hand-edited or half-written file can put anything here, and a NaN reaching the checkup's
    // arithmetic is worse than no number at all.
    for (const bad of ['-1', 'many', 'null']) {
      const text = serializeRun(record()).replace('---\n', `---\nsuggestions: ${bad}\n`);
      expect(parseRun(text), bad).not.toHaveProperty('suggestions');
    }
    // Zero IS a count, and is kept when written by hand.
    const zero = serializeRun(record()).replace('---\n', '---\nsuggestions: 0\n');
    expect(parseRun(zero)?.suggestions).toBe(0);
  });
});

// A JUDGING RUN'S REPORT IS A VERDICT NOW, not a score (decision 40). The five cases here were about
// `score` and `overshoot` — a fraction of one, zero as a real answer, 4 as no judgement at all, and the
// fold onto the critic's own record. Both fields came off AgentReport and RunRecord with the critic, and
// what replaces them is `verdict`, which the review suite above already pins ("drops a verdict that is
// neither") and test/verify-record.test.ts pins on the record.
