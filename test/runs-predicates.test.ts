import { describe, expect, it } from 'vitest';
import { isInFlight, isRunId, needsResolution, producedNothing, runId } from '../src/core/runs/predicates.js';
import { withFilesChanged, withoutReport, withReport } from '../src/core/runs/transitions.js';
import { RUN_STATUSES, type RunRecord } from '../src/core/runs/types.js';

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

  // The boundary, not a format check: this id becomes a filename, and it arrives from a URL segment
  // that Fastify decodes only AFTER the route has matched — so `%2F` was a `/` by the time the store
  // saw it. Every rejected case below is a separator or a parent reference.
  it('recognises what may become a filename, and refuses what could leave the folder', () => {
    expect(isRunId(runId(new Date('2026-07-26T14:30:12Z'), 'a1b2'))).toBe(true);
    expect(isRunId('r-asking')).toBe(true); // the fixtures' readable shape
    for (const bad of [
      '../../secret',
      '..',
      '.',
      'a/b',
      'a\\b',
      'a.md',
      '',
      'a b',
      '20260726-143012-a1b2/../x',
    ]) {
      expect(isRunId(bad), bad).toBe(false);
    }
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

// Asked before a card's work is verified: verifying nothing is how a card advances over work that never
// happened. Every clause must hold, so the tests below are mostly the ways it must answer NO.
describe('a run that produced nothing', () => {
  const empty = { status: 'failed' as const, filesChanged: 0 };

  it('is a failed run that delivered no report and changed no files', () => {
    expect(producedNothing(record(empty))).toBe(true);
  });

  // THE REAL COMPOSITION, and the reason this test exists rather than only the hand-built ones below. A review
  // found the predicate reading `record.report` — which `withoutReport` fills with the TRANSCRIPT TAIL exactly
  // when there is no agent report, so the answer was false for the one run it must catch. Every hand-built
  // fixture said `report: ''`, a shape the runner never writes, and all of them passed. Build the record the
  // way production builds it.
  it('is true for the record `withoutReport` actually writes for a dead run', () => {
    const dead = withFilesChanged(
      withoutReport(
        record({ status: 'running' }),
        'failed',
        'The agent exited with code 1 and wrote no report.',
        'T',
        '{"kind":"text","text":"\\n[opencode failed: fetch failed]"}',
      ),
      0,
    );
    // The transcript really is sitting in `report` — the premise of the bug, asserted so this test cannot
    // quietly stop being about it.
    expect(dead.report).not.toBe('');
    expect(producedNothing(dead)).toBe(true);
  });

  // And the other half of the same composition: a run that DID deliver a report is verifiable, whatever the
  // clock did to it afterwards. `withReport` is the only producer of `outcome`, which is what the predicate reads.
  it('is false for a run that delivered a report and was then failed by the clock', () => {
    const claimed = withReport(
      record({ status: 'running' }),
      { outcome: 'success', summary: 'did the work', body: '## What I did' },
      'T',
    );
    const killed = withFilesChanged({ ...claimed, status: 'failed' }, 0);
    expect(killed.outcome).toBe('success');
    expect(producedNothing(killed)).toBe(false);
  });

  it('is not a run that changed files, however it ended', () => {
    expect(producedNothing(record({ ...empty, filesChanged: 1 }))).toBe(false);
  });

  // Absent is not zero. A measurement that could not be taken says nothing about what changed, and reading it
  // as "nothing changed" would skip verification on a run that may have done the work.
  it('is not a run whose file count could not be taken', () => {
    expect(producedNothing(record({ status: 'failed', report: '' }))).toBe(false);
  });

  // `attention` FINISHED and said it could not do the work: it has a report, and a verdict is exactly what
  // should judge it. Only an outright failure with nothing behind it is unverifiable.
  it('is not a run that finished and said it could not do the work', () => {
    expect(producedNothing(record({ ...empty, status: 'attention', outcome: 'attention' }))).toBe(false);
  });

  it('is not a run still in flight', () => {
    expect(producedNothing(record({ ...empty, status: 'running' }))).toBe(false);
  });

  // The successful shape of every CARD-PRODUCING skill, and the reason `createdNothing` had to be a second
  // predicate rather than a clause added here: cards are created through the API, so a real derivation
  // legitimately changes no files and reports success. Not one of the three clauses holds, and it must not —
  // this run left plenty behind. Composed through withReport, not hand-built.
  it('is false for a run that created cards and changed no files', () => {
    const derived = withFilesChanged(
      withReport(
        record({ status: 'running', skill: 'derive-features', card: undefined, board: undefined }),
        { outcome: 'success', summary: 'five features', created: ['F-001', 'F-002'], body: '## What I did' },
        'T',
      ),
      0,
    );
    expect(derived.created).toEqual(['F-001', 'F-002']);
    expect(producedNothing(derived)).toBe(false);
  });
});
