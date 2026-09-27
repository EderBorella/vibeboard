import { describe, expect, it } from 'vitest';
import type { TickAction } from '../src/core/actions.js';
import type { Verification } from '../src/core/verify.js';
import { performAction } from '../src/service/act.js';
import { context, deps, projectRun, recorder } from './service-act-fixtures.js';

// DECISION 100: after a Mini review the loop runs the gates, then the smoke command, itself — and a review's word
// about its own fixes is not what is handed on.
const REVIEW: TickAction = {
  kind: 'dispatch',
  phase: 'mini-review',
  skill: 'review-project',
  previous: 'r1',
};
const BUILD: TickAction = { kind: 'dispatch', phase: 'mini-build', skill: 'build-project' };
const verdict = (
  mode: 'gates' | 'smoke',
  passed: boolean,
  over: Partial<Verification> = {},
): Verification => ({
  mode,
  passed,
  at: 'T',
  ...over,
});

// The two checks, recording which ran: the order and the omission are both the behaviour.
const verifying = (ran: string[], gates = verdict('gates', true), smoke = verdict('smoke', true)) => ({
  gates: async () => {
    ran.push('gates');
    return gates;
  },
  smoke: async () => {
    ran.push('smoke');
    return smoke;
  },
});

describe('a Mini run, carried out', () => {
  it('asks for the previous round and waits for the run however long it takes', async () => {
    const r = recorder({ settle: [projectRun({ skill: 'review-project' })] });
    await performAction(
      deps(r.client, {
        verify: { gates: async () => verdict('gates', true), smoke: async () => verdict('smoke', true) },
      }),
      REVIEW,
      context,
    );
    expect(r.requests).toEqual([{ project: true, skill: 'review-project', previous: 'r1' }]);
  });

  it('checks nothing after the build', async () => {
    const r = recorder({ settle: [projectRun({ skill: 'build-project' })] });
    const ran: string[] = [];
    const result = await performAction(
      deps(r.client, {
        verify: verifying(ran),
      }),
      BUILD,
      context,
    );
    expect(ran).toEqual([]);
    expect(result).toEqual({ dispatches: 1 });
  });

  it('runs the gates and then the smoke command after a review, and hands on that they pass', async () => {
    const r = recorder({ settle: [projectRun({ skill: 'review-project' })] });
    const ran: string[] = [];
    const result = await performAction(
      deps(r.client, {
        verify: verifying(ran),
      }),
      REVIEW,
      context,
    );
    expect(ran).toEqual(['gates', 'smoke']);
    // On the review's own record: the next round is told it, and the tick reads it off disk.
    expect(r.verdicts).toEqual([{ mode: 'smoke', passed: true, at: 'T', run: expect.any(String) }]);
    expect(result).toEqual({ dispatches: 1 });
  });

  it('names the failing command and what it printed, and runs no smoke command over failing gates', async () => {
    const r = recorder({ settle: [projectRun({ skill: 'review-project' })] });
    const ran: string[] = [];
    const result = await performAction(
      deps(r.client, {
        verify: verifying(ran, verdict('gates', false, { command: 'npm test', output: '2 failing' })),
      }),
      REVIEW,
      context,
    );
    expect(ran).toEqual(['gates']);
    expect(r.verdicts).toMatchObject([
      { mode: 'gates', passed: false, command: 'npm test', output: '2 failing' },
    ]);
    expect(r.diary.map((d) => d.text)).toContain('`npm test` failed:\n2 failing');
    expect(result).toEqual({ dispatches: 1 });
  });

  it('runs no command while a gate document is unread', async () => {
    const r = recorder({ settle: [projectRun({ skill: 'review-project' })] });
    const ran: string[] = [];
    const result = await performAction(
      deps(r.client, {
        state: async () => ({ unreviewedGates: ['CODE-QUALITY.md'] }),
        verify: verifying(ran),
      }),
      REVIEW,
      context,
    );
    expect(ran).toEqual([]);
    expect(result.stop?.reason).toBe('stalled');
  });
});
