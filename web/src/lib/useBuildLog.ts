import { useCallback, useEffect, useState } from 'react';
import { useSharedWs } from './ws';

// THE AGENT IMAGE BUILD, LINE BY LINE, over the socket this browser already holds.
//
// Pushed rather than polled, and over the EXISTING socket for the same reason `usePendingSignins` is:
// the request that starts the build does not return for minutes, so its own response cannot carry the
// progress — and a control that shows nothing for minutes is indistinguishable from one that has hung.
// That is the argument the copilot's thinking indicator is built on, and it applies harder here because
// this genuinely takes that long.
//
// ONLY THE LAST FEW LINES ARE KEPT. A docker build prints hundreds and the panel shows one at a time;
// holding the whole transcript in a settings modal would be a growing array nobody reads.
const KEEP = 40;

export interface BuildLog {
  lines: string[];
  running: boolean;
  // Cleared by the caller before it starts a build, so a second attempt does not read as a continuation
  // of the first.
  reset: () => void;
}

export function useBuildLog(bump: number): BuildLog {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const ws = useSharedWs(bump);

  useEffect(
    () =>
      ws.subscribe((msg) => {
        if (msg.type !== 'box:build') return;
        const state = msg.state as string | undefined;
        if (state === 'start') setRunning(true);
        if (state === 'done' || state === 'failed') setRunning(false);
        const line = msg.line as string | undefined;
        if (line) setLines((all) => [...all, line].slice(-KEEP));
      }),
    [ws],
  );

  const reset = useCallback(() => {
    setLines([]);
    setRunning(false);
  }, []);

  return { lines, running, reset };
}
