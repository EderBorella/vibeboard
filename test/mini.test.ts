import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { miniAction } from '../src/core/lifecycle/mini.js';
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

import type { Verification } from '../src/core/verify.js';

const pass: Verification = { mode: 'smoke', passed: true, at: 'T' };
const fail: Verification = {
  mode: 'gates',
  passed: false,
  at: 'T',
  command: 'npm test',
  output: '2 failing',
};
const commands = { gates: ['npm test'], smoke: 'node greet.js Ada' };
const decide = (runs: RunRecord[]) => miniAction({ runs, state, commands });

describe('the Mini lifecycle', () => {
  it('builds first', () => {
    expect(decide([])).toEqual({ kind: 'dispatch', phase: 'mini-build', skill: 'build-project' });
  });

  it('names what the server noted when a stopped run gave no reason', () => {
    const build = run('build-project', 'failed', {
      note: 'The agent had produced nothing for 10 minutes, so it was stopped.',
    });
    expect(decide([build])).toMatchObject({
      detail: 'The build ended failed: The agent had produced nothing for 10 minutes, so it was stopped.',
    });
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
    const action = decide([run('build-project'), run('review-project', 'success', { verification: pass })]);
    expect(action).toMatchObject({ kind: 'stop', reason: 'complete' });
  });

  it('does not finish over a smoke command that is one of the gates (decision 66)', () => {
    const runs = [run('build-project'), run('review-project', 'success', { verification: pass })];
    const action = miniAction({ runs, state, commands: { gates: ['npm test'], smoke: 'npm test' } });
    expect(action).toMatchObject({ kind: 'stop', reason: 'stalled' });
  });

  it.each([
    ['the review asked for another round', 'attention', pass],
    ['the loop’s checks failed', 'success', fail],
  ] as const)('gives the review a second round when %s', (_why, status, checks) => {
    const review = run('review-project', status, { verification: checks });
    expect(decide([run('build-project'), review])).toEqual({
      kind: 'dispatch',
      phase: 'mini-review',
      skill: 'review-project',
      previous: review.run,
    });
  });

  it('stops after two rounds, naming what fails and what the review said', () => {
    const runs = [run('build-project'), run('review-project', 'attention')];
    runs.push(
      run('review-project', 'attention', {
        summary: 'The smoke command needs a display.',
        verification: fail,
      }),
    );
    const action = decide(runs);
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
