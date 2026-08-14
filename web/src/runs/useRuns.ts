import { listRuns, type RunList } from '../api';
import { useFetched } from '../useFetched';

const EMPTY: RunList = { runs: [], active: [], queued: [] };

// Every run in the project, refetched whenever `trigger` changes. Like useCardRuns, this needs no
// socket handling of its own: records live in board folders, so a status change already pushes a
// snapshot. A failed fetch keeps the last good list; the next trigger retries.
// `enabled` is the credential — see the note in useAutopilot. React runs every hook on mount, before the
// render chooses the sign-in screen over the board, so without it this asked for the run list with no
// cookie and took a 401 on every first load.
export function useRuns(trigger: unknown, enabled = true): RunList {
  return useFetched(listRuns, [trigger], EMPTY, { enabled }).value;
}
