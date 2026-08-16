import { describe, expect, it } from 'vitest';
import {
  attemptsUsed,
  burnsAttempt,
  cardKey,
  consecutiveInfrastructureFailures,
  governingCap,
  spendByCard,
  splitCardKey,
  sumSpend,
} from '../src/core/accounting.js';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { RUN_STATUSES, type RunRecord, type RunStatus, type RunUsage } from '../src/core/runs.js';

// The README's own recorded gap: "Cost across runs — a per-card and per-project total. Each run now
// records its own; nothing yet adds them up."
//
// The load-bearing property throughout is the one RunUsage already states and nothing yet applied
// consistently: ABSENCE AND ZERO ARE DIFFERENT FACTS. A project whose backend reports no cost has
// not spent nothing.

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  run: '20260803-100000-aaaa',
  card: 'E-001',
  board: 'engineering',
  skill: 'implement',
  status: 'success',
  started: '2026-08-03T10:00:00.000Z',
  backend: 'claude-code',
  model: 'opus',
  effort: 'high',
  mode: 'bypassPermissions',
  report: '',
  ...over,
});

const withCost = (costUsd: number, over: Partial<RunUsage> = {}): Partial<RunRecord> => ({
  usage: { costUsd, ...over },
});

describe('summing what runs spent', () => {
  it('reports no cost at all for no runs, rather than zero', () => {
    const spend = sumSpend([]);
    expect(spend).toEqual({ runs: 0, withCost: 0, withoutCost: 0 });
    expect('costUsd' in spend).toBe(false);
  });

  // A free or local model really does cost nothing, and that is worth recording. It must not read the
  // same as a backend that said nothing.
  it('keeps a reported zero as zero', () => {
    const spend = sumSpend([run(withCost(0))]);
    expect(spend.costUsd).toBe(0);
    expect(spend.withCost).toBe(1);
    expect(spend.withoutCost).toBe(0);
  });

  it('says how many runs contributed and how many could not', () => {
    const spend = sumSpend([run(withCost(0.1)), run(withCost(0.2)), run()]);
    // Exactly 0.3: the total is rounded to the sixth decimal, or float dust would make every
    // assertion about money approximate and every displayed figure slightly wrong.
    expect(spend.costUsd).toBe(0.3);
    expect(spend).toMatchObject({ runs: 3, withCost: 2, withoutCost: 1 });
  });

  it('sums tokens and duration independently of cost', () => {
    const spend = sumSpend([
      run({ usage: { outputTokens: 100, durationMs: 1000 } }),
      run({ usage: { costUsd: 1, outputTokens: 50 } }),
    ]);
    expect(spend).toMatchObject({ costUsd: 1, outputTokens: 150, durationMs: 1000, withCost: 1 });
  });

  it('leaves out a field no run reported', () => {
    const spend = sumSpend([run(withCost(1))]);
    expect('outputTokens' in spend).toBe(false);
    expect('durationMs' in spend).toBe(false);
  });
});

describe('per-card totals', () => {
  it('keys on the board as well as the card', () => {
    const byCard = spendByCard([
      run({ card: 'E-001', board: 'engineering', ...withCost(1) }),
      run({ card: 'P-001', board: 'product', ...withCost(2) }),
    ]);
    expect(byCard.get(cardKey('engineering', 'E-001'))?.costUsd).toBe(1);
    expect(byCard.get(cardKey('product', 'P-001'))?.costUsd).toBe(2);
  });

  it('adds a card’s runs together', () => {
    const byCard = spendByCard([run(withCost(1)), run(withCost(2.5))]);
    expect(byCard.get(cardKey('engineering', 'E-001'))).toMatchObject({ costUsd: 3.5, runs: 2 });
  });

  // A checkup is about the project. Attributing its cost to a card would make one card look
  // expensive for work that was not about it.
  it('excludes runs that are about the project', () => {
    const byCard = spendByCard([
      run(withCost(1)),
      run({ card: undefined, board: undefined, skill: 'checkup', ...withCost(9) }),
    ]);
    expect([...byCard.keys()]).toEqual([cardKey('engineering', 'E-001')]);
  });
});

