import { useEffect, useState } from 'react';
import { listRuns, type RunList } from '../api';

// Every run in the project, refetched whenever `trigger` changes. Like useCardRuns, this needs no
// socket handling of its own: records live in board folders, so a status change already pushes a
// snapshot.
export function useRuns(trigger: unknown): RunList {
  const [state, setState] = useState<RunList>({ runs: [], active: [], queued: [] });
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate trigger
  useEffect(() => {
    let live = true;
    listRuns()
      .then((r) => {
        if (live) setState(r);
      })
      .catch(() => {
        /* keep the last good list; the next trigger retries */
      });
    return () => {
      live = false;
    };
  }, [trigger]);
  return state;
}
