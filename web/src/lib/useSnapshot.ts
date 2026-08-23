import { useEffect, useState } from 'react';
import type { ProjectSnapshot } from './shared';
import { type ConnState, useSharedWs } from './ws';

export type { ConnState };

// Subscribe to the server's /ws stream: receive a full snapshot on connect and on every
// change (API- or agent-driven). The socket itself lives in ./ws — one per tab, shared with
// the copilot, and reconnecting. `bump` forces a fresh socket, used after opening/switching a
// project so the next snapshot reflects the newly-open project.
export function useSnapshot(bump: number): { snapshot: ProjectSnapshot | null; conn: ConnState } {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [conn, setConn] = useState<ConnState>('connecting');
  const ws = useSharedWs(bump);

  useEffect(
    () =>
      ws.subscribe((msg) => {
        if (msg.type === 'snapshot') setSnapshot(msg.snapshot as ProjectSnapshot);
      }),
    [ws],
  );

  useEffect(() => ws.onConn(setConn), [ws]);

  return { snapshot, conn };
}
