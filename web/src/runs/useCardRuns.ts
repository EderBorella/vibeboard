import { useEffect, useState } from 'react';
import { type CardAccount, listCardRuns, type RunRecord } from '../api';
import type { BoardName } from '../shared';

// One card's runs, oldest first, with that card's ledger line — refetched whenever `trigger` changes.
//
// No socket handling of its own: a run record lives in a board folder, which the watcher watches,
// so every status change already pushes a fresh snapshot — passing that snapshot as the trigger is
// what makes this live. A failed fetch keeps the previous list rather than blanking the section.
export function useCardRuns(
  board: BoardName | undefined,
  card: string | undefined,
  trigger: unknown,
): { runs: RunRecord[]; account: CardAccount | null } {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  // Null until the first answer, and kept through a failure: a total that flickers to zero and back
  // reads as money having disappeared.
  const [account, setAccount] = useState<CardAccount | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate trigger
  useEffect(() => {
    if (!board || !card) {
      setRuns([]);
      setAccount(null);
      return;
    }
    let live = true;
    listCardRuns(board, card)
      .then((body) => {
        if (!live) return;
        setRuns(body.runs);
        setAccount(body.account);
      })
      .catch(() => {
        /* keep what we had; the next trigger retries */
      });
    return () => {
      live = false;
    };
  }, [board, card, trigger]);
  return { runs, account };
}
