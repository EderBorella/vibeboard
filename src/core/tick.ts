// The lifecycle machine, split into `lifecycle/` by subject: the phase router and the decision path in
// `lifecycle/tick.ts`, and the sentences a person reads when the loop stops in `lifecycle/stop-sentences.ts`.
//
// THIS FILE SURVIVES AS THE BARREL AND MUST. NodeNext has no directory-index resolution, so
// `import … from './tick.js'` cannot be pointed at `tick/index.js` — it is a `TS2307`, verified. The
// same reason `core/runs.ts` survives: keeping the specifier is what made the split cost no importer a
// change. A barrel is for a SPLIT, where the old path still names the same thing. It is exactly wrong for a
// MOVE — the board reader left for `store/cards/board.ts` with no barrel behind it, because a stub at the
// old path would preserve the very import edge the move exists to delete.
//
// Re-export everything the split modules export. A symbol added there and missing here is invisible to every
// existing caller, which is the one failure mode this file has.

export { decideTick, type TickAction, type TickInput } from './lifecycle/tick.js';
