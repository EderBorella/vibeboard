import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { type MiniChecks, miniAction } from '../src/core/lifecycle/mini.js';
import { decideTick } from '../src/core/lifecycle/tick.js';
import type { RunRecord } from '../src/core/runs.js';
import { input } from './tick-fixtures.js';

// DECISION 100: one build, then a review of at most two rounds, decided over this session's runs and what the loop
// measured after the last review.
const START = '2026-09-27T10:00:00Z';
const state = { state: 'running' as const, iteration: 0, at: START };
let n = 0;
const run = (
  skill: string,
  status: RunRecord['status'] = 'success',
  over: Partial<RunRecord> = {},
): RunRecord => {
  n += 1;
  return {
    run: `r${n}`,
    skill,
    status,
    started: `2026-09-27T10:${String(n).padStart(2, '0')}:00Z`,
    backend: 'test',
    model: 'test',
    effort: 'high',
    mode: 'default',
    report: '',
    ...over,
  };
};
const pass: MiniChecks = { passed: true, detail: 'The gates and the smoke command pass.' };
const fail: MiniChecks = { passed: false, detail: '`npm test` failed:\n2 failing' };
const decide = (runs: RunRecord[], miniChecks?: MiniChecks) => miniAction({ runs, state, miniChecks });

describe('the Mini lifecycle', () => {
  it('builds first', () => {
    expect(decide([])).toEqual({ kind: 'dispatch', phase: 'mini-build', skill: 'build-project' });
  });

  it('stops on a build that did not finish, with the reason it gave', () => {
    const build = run('build-project', 'attention', {
      summary: 'The toolchain needs Python, which is not installed.',
    });
    expect(decide([build])).toEqual({
      kind: 'stop',
      reason: 'stalled',
      detail: 'The build ended attention: The toolchain needs Python, which is not installed.',
    });
  });

  it('reviews a finished build', () => {
    expect(decide([run('build-project')])).toEqual({
      kind: 'dispatch',
      phase: 'mini-review',
      skill: 'review-project',
    });
  });

  it('finishes when the review says so and the loop’s own checks pass', () => {
    const action = decide([run('build-project'), run('review-project')], pass);
    expect(action).toMatchObject({ kind: 'stop', reason: 'complete' });
  });

  it.each([
    ['the review asked for another round', 'attention', pass],
    ['the loop’s checks failed', 'success', fail],
  ] as const)('gives the review a second round when %s', (_why, status, checks) => {
    const review = run('review-project', status);
    expect(decide([run('build-project'), review], checks)).toEqual({
      kind: 'dispatch',
      phase: 'mini-review',
      skill: 'review-project',
      previous: review.run,
    });
  });

  it('stops after two rounds, naming what fails and what the review said', () => {
    const runs = [run('build-project'), run('review-project', 'attention')];
    runs.push(run('review-project', 'attention', { summary: 'The smoke command needs a display.' }));
    const action = decide(runs, fail);
    expect(action).toEqual({
      kind: 'stop',
      reason: 'stalled',
      detail:
        'The review did not get the project working in 2 rounds. `npm test` failed:\n2 failing The review ended attention: The smoke command needs a display.',
    });
  });

  it('does not count a check it never made as a pass', () => {
    const action = decide([run('build-project'), run('review-project'), run('review-project')]);
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
    expect(action.kind === 'stop' && action.detail).toContain('could not check the project');
  });

  it('starts from the build again after a new Start', () => {
    const before = run('build-project', 'success', { started: '2026-09-27T09:00:00Z' });
    expect(decide([before])).toMatchObject({ kind: 'dispatch', phase: 'mini-build' });
  });

  it('is what the tick decides for a Mini project, and nothing of the standard walk', () => {
    const action = decideTick(input({ ap: { ...DEFAULT_AUTOPILOT, mode: 'mini' }, state, runs: [] }));
    expect(action).toEqual({ kind: 'dispatch', phase: 'mini-build', skill: 'build-project' });
  });
});
