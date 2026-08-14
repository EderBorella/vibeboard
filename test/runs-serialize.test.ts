import { describe, expect, it } from 'vitest';
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

// What the WRITER alone decides. Everything that is really about reading a file back is in
// test/runs-parse.test.ts, composed through a round trip; these two are about the bytes.
describe('serializeRun', () => {
  it('writes identity and state before the rest, so a diff reads top-down', () => {
    const text = serializeRun(record({ outcome: 'success', status: 'success' }));
    const keys = text
      .split('---')[1]
      .trim()
      .split('\n')
      .map((l) => l.split(':')[0]);
    expect(keys.slice(0, 6)).toEqual(['run', 'card', 'board', 'skill', 'status', 'outcome']);
  });

  it('writes no usage key for a record that has none', () => {
    // An empty `usage: {}` in every old run file would be noise in a diff for no information.
    expect(serializeRun(record())).not.toContain('usage');
  });
});
