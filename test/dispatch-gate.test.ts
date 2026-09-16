import { describe, expect, it } from 'vitest';
import { sumSpend } from '../src/core/accounting.js';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { isSuccessReason, mayDispatch, STOP_REASONS, stopSentence } from '../src/core/dispatch-gate.js';
import type { RunRecord } from '../src/core/runs.js';

// The budget switch, enforced in backend code between dispatches. Both projects the spec cites as
// prior art shipped a control wired to nothing: AutoGPT injected its balance into the prompt as
// "BUDGET EXCEEDED! SHUT DOWN!", and AgentGPT's dial reached no backend field at all.
//
// A test asserting "spend below the ceiling dispatches" cannot tell an enforced ceiling from an
// ignored one, so the assertions here are about the BOUNDARY and the refusals — and the gate is
// proved by planting a defect (see the commit body).

const spent = (costUsd?: number): ReturnType<typeof sumSpend> => {
  const record = {
    run: 'r',
    card: 'E-001',
    board: 'engineering',
    skill: 'implement',
    status: 'success',
    started: '',
    backend: '',
    model: '',
    effort: '',
    mode: '',
    report: '',
    ...(costUsd === undefined ? {} : { usage: { costUsd } }),
  } as RunRecord;
  return sumSpend([record]);
};

const ap = (over: Partial<typeof DEFAULT_AUTOPILOT> = {}) => ({ ...DEFAULT_AUTOPILOT, ...over });

describe('the budget ceiling', () => {
  it('stops AT the ceiling, not past it', () => {
    const gate = mayDispatch({ ap: ap({ budgetUsd: 20 }), iteration: 0, spend: spent(20) });
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.reason).toBe('exhausted');
  });

  it('dispatches a cent below it', () => {
    expect(mayDispatch({ ap: ap({ budgetUsd: 20 }), iteration: 0, spend: spent(19.99) }).ok).toBe(true);
  });

  it('names the numbers in its refusal, so the message is actionable', () => {
    const gate = mayDispatch({ ap: ap({ budgetUsd: 20 }), iteration: 0, spend: spent(25) });
    expect(gate.ok === false && gate.message).toContain('20');
    expect(gate.ok === false && gate.message).toContain('25');
  });

  // For a subscription-backed or local model the figure is zero or not what you are billed, and then
  // maxIterations is the cap that governs (S10). A budget of zero means "no dollar budget", never
  // "stop immediately" — which is what a bare `spent >= budget` would have made it.
  it('never binds when the project has no dollar budget', () => {
    expect(mayDispatch({ ap: ap({ budgetUsd: 0 }), iteration: 0, spend: spent(500) }).ok).toBe(true);
  });

  // Absence is not zero and it is not the ceiling either: a backend that reported nothing must
  // neither stop the run nor be treated as having spent everything.
  it('never binds when no run has reported a cost', () => {
    expect(mayDispatch({ ap: ap({ budgetUsd: 20 }), iteration: 0, spend: spent(undefined) }).ok).toBe(true);
  });
});

describe('the iteration cap', () => {
  it('stops AT the cap', () => {
    const gate = mayDispatch({ ap: ap({ maxIterations: 5 }), iteration: 5, spend: spent(0) });
    expect(gate.ok === false && gate.reason).toBe('capped');
  });

  it('dispatches one before it', () => {
    expect(mayDispatch({ ap: ap({ maxIterations: 5 }), iteration: 4, spend: spent(0) }).ok).toBe(true);
  });

  it('is what stops a project with no dollar budget, however much it has spent', () => {
    const gate = mayDispatch({
      ap: ap({ budgetUsd: 0, maxIterations: 5 }),
      iteration: 5,
      spend: spent(9000),
    });
    expect(gate.ok === false && gate.reason).toBe('capped');
  });
});

