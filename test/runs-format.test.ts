import { describe, expect, it } from 'vitest';
import type { RunUsage } from '../web/src/api.js';
import { costLabel, formatCost, formatDuration, formatTokens, usageLine } from '../web/src/runs/format.js';

describe('formatCost', () => {
  it('keeps four decimals for sub-cent runs, which is most of them', () => {
    // $0.00 for four different runs tells you nothing, and a skill run is usually fractions of a cent.
    expect(formatCost(0.0004)).toBe('$0.0004');
    expect(formatCost(0.0099)).toBe('$0.0099');
  });

  it('drops to three then two decimals as the number grows', () => {
    expect(formatCost(0.0125)).toBe('$0.013');
    expect(formatCost(0.42)).toBe('$0.420');
    expect(formatCost(1.5)).toBe('$1.50');
    expect(formatCost(12.345)).toBe('$12.35');
  });

  it('says $0 for a free model, not $0.0000', () => {
    // Zero is a real answer here and deserves to read like one.
    expect(formatCost(0)).toBe('$0');
  });
});

describe('formatTokens', () => {
  it('is exact below a thousand', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(7)).toBe('7');
    expect(formatTokens(999)).toBe('999');
  });

  it('switches to thousands, losing the decimal once it stops mattering', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(48210)).toBe('48.2k');
    expect(formatTokens(99900)).toBe('99.9k');
    expect(formatTokens(150000)).toBe('150k');
    expect(formatTokens(1200000)).toBe('1200k');
  });
});

describe('formatDuration', () => {
  it('rounds to seconds under a minute', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(1250)).toBe('1s');
    expect(formatDuration(1600)).toBe('2s');
    expect(formatDuration(59_000)).toBe('59s');
  });

  it('splits into minutes and seconds beyond that', () => {
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(62_431)).toBe('1m 2s');
    expect(formatDuration(600_000)).toBe('10m');
    expect(formatDuration(3_661_000)).toBe('61m 1s');
  });
});

describe('usageLine', () => {
  const usage = (over: Partial<RunUsage> = {}): RunUsage => ({
    costUsd: 0.0421,
    durationMs: 62_431,
    turns: 7,
    contextTokens: 48_210,
    outputTokens: 1832,
    ...over,
  });

  it('reads money, time, work, size — in that order', () => {
    expect(usageLine(usage())).toBe('$0.042 · 1m 2s · 7 turns · 48.2k ctx · 1.8k out');
  });

  it('says nothing at all when there is no usage', () => {
    // Older runs have none. An empty string renders nothing; a placeholder would imply zero.
    expect(usageLine(undefined)).toBe('');
    expect(usageLine({})).toBe('');
  });

  it('includes only what the backend reported', () => {
    expect(usageLine({ costUsd: 0.01 })).toBe('$0.010');
    expect(usageLine({ turns: 2, contextTokens: 500 })).toBe('2 turns · 500 ctx');
  });

  it('shows a reported zero rather than hiding it', () => {
    // The trap: `if (usage.costUsd)` here would erase every free run's cost.
    expect(usageLine({ costUsd: 0, turns: 0, outputTokens: 0 })).toBe('$0 · 0 turns · 0 out');
  });

  it('says "1 turn", not "1 turns"', () => {
    expect(usageLine({ turns: 1 })).toBe('1 turn');
  });
});

describe('costLabel', () => {
  it('is the cost alone, for rows with one slot', () => {
    expect(costLabel({ costUsd: 0.0125, turns: 9 })).toBe('$0.013');
  });

  it('is empty when the cost is unknown, and $0 when it is known to be nothing', () => {
    // These two must not render alike: one is "no data", the other is "free".
    expect(costLabel(undefined)).toBe('');
    expect(costLabel({ turns: 3 })).toBe('');
    expect(costLabel({ costUsd: 0 })).toBe('$0');
  });
});
