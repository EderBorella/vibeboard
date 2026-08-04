import { describe, expect, it } from 'vitest';
import {
  attemptsUsed,
  burnsAttempt,
  cardKey,
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
    expect(burnsAttempt(status)).toBe(expected[status]);
  });

  it('counts a card’s runs of one skill, ignoring the rest', () => {
    const runs = [
      run({ skill: 'implement', status: 'failed' }),
      run({ skill: 'implement', status: 'cancelled' }),
      run({ skill: 'critic', status: 'failed' }),
      run({ card: 'E-002', skill: 'implement', status: 'failed' }),
      run({ card: undefined, board: undefined, skill: 'implement', status: 'failed' }),
    ];
    // The critic run and the checkup must not inflate the tally — that is what the skill filter is
    // for, and a run with no card belongs to no card's count.
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
