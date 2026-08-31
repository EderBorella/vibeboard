// MOTION, IN ONE PLACE. Durations and easings as values a JS animation can read, mirrored into
// `design/tokens.css` as `--motion-*` so a CSS animation spends the same numbers.
//
// THE PATTERN IS ONE SOURCE MIRRORED, and it is chosen rather than assumed: the alternatives are
// JS-only, which leaves `.vb-dot-pulse` hand-writing `1.6s` forever, and CSS-only, which a JS library
// cannot read without `getComputedStyle` on every animation. Mirroring is what design systems that
// carry both actually do — see docs/superpowers/plans/2026-08-31-motion-and-thinking-indicator.md.
//
// THE MIRROR IS PER-CONSUMER, AND THE GATE TAUGHT US THAT. The plan said mirror all five names into
// `tokens.css`; `check:tokens` refused, because four of them are read only from here and would have
// been five properties no rule references — which is `--scan` exactly, unconsumed across three
// palettes. So a name is mirrored WHEN A CSS RULE SPENDS IT, and today that is `slow` alone, for
// `.vb-dot-pulse`. This file stays the source for both halves either way.
//
// AND THE MIRROR IS HELD BY A TEST, NOT BY DISCIPLINE. `test/motion-tokens.test.ts` resolves the
// mirrored property out of the stylesheet through `test/css-box.tsx` and asserts it equals the
// constant below. Two spellings of one value cannot silently disagree, which is the whole objection
// to mirroring and the only reason it is safe here.
//
// FOUR NAMES, DELIBERATELY. The researched advice is to keep the set at instant/fast/base/slow and
// grow it only when a real case demands one — the same N−1 test every other scale in this repository
// had to pass. A fifth duration wants an argument, not a preference.

// Milliseconds, because that is what `motion` takes for a `duration` and what a CSS `ms` value spells
// without conversion. The CSS mirror writes `120ms`, not `0.12s`, for exactly that reason.
export const DURATION = {
  // Hovers and chips: below ~150ms a change reads as instant rather than as a movement.
  fast: 120,
  // Enter and exit. The default for anything appearing or leaving.
  base: 240,
  // The liveness pulse. 1600ms because `.vb-dot-pulse` in molecules/status-chip.css is ALREADY
  // `1.6s` — this token exists so that rule can stop hand-writing it, not to introduce a new speed.
  slow: 1600,
} as const;

// Cubic-bézier control points, in the tuple shape `motion` expects. The CSS mirror spells the same
// four numbers as `cubic-bezier(...)`.
export const EASE = {
  // Decelerate: fast out, slow in. Anything arriving, and most state changes.
  standard: [0.4, 0, 0.2, 1],
  // Accelerate: something leaving does not need to be watched all the way out.
  exit: [0.4, 0, 1, 1],
} as const;

export type DurationName = keyof typeof DURATION;
export type EaseName = keyof typeof EASE;
