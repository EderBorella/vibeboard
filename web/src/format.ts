// Money, for every surface that shows it. ONE home because there were two and they disagreed: the
// copilot dock rendered $0.50 as `$0.5000` while the runs pane rendered `$0.500`, so the same number
// read as two different amounts depending on which screen you were on. Only one of the two carried the
// guard below, and the guarded one is what survives.

// Sub-cent runs are the normal case, and $0.00 for four different runs tells you nothing — so small
// amounts keep four decimals. Above a dollar the cents are what matter.
// A predicate, not a boolean check: `Number.isFinite` narrows nothing, and the alternative is a non-null
// assertion at every use site — the same mistake repeated rather than one guard written correctly.
export function isMoney(n: number | undefined): n is number {
  return Number.isFinite(n);
}

export function formatCost(usd: number): string {
  // `null`, not `undefined`, is what an overflowing total becomes on the wire: JSON cannot carry
  // Infinity. The web mirror declares `costUsd?: number` and every guard tests `=== undefined`, which
  // `null` sails through — and `null.toFixed` throws inside render, taking the dashboard with it. What
  // makes this worth a guard rather than a shrug is that it is the web layer trusting the wire
  // completely; the trigger being absurd does not make the trust sound. The copilot dock reaches it by a
  // second route: its total is a running sum, and one turn reporting no cost makes every later frame NaN.
  if (!isMoney(usd)) return 'not a number';
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
