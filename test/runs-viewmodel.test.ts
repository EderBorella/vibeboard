import { describe, expect, it } from 'vitest';
import type { RunRecord, RunStatus } from '../web/src/api.js';
import { elapsed, groupFor, groupOf, groupRuns, needsAttention } from '../web/src/runs/viewmodel.js';

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  run: 'r1',
  card: 'E-010',
  board: 'engineering',
  skill: 'execute',
  status: 'success',
  started: '2026-07-26T14:30:00.000Z',
  backend: 'claude-code',
  model: 'opus',
  effort: 'high',
  mode: 'bypassPermissions',
  report: '',
  ...over,
});

const STATUSES: RunStatus[] = [
  'queued',
  'running',
  'success',
  'attention',
  'failed',
  'cancelled',
  'interrupted',
];

describe('groupOf', () => {
  it('puts every status in exactly one column', () => {
    expect(STATUSES.map(groupOf)).toEqual([
      'active',
      'active',
      'done',
      'attention',
      'attention',
      'done',
      'attention',
    ]);
  });

  it('treats failed and interrupted as needing attention, not as done', () => {
    // Burying a broken run under successes is how it goes unnoticed for a week.
    expect(groupOf('failed')).toBe('attention');
    expect(groupOf('interrupted')).toBe('attention');
    expect(groupOf('success')).toBe('done');
  });

  it('counts only the attention column as needing you', () => {
    expect(STATUSES.filter((status) => needsAttention(run({ status }))).sort()).toEqual([
      'attention',
      'failed',
      'interrupted',
    ]);
  });
});

describe('a run that has been dealt with', () => {
  it('stops needing you, whatever it says it was', () => {
    // The fix for the bug this was built for: an attention run stayed in the column and on the badge
    // for ever, because status alone can never say "and I have answered it".
    for (const status of ['attention', 'failed', 'interrupted'] as RunStatus[]) {
      expect(needsAttention(run({ status }))).toBe(true);
      expect(needsAttention(run({ status, resolved: '2026-07-26T21:30:00.000Z' }))).toBe(false);
    }
  });

  it('joins the history rather than vanishing', () => {
    // Resolved is not deleted: the run still happened, and its report is still the record of it.
    const grouped = groupRuns([
      run({ run: 'answered', status: 'attention', resolved: '2026-07-26T21:30:00.000Z' }),
      run({ run: 'waiting', status: 'attention' }),
    ]);
    expect(grouped.attention.map((r) => r.run)).toEqual(['waiting']);
    expect(grouped.done.map((r) => r.run)).toEqual(['answered']);
  });

  it('leaves an in-flight run alone — resolving is not stopping', () => {
    // A queued or running record with a `resolved` stamp should not be possible, but if one appears,
    // showing it as history would hide a live process.
    const grouped = groupRuns([
      run({ run: 'live', status: 'running', resolved: '2026-07-26T21:30:00.000Z' }),
    ]);
    expect(grouped.active.map((r) => r.run)).toEqual(['live']);
  });

  it('keeps its status untouched, because that is how it ended', () => {
    expect(groupOf('attention')).toBe('attention');
    expect(groupFor(run({ status: 'attention' }))).toBe('attention');
    expect(groupFor(run({ status: 'attention', resolved: '2026-07-26T21:30:00.000Z' }))).toBe('done');
  });
});

describe('groupRuns', () => {
  it('splits runs into the three columns', () => {
    const grouped = groupRuns([
      run({ run: 'a', status: 'running' }),
      run({ run: 'b', status: 'attention' }),
      run({ run: 'c', status: 'success' }),
      run({ run: 'd', status: 'failed' }),
    ]);
    expect(grouped.active.map((r) => r.run)).toEqual(['a']);
    expect(grouped.attention.map((r) => r.run)).toEqual(['b', 'd']);
    expect(grouped.done.map((r) => r.run)).toEqual(['c']);
  });

  it('shows the longest-running first, but keeps the newest first elsewhere', () => {
    // The API lists newest first. In flight, the oldest is the one that has been going longest and
    // is the one worth looking at; among finished runs, the latest is what you just did.
    const grouped = groupRuns([
      run({ run: 'newest', status: 'running' }),
      run({ run: 'oldest', status: 'running' }),
      run({ run: 'late', status: 'success' }),
      run({ run: 'early', status: 'success' }),
    ]);
    expect(grouped.active.map((r) => r.run)).toEqual(['oldest', 'newest']);
    expect(grouped.done.map((r) => r.run)).toEqual(['late', 'early']);
  });

  it('gives three empty columns for a project with no runs', () => {
    expect(groupRuns([])).toEqual({ active: [], attention: [], done: [] });
  });
});

describe('elapsed', () => {
  const now = Date.parse('2026-07-26T14:32:20.000Z');

  it('counts up to now while a run is in flight', () => {
    expect(elapsed(run(), now)).toBe('2m 20s');
  });

  it('counts to the finish once a run has ended, ignoring now', () => {
    expect(elapsed(run({ finished: '2026-07-26T14:30:45.000Z' }), now)).toBe('45s');
  });

  it('renders the minute boundary as 1m 0s rather than 60s', () => {
    expect(elapsed(run({ finished: '2026-07-26T14:31:00.000Z' }), now)).toBe('1m 0s');
  });

  it('drops the minutes below one', () => {
    expect(elapsed(run({ finished: '2026-07-26T14:30:09.000Z' }), now)).toBe('9s');
  });

  it('says nothing rather than something wrong for an unparseable stamp', () => {
    expect(elapsed(run({ started: 'whenever' }), now)).toBe('');
    expect(elapsed(run({ finished: 'whenever' }), now)).toBe('');
  });

  it('says nothing when the clock appears to run backwards', () => {
    // Two machines, or a clock change: a negative duration is not worth rendering.
    expect(elapsed(run({ started: '2026-07-26T14:40:00.000Z' }), now)).toBe('');
  });
});
