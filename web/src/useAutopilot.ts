import { useCallback, useEffect, useState } from 'react';
import { type AutopilotState, getAutopilotState } from './api';
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
export function useAutopilot(bump: number): {
  state: AutopilotState | null;
  refresh: () => void;
} {
  const [state, setState] = useState<AutopilotState | null>(null);
  const [asked, setAsked] = useState(0);
  const ws = useSharedWs(bump);

  // `bump` is a new project and `asked` is an explicit refresh; neither is read inside the effect, and
  // both must refetch. Same idiom as useCardRuns.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate triggers
  useEffect(() => {
    let live = true;
    getAutopilotState()
      .then((next) => {
        if (live) setState(next);
      })
      .catch(() => {
        /* no project open, or nothing answered; the socket or the next refresh will say */
      });
    return () => {
      live = false;
    };
  }, [bump, asked]);

  useEffect(
    () =>
      ws.subscribe((msg) => {
        if (msg.type === 'autopilot:state') setState(msg.state as AutopilotState);
      }),
    [ws],
  );

  // For the controls: they already receive the new state in their response, but a refresh keeps this
  // hook the single place the answer comes from rather than two paths that can disagree.
  const refresh = useCallback(() => setAsked((n) => n + 1), []);
  return { state, refresh };
}