describe('which endings burn an attempt', () => {
  // One assertion per row of the spec's table. Conflating these breaks the cap in one direction or
  // the other: a timeout that did not burn would let a card that hangs every time retry until the
  // iteration or budget cap took down the whole run.
  const expected: Record<RunStatus, boolean> = {
    failed: true, // the agent had its chance and did not deliver — a timeout is recorded here
    attention: true, // it finished and reported it could not complete the work
    success: true, // a run of that skill on that card happened; the spec's table is silent, we are not
    cancelled: false, // you stopped it
    interrupted: false, // stale after a restart; it never got to finish
    queued: false, // has not ended
    running: false, // has not ended
  };

  it.each(RUN_STATUSES)('%s', (status) => {
    expect(burnsAttempt({ status })).toBe(expected[status]);
  });

  // THE STATUS TABLE ABOVE IS NOT THE WHOLE ANSWER any more, and these are the two ways it is overruled.
  // Both are written against `failed`, the status that used to decide this on its own and the one every
  // real case landed in.
  it('does not burn when the MACHINE failed rather than the work', () => {
    expect(burnsAttempt({ status: 'failed', fault: 'infrastructure' })).toBe(false);
  });

  // A person's decision beats every other rule here, including a status nobody disputes. Asserted on
  // `success` as well as `failed` so this cannot be mistaken for a second way of spelling the line above.
  it('does not burn once a person has forgiven it, whatever it was', () => {
    expect(burnsAttempt({ status: 'failed', forgiven: '2026-08-16T00:00:00.000Z' })).toBe(false);
    expect(burnsAttempt({ status: 'success', forgiven: '2026-08-16T00:00:00.000Z' })).toBe(false);
    expect(burnsAttempt({ status: 'attention', forgiven: '2026-08-16T00:00:00.000Z' })).toBe(false);
  });

  // The fail-safe direction, stated as a test because it is a decision and not an accident: a failure
  // nothing classified still costs the card an attempt. A classifier that misses a case is then merely
  // unhelpful, where the opposite would let a genuinely failing card retry for ever.
  it('still burns an UNCLASSIFIED failure', () => {
    expect(burnsAttempt({ status: 'failed' })).toBe(true);
  });

  it('counts a card’s runs of one skill, ignoring the rest', () => {
    const runs = [
      run({ skill: 'implement', status: 'failed' }),
      run({ skill: 'implement', status: 'cancelled' }),
      run({ skill: 'review', status: 'failed' }),
      run({ card: 'E-002', skill: 'implement', status: 'failed' }),
      run({ card: undefined, board: undefined, skill: 'implement', status: 'failed' }),
    ];
    // The judging run and the checkup must not inflate the tally — that is what the skill filter is for,
    // and a run with no card belongs to no card's count. The judge used to be the critic; the property is
    // the same and is what the review and fix caps are counted on.
    expect(attemptsUsed(runs, 'E-001', 'implement')).toBe(1);
  });
});

// The pair, asserted as a pair: the composer splits the key to build its response, and splitting on
// every separator instead of the first dropped everything after a second slash.
describe('the card key', () => {
  it('round-trips a board and a card', () => {
    expect(splitCardKey(cardKey('engineering', 'E-001'))).toEqual({
      board: 'engineering',
      card: 'E-001',
    });
  });

  it('keeps a card id that contains a separator whole', () => {
    expect(splitCardKey(cardKey('product', 'P-001/sub'))).toEqual({
      board: 'product',
      card: 'P-001/sub',
    });
  });
});

describe('which cap is actually bounding this project', () => {
  const spent = (costUsd?: number): ReturnType<typeof sumSpend> =>
    sumSpend(costUsd === undefined ? [run()] : [run(withCost(costUsd))]);

  it('is the budget when there is one and the backend reports cost', () => {
    expect(governingCap({ ...DEFAULT_AUTOPILOT, budgetUsd: 20 }, spent(1), 0).cap).toBe('budget');
  });

  // S10: for a subscription-backed or local model the figure is zero or not what you are billed, so
  // a dollar dial would never trip and the settings tab must say which cap really applies.
  it('is iterations when the project has no dollar budget', () => {
    expect(governingCap({ ...DEFAULT_AUTOPILOT, budgetUsd: 0 }, spent(1), 0).cap).toBe('iterations');
  });

  it('is iterations when no run has reported a cost', () => {
    const answer = governingCap({ ...DEFAULT_AUTOPILOT, budgetUsd: 20 }, spent(undefined), 0);
    expect(answer.cap).toBe('iterations');
    expect(answer.why).toContain('reported a cost');
  });

  it('explains itself in a sentence naming the number', () => {
    const answer = governingCap({ ...DEFAULT_AUTOPILOT, budgetUsd: 20, maxIterations: 250 }, spent(1), 0);
    expect(answer.why).toContain('20');
  });

  // The finding this argument exists for: naming the budget whenever one exists told a project ONE
  // dispatch from its iteration cap, with a cent spent, that money would stop it. The claim the
  // sentence makes is "which cap is bounding this project", and that has to be the nearer one.
  it('is iterations when the iteration cap is nearer than the budget', () => {
    const ap = { ...DEFAULT_AUTOPILOT, budgetUsd: 20, maxIterations: 250 };
    const answer = governingCap(ap, spent(0.01), 249);
    expect(answer.cap).toBe('iterations');
    expect(answer.why).toContain('250');
    expect(answer.why).toContain('249');
  });

  it('is the budget when the budget is nearer than the iteration cap', () => {
    const ap = { ...DEFAULT_AUTOPILOT, budgetUsd: 20, maxIterations: 250 };
    expect(governingCap(ap, spent(19.5), 3).cap).toBe('budget');
  });

  // Future tense, because slice D builds the gate and slice C is what calls it. A dial described in the
  // present indicative about behaviour that does not exist yet is the exact shape of the two projects
  // the spec cites as prior art.
  it('describes what will happen, never what already does', () => {
    const ap = { ...DEFAULT_AUTOPILOT, budgetUsd: 20 };
    for (const answer of [governingCap(ap, spent(1), 0), governingCap(ap, spent(undefined), 0)]) {
      expect(answer.why).toContain('will stop');
      expect(answer.why).not.toContain('stops when');
    }
  });
});

