import { type Accounting, getAccounting } from '../../lib/api';
import { useFetched } from '../../lib/useFetched';

// What the project has spent, refetched whenever `trigger` changes.
//
// The arithmetic lives on the server (src/core/accounting.ts) and is read here rather than repeated:
// the same numbers decide whether auto-pilot may dispatch, and two copies of "what has this cost"
// would eventually disagree — with the copy that enforces the budget being the one that must be right.
//
// Null until the first answer, and kept through a failure: a total that flickers to nothing and back
// reads as money having disappeared.
export function useAccounting(trigger: unknown): Accounting | null {
  return useFetched<Accounting | null>(getAccounting, [trigger], null).value;
}
