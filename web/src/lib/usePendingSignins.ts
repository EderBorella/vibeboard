import { useEffect, useState } from 'react';
import type { SigninPending } from './api';
import { useSharedWs } from './ws';

// The browsers waiting to be let in, pushed over the socket this browser already holds.
//
// Pushed rather than polled, and over the EXISTING socket rather than a new one: the prompt has to
// appear on a screen someone is looking at, and polling for something that happens twice a year would
// be a request a second forever. The server sends the list on connect as well as on change, so a tab
// opened after the request was made still shows the prompt — otherwise the only person who could
// allow it is whoever happened to be watching at that moment.
export function usePendingSignins(bump: number): SigninPending[] {
  const [pending, setPending] = useState<SigninPending[]>([]);
  const ws = useSharedWs(bump);

  useEffect(
    () =>
      ws.subscribe((msg) => {
        if (msg.type === 'signin:pending') setPending(msg.pending as SigninPending[]);
      }),
    [ws],
  );

  return pending;
}