// THE OTHER HALF OF NOT BURNING AN ATTEMPT. Once an infrastructure failure costs a card nothing, the
// attempt cap can no longer be what stops a project whose credential has died — it would retry the same
// card until the iteration cap took the whole run down, having done nothing and explained none of it.
// This is what catches it instead, and it is a fact about the PROJECT rather than about any card.
describe('consecutiveInfrastructureFailures', () => {
  const at = (n: number, over: Partial<RunRecord> = {}): RunRecord =>
    run({ started: `2026-08-15T23:0${n}:00.000Z`, ...over });
  const broke = (n: number, over: Partial<RunRecord> = {}): RunRecord =>
    at(n, { status: 'failed', fault: 'infrastructure', ...over });

  it('is empty when nothing has failed that way', () => {
    expect(consecutiveInfrastructureFailures([at(1), at(2)])).toEqual([]);
  });

  // ORDERED BY `started`, not by array position. The runs arrive from a directory listing, and a caller
  // that happened to hand them over newest-first would otherwise read the streak off the wrong end.
  it('counts from the END of the history however the runs arrive', () => {
    const runs = [broke(3), at(1), broke(2)];
    expect(consecutiveInfrastructureFailures(runs)).toHaveLength(2);
  });

  // The reset, and the reason the word is "consecutive". A project that broke, was fixed, and has been
  // working since is not a broken project — holding its history against it would leave the loop refusing
  // to start long after the fault was gone.
  it('is reset by any run that reached a model', () => {
    expect(consecutiveInfrastructureFailures([broke(1), broke(2), at(3)])).toEqual([]);
  });

  // A queued run says nothing either way YET. Breaking on it would hide a streak that is genuinely
  // there — which is the case that matters, since a dispatch is exactly what is in flight when the
  // loop asks this question.
  it('looks past a run still in flight', () => {
    const streak = consecutiveInfrastructureFailures([broke(1), broke(2), at(3, { status: 'running' })]);
    expect(streak).toHaveLength(2);
  });

  it('returns the records themselves, so the stop can quote what went wrong', () => {
    const streak = consecutiveInfrastructureFailures([broke(1, { note: 'OAuth session expired' })]);
    expect(streak[0]?.note).toBe('OAuth session expired');
  });
});

// THE DEADLOCK THIS FUNCTION WOULD OTHERWISE CREATE, and the reason `since` exists.
//
// The streak is read off the END of the history. So once it has stopped the loop, the user fixes the
// machine and presses Start — and the history still ends with those same failures, so the first tick
// stops again, identically, for ever. Auto-pilot cannot break its own streak because it never gets to
// dispatch. The bug is a strictly worse version of the one the streak was added to fix: before, one
// card was blocked; after, the whole project is, and no button anywhere clears it.
describe('a streak that must not brick the project it protects', () => {
  const broke = (n: number): RunRecord =>
    run({
      started: `2026-08-15T23:0${n}:00.000Z`,
      status: 'failed',
      fault: 'infrastructure',
    });

  it('ignores the failures that happened BEFORE auto-pilot was started again', () => {
    const history = [broke(1), broke(2), broke(3)];
    // The user rebuilt the boxes and pressed Start at 23:05. Everything above is evidence about a
    // machine that no longer exists.
    expect(consecutiveInfrastructureFailures(history, '2026-08-15T23:05:00.000Z')).toEqual([]);
  });

  // And it must still bite if the fix did not work: taking the user at their word costs one run, not
  // an unbounded number.
  it('rebuilds immediately when the machine is still broken after the restart', () => {
    const since = '2026-08-15T23:05:00.000Z';
    const after = [
      run({ started: '2026-08-15T23:06:00.000Z', status: 'failed', fault: 'infrastructure' }),
      run({ started: '2026-08-15T23:07:00.000Z', status: 'failed', fault: 'infrastructure' }),
    ];
    expect(consecutiveInfrastructureFailures(after, since)).toHaveLength(2);
  });

  // The other way out, for the user who forgives a card's runs without restarting the loop.
  it('is cleared by a person forgiving the run', () => {
    const history = [
      broke(1),
      run({
        started: '2026-08-15T23:02:00.000Z',
        status: 'failed',
        fault: 'infrastructure',
        forgiven: '2026-08-15T23:04:00.000Z',
      }),
    ];
    expect(consecutiveInfrastructureFailures(history)).toEqual([]);
  });
});
