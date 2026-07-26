import { useEffect, useState } from 'react';
import { listCardRuns, type RunRecord } from '../api';
import type { BoardName } from '../shared';

// One card's runs, oldest first, refetched whenever `trigger` changes.
//
// No socket handling of its own: a run record lives in a board folder, which the watcher watches,
// so every status change already pushes a fresh snapshot — passing that snapshot as the trigger is
// what makes this live. A failed fetch keeps the previous list rather than blanking the section.
export function useCardRuns(
  board: BoardName | undefined,
  card: string | undefined,
  trigger: unknown,
): RunRecord[] {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate trigger
  useEffect(() => {
    if (!board || !card) {
      setRuns([]);
      return;
    }
    let live = true;
    listCardRuns(board, card)
      .then((list) => {
        if (live) setRuns(list);
      })
      .catch(() => {
        /* keep what we had; the next trigger retries */
      });
    return () => {
      live = false;
    };
  }, [board, card, trigger]);
  return runs;
}
