import { describe, expect, it } from 'vitest';
import { formatCost, isMoney } from '../web/src/lib/format.js';

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

// JSON has no Infinity, so a total that overflows arrives as `null`. The web mirror declares
// `costUsd?: number` and every guard tested `=== undefined`, which `null` passes — then `.toFixed`
// threw inside render and took the dashboard with it. The trigger is absurd ($3×10³⁰⁸); what the finding
// is really about is the web layer trusting the wire completely. The copilot dock reaches the same
// guard from the other end: its total is a running sum, and one turn reporting no cost makes it NaN.
describe('a cost the wire could not carry', () => {
  it.each([null, Number.NaN, Number.POSITIVE_INFINITY])('never formats %s as an amount', (bad) => {
    expect(() => formatCost(bad as number)).not.toThrow();
    expect(formatCost(bad as number)).not.toContain('$');
  });

  it('still renders a real zero as a real zero', () => {
    expect(formatCost(0)).toBe('$0');
  });
});

describe('isMoney', () => {
  // A predicate rather than a boolean check, so callers narrow instead of asserting. Both halves are
  // asserted: a guard that accepted nothing would pass every "does not render an amount" test above.
  it.each([0, -1.5, 0.0001, 1e308])('accepts the finite %p', (n) => {
    expect(isMoney(n)).toBe(true);
  });

  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses %s',
    (n) => {
      expect(isMoney(n as number | undefined)).toBe(false);
    },
  );
});