describe('when both caps are reached', () => {
  // Money is the fact the user cares about most, and `exhausted` is the reason that explains the
  // bill. Reporting `capped` would say the run finished its allotted work when in truth it ran out
  // of money.
  it('reports the budget', () => {
    const gate = mayDispatch({
      ap: ap({ budgetUsd: 20, maxIterations: 5 }),
      iteration: 5,
      spend: spent(20),
    });
    expect(gate.ok === false && gate.reason).toBe('exhausted');
  });
});

// Principle 1, at the one place the spec singles out for planted-defect treatment: a missing or
// invalid precondition BLOCKS rather than passes. The direction is what matters — every one of these
// used to return `{ok: true}` at a million iterations and a billion dollars spent, because a
// comparison against a non-number is false rather than an error.
describe('a cap that is not a usable number', () => {
  const huge = { iteration: 1_000_000, spend: spent(1e9) };

  // `budgetUsd: 0` is the S10 case — a subscription or local model, where iterations are the ONLY cap.
  // A `.nan` in the YAML therefore removed the last thing bounding the run.
  it.each([
    ['not a number', { budgetUsd: 0, maxIterations: Number.NaN }],
    ['missing', { budgetUsd: 0, maxIterations: undefined }],
    ['a string', { budgetUsd: 0, maxIterations: 'abc' }],
    ['zero', { budgetUsd: 0, maxIterations: 0 }],
    ['negative', { budgetUsd: 0, maxIterations: -1 }],
    ['fractional', { budgetUsd: 0, maxIterations: 2.5 }],
  ])('refuses to dispatch when maxIterations is %s', (_label, over) => {
    const gate = mayDispatch({ ...huge, ap: ap(over as Partial<typeof DEFAULT_AUTOPILOT>) });
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.reason).toBe('stalled');
    // The sentence has to send the reader to the cap, not to their board.
    expect(gate.ok === false && gate.message).toContain('maxIterations');
  });

  // Less severe — a valid iteration cap still bounds the run — but a silently skipped budget branch is
  // still a control that does nothing, which is the shape this whole module exists to refuse.
  it.each([
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['negative', -5],
  ])('refuses to dispatch when budgetUsd is %s', (_label, budgetUsd) => {
    const gate = mayDispatch({ ...huge, ap: ap({ budgetUsd }) });
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.message).toContain('budgetUsd');
  });

  it('still dispatches when both caps are usable and neither is reached', () => {
    expect(mayDispatch({ ap: ap({ budgetUsd: 0 }), iteration: 0, spend: spent() }).ok).toBe(true);
  });
});

describe('the terminal reasons', () => {
  // "An error or an exhausted budget never counts as success." Asserted over the whole list rather
  // than one reason at a time, so a reason added later fails this test until someone decides which
  // side of the line it is on.
  it('count exactly one of themselves as success', () => {
    expect(STOP_REASONS.filter(isSuccessReason)).toEqual(['complete']);
  });

  it('each have a sentence a person can read', () => {
    for (const reason of STOP_REASONS) {
      expect(stopSentence(reason).length).toBeGreaterThan(10);
    }
  });

  it('carry the detail when there is one, so a stalled board can name the card', () => {
    expect(stopSentence('stalled', 'E-004 has used all three attempts.')).toContain('E-004');

    // A `complete` DETAIL REPLACES THE CANNED SENTENCE, because that one claims something about the WHOLE
    // BOARD — "nothing is unfinished" — that both details contradict or repeat. Read on a live focused run:
    // the loop reported success and denied it in the same line.
    const focused = stopSentence(
      'complete',
      'Auto-pilot finished F-001. Auto-pilot is focused on F-001, so the rest of the board was left alone.',
    );
    expect(focused).not.toMatch(/nothing is unfinished/);
    expect(focused).toMatch(/^Auto-pilot finished F-001\./);

    // And with no detail the canned sentence is still the whole message — it is all a plain finish has.
    expect(stopSentence('complete')).toMatch(/nothing is unfinished/);
  });
});
