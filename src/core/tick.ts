// The lifecycle machine, split into `lifecycle/` by subject: the phase router and the decision path in
// `lifecycle/tick.ts`, and the sentences a person reads when the loop stops in `lifecycle/stop-sentences.ts`.
//
// THIS FILE SURVIVES AS THE BARREL AND MUST. NodeNext has no directory-index resolution, so
// `import … from '../core/tick.js'` cannot be pointed at `tick/index.js` — it is a `TS2307`, verified. The
// same reason `core/runs.ts` and `core/board.ts` survive: keeping the specifier is what made the split cost
// no importer a change.
//
// Re-export everything the split modules export. A symbol added there and missing here is invisible to every
// existing caller, which is the one failure mode this file has.

export { decideTick, type TickAction, type TickInput } from './lifecycle/tick.js';
