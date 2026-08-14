import { useCallback, useEffect, useState } from 'react';
import { type AutopilotState, getAutopilotState } from './api';
import { useFetched } from './useFetched';
import { useSharedWs } from './ws';

// Auto-pilot's state, as this tab sees it.
//
// Two sources, deliberately: the endpoint answers on mount, and every change arrives over the socket
// the board already uses. Without the socket half, an emergency stop in one tab would leave the others
// showing a working app over a project whose agents are dead — and the overlay that explains the halt
// is the one piece of UI that must never be stale.
//
// Null until the first answer. The overlay renders nothing then, which is the right default: a project
// nobody has heard from yet is not a project to block.
// Often enough that a dispatch shows up while someone is watching, rarely enough to be invisible next to
// the snapshot traffic. A dispatch takes minutes, so this is already far finer than the thing it reports.
const COUNTER_POLL_MS = 4_000;

export function useAutopilot(bump: number): {
  state: AutopilotState | null;
  refresh: () => void;
} {
  const [asked, setAsked] = useState(0);
  const ws = useSharedWs(bump);

  // `bump` is a new project and `asked` is an explicit refresh; neither is read by the fetch, and
  // both must refetch. A failure says nothing: there may be no project open, and the socket or the
  // next refresh will report anything that matters.
  const { value: state, setValue: setState } = useFetched<AutopilotState | null>(
    getAutopilotState,
    [bump, asked],
    null,
  );

  useEffect(
    () =>
      ws.subscribe((msg) => {
        if (msg.type === 'autopilot:state') setState(msg.state as AutopilotState);
      }),
    [ws, setState],
  );

  // POLLED WHILE RUNNING, and only while running. The loop writes `iteration` straight to
  // `autopilot-state.json` — decision 20's carve-out — and `session.ts` deliberately does not watch that
  // file, so no broadcast accompanies it. Without this the panel said "0 dispatches" for an entire run
  // while the ledger beside it, computed server-side from the same file, correctly said seven: two
  // counters of one fact in one panel, one of them frozen.
  //
  // Every other state change still arrives on the socket; this exists for the counter alone, which is why
  // it stops the moment the run does.
  useEffect(() => {
    if (state?.state !== 'running') return;
    const timer = setInterval(() => {
      getAutopilotState()
        .then(setState)
        .catch(() => {
          /* the socket will say if the project has gone; a missed tick is one stale number */
        });
    }, COUNTER_POLL_MS);
    return () => clearInterval(timer);
    // `setState` is the setter from `useFetched`, and a useState setter's identity is stable — it is
    // in the list to satisfy the exhaustive-dependency check, not because it can change.
  }, [state?.state, setState]);

  // For the controls: they already receive the new state in their response, but a refresh keeps this
  // hook the single place the answer comes from rather than two paths that can disagree.
  const refresh = useCallback(() => setAsked((n) => n + 1), []);
  return { state, refresh };
}
