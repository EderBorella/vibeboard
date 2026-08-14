import type { Card } from '../types.js';

// (order, then id) — the one ranking of a queue, and the same one everywhere it is asked for: the
// position derivation, the tick's task pick, and the loop's next feature. Two cards with the same
// order is a board a person edited, and taking the lower id is at least deterministic.
//
// Pure and free of the board reader, so importing a ranking does not import `node:fs`.
export const byQueueOrder = (a: Card, b: Card): number =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
