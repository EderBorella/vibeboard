// Money, as a person reads it. In `core/` because a sentence this module's neighbours GENERATE carries a
// figure — `whichCapBinds` writes "they have cost $…" and the browser renders that string verbatim, so the
// formatting decision is the server's here, not the view's.
//
// Found on screen: the auto-pilot bar rendered "runs have cost $20; they have cost $13.570517." One
// sentence, two figures, one of them six decimal places of a raw float — and the summary directly above it
// in the same view said "$13.57 usage", because THAT number went through the web formatter. The same
// amount, twice, differently, a line apart.
//
// THE RULE IS MIRRORED IN `web/src/lib/format.ts`, deliberately and unavoidably: `web/` is bundler-resolved
// and `src/` is NodeNext with mandatory `.js` extensions, so neither side can import the other. The pair
// is pinned by `test/mirror.test.ts` over a shared table of amounts — which is the only thing that stops
// this becoming the third silent core↔web divergence in this codebase.
export const MONEY_CASES = [0, 0.004, 0.0099, 0.01, 0.5, 0.999, 1, 13.570517, 20] as const;

// Sub-cent runs are the normal case, and `$0.00` for four different runs tells you nothing — so small
// amounts keep more decimals. Above a dollar the cents are what matter.
//
// A PREDICATE rather than a boolean check: `Number.isFinite` narrows nothing, so every call site would
// need its own assertion afterwards — the same mistake repeated instead of one guard written correctly.
export function isMoney(n: number | undefined): n is number {
  return Number.isFinite(n);
}

export function formatUsd(usd: number | undefined): string {
  // NOT `=== undefined`. An overflowing total becomes `null` on the wire because JSON cannot carry
  // Infinity, and a `null` sails straight through an undefined check into `null.toFixed`. Reached from
  // this side too: a hand-edited run record can carry anything.
  if (!isMoney(usd)) return 'not a number';
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
