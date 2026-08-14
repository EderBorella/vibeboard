import { listRuns, type RunList } from '../api';
import { useFetched } from '../useFetched';

const EMPTY: RunList = { runs: [], active: [], queued: [] };

// Every run in the project, refetched whenever `trigger` changes. Like useCardRuns, this needs no
// socket handling of its own: records live in board folders, so a status change already pushes a
// snapshot. A failed fetch keeps the last good list; the next trigger retries.
export function useRuns(trigger: unknown): RunList {
  return useFetched(listRuns, [trigger], EMPTY).value;
}
