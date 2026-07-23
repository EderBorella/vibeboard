import { useEffect, useRef, useState } from 'react';
import type { ProjectSnapshot } from './shared';

export type ConnState = 'connecting' | 'open' | 'closed';

interface WsSnapshotMessage {
  type: 'snapshot';
  snapshot: ProjectSnapshot;
}

// Subscribe to the server's /ws stream: receive a full snapshot on connect and on every
// change (API- or agent-driven). Auto-reconnects. `bump` forces a fresh socket, used after
// opening/switching a project so the next snapshot reflects the newly-open project.
export function useSnapshot(bump: number): { snapshot: ProjectSnapshot | null; conn: ConnState } {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [conn, setConn] = useState<ConnState>('connecting');
  const closedByUs = useRef(false);

  useEffect(() => {
    closedByUs.current = false;
    let socket: WebSocket;
    let retry: ReturnType<typeof setTimeout>;

    const connect = (): void => {
      setConn('connecting');
      socket = new WebSocket(`ws://${location.host}/ws`);
      socket.onopen = () => setConn('open');
      socket.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as WsSnapshotMessage;
        if (msg.type === 'snapshot') setSnapshot(msg.snapshot);
      };
      socket.onclose = () => {
        setConn('closed');
        if (!closedByUs.current) retry = setTimeout(connect, 1000);
      };
    };

    connect();
    return () => {
      closedByUs.current = true;
      clearTimeout(retry);
      socket.close();
    };
  }, [bump]);

  return { snapshot, conn };
}
