import { describe, expect, it } from 'vitest';
import type { ActDeps } from '../src/service/act.js';
import { performAction } from '../src/service/act.js';
import { context, deps, IMPLEMENT, record } from './service-act-fixtures.js';

// HOW LONG THE LOOP WAITS, and that it always stops waiting. Driven through `performAction` rather than against
// `settle` directly, because the bound only matters where a dispatch depends on it.

describe('waiting for a run to settle', () => {
  const never = (polls: { n: number }) =>
    ({
      dispatch: async () => ({ ok: true as const, value: { run: record() } }),
      cardRuns: async () => {
        polls.n += 1;
        return { ok: true as const, value: { runs: [] } };
      },
      move: async () => ({ ok: true as const, value: {} }),
      log: async () => ({ ok: true as const, value: {} }),
    }) as unknown as ActDeps['client'];

  // The poll interval is large in the first two cases on purpose: an infinite patience is clamped to a day, so
  // with a one-millisecond interval the bound is a hundred thousand polls — correct, and far too slow to watch.
  // A large interval makes the same clamp observable in four.
  it.each([
    ['an infinite patience', { settleTimeoutMs: Number.POSITIVE_INFINITY, settlePollMs: 1_000_000 }],
    ['a patience that is not a number', { settleTimeoutMs: Number.NaN, settlePollMs: 1_000_000 }],
    ['a poll interval that is not a number', { settleTimeoutMs: 10, settlePollMs: Number.NaN }],
    ['a poll interval of zero', { settleTimeoutMs: 10, settlePollMs: 0 }],
    ['a negative patience', { settleTimeoutMs: -1, settlePollMs: 1 }],
  ])('gives up rather than spinning, given %s', async (_name, timing) => {
    const polls = { n: 0 };
    const result = await performAction(
      // A real macrotask, so a bound that has gone fails on vitest's timeout instead of starving it: a
      // microtask-only sleep spins without ever letting a `setTimeout` fire, and the suite hangs.
      deps(never(polls), { ...timing, sleep: () => new Promise((r) => setTimeout(r, 0)) }),
      IMPLEMENT(),
      context,
    );
    // It ends, it says why, and it looked at least once — a bound that answers zero polls is a dispatch
    // nobody ever checked on.
    expect(result.stop?.reason).toBe('stalled');
    expect(result.stop?.detail).toContain('did not finish');
    expect(polls.n).toBeGreaterThan(0);
    // Small, because every one of these is an absurd input clamped to something sane — not merely finite.
    expect(polls.n).toBeLessThanOrEqual(20);
  });

  it('keeps asking while the run is still going', async () => {
    // The polling half was unreached once: the fixture always answered already-settled, so accepting a
    // `running` record as finished changed no test — and a card would then advance over work in progress.
    const settledRun = record({ status: 'success' });
    let look = 0;
    const client = {
      dispatch: async () => ({ ok: true as const, value: { run: settledRun } }),
      cardRuns: async () => {
        look += 1;
        return {
          ok: true as const,
          value: {
            runs: [{ ...settledRun, status: look < 3 ? ('running' as const) : ('success' as const) }],
          },
        };
      },
      verdict: async () => ({ ok: true as const, value: {} }),
      move: async () => ({ ok: true as const, value: {} }),
      log: async () => ({ ok: true as const, value: {} }),
    } as unknown as ActDeps['client'];
    const result = await performAction(
      deps(client, {
        settlePollMs: 1,
        settleTimeoutMs: 1000,
        sleep: () => new Promise((r) => setTimeout(r, 0)),
      }),
      IMPLEMENT(),
      context,
    );
    expect(look).toBe(3);
    expect(result.stop).toBeUndefined();
    expect(result.dispatches).toBe(1);
  });
});

// DECISION 101: a Mini run's wait has no cap, so it must end on the one answer that will never change — a refusal
// that cannot recover, such as a token that died with a server killed without its shutdown path.
describe('waiting for a Mini run', () => {
  it('gives up once its authority is gone, rather than asking for ever', async () => {
    const { settle } = await import('../src/service/act/settle.js');
    let polls = 0;
    const found = await settle(
      deps({} as ActDeps['client'], { settlePollMs: 1, sleep: async () => undefined }),
      'r1',
      async () => {
        polls += 1;
        return { ok: false, reason: 'Unauthorized', fatal: polls > 3 };
      },
      { untilEnded: true },
    );
    expect(found).toBeUndefined();
    expect(polls).toBe(4);
  });
});
