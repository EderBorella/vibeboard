import { describe, expect, it } from 'vitest';
import { DOCS_DIR } from '../src/core/layout.js';
import { parseRun } from '../src/core/runs/parse.js';
import { serializeRun } from '../src/core/runs/serialize.js';
import { withoutReport, withReport, withResolution, withUsage } from '../src/core/runs/transitions.js';
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

  it("folds the agent's verdict onto the record", () => {
    const settled = withReport(
      record({ skill: 'review', status: 'running' }),
      { outcome: 'success', summary: 'does what the card asked', verdict: 'done', body: '## Judgement' },
      'T',
    );
    // `outcome` and `verdict` are DIFFERENT facts: the review's own turn went fine, and its answer is
    // about somebody else's work. A review that ran perfectly and sent the work back is success/sent-back.
    expect(settled.outcome).toBe('success');
    expect(settled.verdict).toBe('done');
  });

  it('leaves verdict absent when the report carried none', () => {
    const settled = withReport(
      record({ skill: 'review', status: 'running' }),
      { outcome: 'success', body: 'I had a look' },
      'T',
    );
    expect(settled.verdict).toBeUndefined();
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
