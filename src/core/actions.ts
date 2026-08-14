import type { StopReason } from './dispatch-gate.js';
import type { PhaseName } from './phases.js';
import type { Card } from './types.js';

// The vocabulary the tick speaks and the service carries out. FOUR members: a block is a `stamp` to the
// blocked column and the bootstrap is a `dispatch` with no card, so neither needs a member of its own.
//
// Its own module, and that is a dependency decision: both the lifecycle machine and the loop that carries
// its actions out depend on this type, so declaring it inside `tick.ts` would make every consumer import
// the module whose logic changes most. `core/lifecycle/tick.ts` and `service/act/index.ts` import it, and
// `tick.ts` re-exports it rather than declaring a union of its own — which is what stops the vocabulary
// and the machine drifting apart.
export type TickAction =
  | { kind: 'stop'; reason: StopReason; detail?: string }
  | { kind: 'dispatch'; phase: PhaseName; skill: string; card?: Card; previous?: string }
  | { kind: 'stamp'; phase: PhaseName; card: Card; to: string; why: string }
  | { kind: 'wait' }; // as much is in flight as the config allows
