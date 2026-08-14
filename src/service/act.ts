// Carrying one action out, split into `act/` by subject: the orchestrator and its two paths (index), what a
// checkup is told (checkup), what a settled card run earned (outcomes), the tail of the one run with no card
// (bootstrap), the deterministic-gates-then-model review (review), every sentence a person reads afterwards
// (sentences), and the two things every path needs — how it waits (settle) and how it reports a refusal
// (refusals).
//
// THIS FILE SURVIVES AS THE BARREL AND MUST. NodeNext has no directory-index resolution, so the modules that
// `import … from './act.js'` cannot be pointed at `act/index.js` — it is a `TS2307`, verified. Keeping the
// specifier is what made the split cost no importer a change.
//
// Re-export everything the split modules export that anything outside `act/` asks for. A symbol added there and
// missing here is invisible to every existing caller, which is the one failure mode this file has.

export { type ActDeps, commitTail, performAction } from './act/index.js';
export { reviewTask } from './act/review.js';
