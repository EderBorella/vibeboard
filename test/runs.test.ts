import { describe, expect, it } from 'vitest';
import { DOCS_DIR } from '../src/core/layout.js';
import {
  isInFlight,
  needsResolution,
  parseAgentReport,
  parseRun,
  RUN_STATUSES,
  type RunRecord,
  runId,
  serializeRun,
  withoutReport,
  withReport,
  withResolution,
  withUsage,
} from '../src/core/runs.js';

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

describe('runId', () => {
  it('is a sortable stamp plus the caller-supplied suffix', () => {
    expect(runId(new Date('2026-07-26T14:30:12.345Z'), 'a1b2')).toBe('20260726-143012-a1b2');
  });

  it('sorts chronologically as a plain string, which is how the store orders a card history', () => {
    const ids = [
      runId(new Date('2026-07-26T14:30:12Z'), 'zz'),
      runId(new Date('2026-07-26T09:05:00Z'), 'aa'),
      runId(new Date('2026-07-25T23:59:59Z'), 'mm'),
    ];
    expect([...ids].sort()).toEqual([ids[2], ids[1], ids[0]]);
  });
});

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

  it('writes identity and state before the rest, so a diff reads top-down', () => {
    const text = serializeRun(record({ outcome: 'success', status: 'success' }));
    const keys = text
      .split('---')[1]
      .trim()
      .split('\n')
      .map((l) => l.split(':')[0]);
    expect(keys.slice(0, 6)).toEqual(['run', 'card', 'board', 'skill', 'status', 'outcome']);
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

describe('withUsage', () => {
  it('attaches what the turn spent', () => {
    const spent = withUsage(record(), { costUsd: 0.01, turns: 2 });
    expect(spent.usage).toEqual({ costUsd: 0.01, turns: 2 });
  });

  it('leaves the record alone when the backend said nothing', () => {
    // Not `usage: {}` — a turn that never reported is different from one that reported zeros, and
    // the record should not claim otherwise.
    const before = record();
    expect(withUsage(before, undefined)).toBe(before);
  });

  it('does not mutate the record it is given', () => {
    const before = record();
    withUsage(before, { costUsd: 1 });
    expect(before.usage).toBeUndefined();
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

  it('writes no usage key for a record that has none', () => {
    // An empty `usage: {}` in every old run file would be noise in a diff for no information.
    expect(serializeRun(record())).not.toContain('usage');
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

describe('withReport', () => {
  it('takes the agent verdict and body but keeps VibeBoard timings and dispatch', () => {
    const folded = withReport(
      record({ prompt: 'mine', attached: [`${DOCS_DIR}/a.md`] }),
      { outcome: 'success', summary: 'done', created: ['E-041'], body: '## Did it' },
      '2026-07-26T15:00:00.000Z',
    );
    expect(folded.status).toBe('success');
    expect(folded.outcome).toBe('success');
    expect(folded.finished).toBe('2026-07-26T15:00:00.000Z');
    expect(folded.summary).toBe('done');
    expect(folded.created).toEqual(['E-041']);
    expect(folded.report).toBe('## Did it');
    // The record's own fields survive an agent that rewrote its file wholesale.
    expect(folded.started).toBe('2026-07-26T14:30:12.000Z');
    expect(folded.model).toBe('opus');
    expect(folded.prompt).toBe('mine');
    expect(folded.attached).toEqual([`${DOCS_DIR}/a.md`]);
  });

  it('leaves optional agent fields absent when the report omits them', () => {
    const folded = withReport(record(), { outcome: 'success', body: 'x' }, 'T');
    expect(folded.summary).toBeUndefined();
    expect(folded.options).toBeUndefined();
    expect(folded.created).toBeUndefined();
  });

  it('sets status to attention for an attention report', () => {
    const folded = withReport(record(), { outcome: 'attention', body: 'x' }, 'T');
    expect(folded.status).toBe('attention');
  });
});

describe('withoutReport', () => {
  it('records the status the caller decided, with a note in place of a report', () => {
    const ended = withoutReport(record(), 'failed', 'exited with 1', 'T', '  tail of output  ');
    expect(ended.status).toBe('failed');
    expect(ended.note).toBe('exited with 1');
    expect(ended.finished).toBe('T');
    expect(ended.report).toBe('tail of output');
    expect(ended.outcome).toBeUndefined();
  });

  it('leaves an empty report when there is no transcript to show', () => {
    expect(withoutReport(record(), 'cancelled', 'you stopped it', 'T').report).toBe('');
  });
});

describe('isInFlight', () => {
  it('is true only for queued and running', () => {
    expect(RUN_STATUSES.filter(isInFlight)).toEqual(['queued', 'running']);
  });
});

describe('needsResolution', () => {
  it('is true for exactly the endings a person has to answer', () => {
    // Not `success` (finished work) and not `cancelled` (a decision already taken). Not queued or
    // running either: those have not ended, and stopping one is cancel, not a resolution.
    const asking = RUN_STATUSES.filter((status) => needsResolution(record({ status })));
    expect(asking).toEqual(['attention', 'failed', 'interrupted']);
  });

  it('is false once the run carries a resolution, whatever it says it was', () => {
    // The bug this exists for: without this field, an attention run asks for ever.
    for (const status of ['attention', 'failed', 'interrupted'] as const) {
      expect(needsResolution(record({ status, resolved: '2026-07-26T21:30:00.000Z' }))).toBe(false);
    }
  });
});

describe('withResolution', () => {
  it('stamps the record and changes nothing else', () => {
    const asking = record({ status: 'attention', outcome: 'attention', summary: 'bigger than one card' });
    expect(withResolution(asking, 'T')).toEqual({ ...asking, resolved: 'T' });
  });

  it('survives a round trip through the file, so a reload does not forget', () => {
    const resolved = withResolution(record({ status: 'attention' }), '2026-07-26T21:30:00.000Z');
    expect(parseRun(serializeRun(resolved))?.resolved).toBe('2026-07-26T21:30:00.000Z');
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
