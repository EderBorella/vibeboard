import type { StopReason } from './dispatch-gate.js';
import type { PhaseName } from './phases.js';
import type { Card } from './types.js';

// The vocabulary the tick speaks and the service carries out. FOUR members: a block is a `stamp` to the
// blocked column and the bootstrap is a `dispatch` with no card, so neither needs a member of its own.
//
// Its own module, and that is a build-order decision: both the tick and `src/service/act.ts` depend on
// this type, so putting it in `tick.ts` would make every consumer import the module whose logic is being
// rewritten. Nothing imports this file until Task 7 of the lifecycle plan, which is where `tick.ts`
// stops declaring its own union and re-exports this one.
export type TickAction =
  | { kind: 'stop'; reason: StopReason; detail?: string }
  | { kind: 'dispatch'; phase: PhaseName; skill: string; card?: Card; previous?: string }
  | { kind: 'stamp'; phase: PhaseName; card: Card; to: string; why: string }
  | { kind: 'wait' }; // as much is in flight as the config allows
