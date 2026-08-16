import { useCallback, useState } from 'react';
import { type CardLedgerData, listCardRuns, type RunRecord } from '../api';
import type { BoardName } from '../shared';
import { useFetched } from '../useFetched';

// Null until the first answer, and kept through a failure: a total that flickers to zero and back
// reads as money having disappeared.
const EMPTY: { runs: RunRecord[]; account: CardLedgerData | null } = { runs: [], account: null };

// Never called — `enabled` is false in the branch that supplies it — but a fetcher is not optional,
// and a rejecting one would look like a failure rather than like a question nobody asked.
const NEVER_ASKED = (): Promise<typeof EMPTY> => new Promise(() => {});

// One card's runs, oldest first, with that card's ledger line — refetched whenever `trigger` changes.
//
// No socket handling of its own: a run record lives in a board folder, which the watcher watches,
// so every status change already pushes a fresh snapshot — passing that snapshot as the trigger is
// what makes this live. A failed fetch keeps the previous list rather than blanking the section.
//
// `refresh` is the same idiom as useSuggestions', and it is here for the one thing the trigger above
// cannot cover honestly: a change THIS browser just made. Clearing a card's attempts rewrites its run
// records, and the number on screen is derived from them — waiting on a watcher event, a snapshot
// rebuild and a socket round-trip to learn the result of a button this tab pressed makes the control
// look broken for as long as that takes, and silently does nothing at all if any link in it is missing.
export function useCardRuns(
  board: BoardName | undefined,
  card: string | undefined,
  trigger: unknown,
): { runs: RunRecord[]; account: CardLedgerData | null; refresh: () => void } {
  const open = board !== undefined && card !== undefined;
  const [asked, setAsked] = useState(0);
  const { value } = useFetched(
    open ? () => listCardRuns(board, card) : NEVER_ASKED,
    [board, card, trigger, asked],
    EMPTY,
    // With no card open there is nothing to ask about — and the runs of the card you just closed
    // must not linger under the next thing you open.
    { enabled: open, onDisabled: 'clear' },
  );
  const refresh = useCallback(() => setAsked((n) => n + 1), []);
  return { ...value, refresh };
}
