import { describe, expect, it } from 'vitest';
import {
  isInFlight,
  parseAgentReport,
  parseRun,
  RUN_STATUSES,
  type RunRecord,
  runId,
  serializeRun,
  withoutReport,
  withReport,
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
      attached: ['docs/api.md'],
      summary: 'bigger than one card',
      options: ['split it', 'do the store only'],
      created: ['E-041', 'E-042'],
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
      record({ prompt: 'mine', attached: ['docs/a.md'] }),
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
    expect(folded.attached).toEqual(['docs/a.md']);
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
