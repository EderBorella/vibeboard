import type { ConnState } from '../ws';

// What the light in the top bar says. ONE question — "can I use this project right now?" — answered
// from two independent facts: whether this browser is talking to the server, and whether the project
// has what it needs to run anything.
//
// A SEPARATE VOCABULARY FROM ConnState, deliberately. `open` and `closed` are WebSocket words; they
// describe a socket, not a project, and `open` in particular says nothing to anyone who has not read
// the transport layer. The socket keeps its own names because `App.tsx` and `ws.ts` reason about
// sockets — this is the display vocabulary, and the two are allowed to differ.
export const LIGHT_STATES = ['online', 'offline', 'connecting', 'closed', 'unauthorized'] as const;
export type LightState = (typeof LIGHT_STATES)[number];

// THE SOCKET WINS. If the connection is down, the page is a snapshot frozen at whenever it dropped —
// including whatever it last knew about the project's dependencies. Reporting `offline` then would be
// stating a fact we cannot currently observe, and reporting `online` would be worse. So a socket
// problem is always what the light shows, and `offline` is reachable only from a healthy connection.
//
// `undefined` for the refusal means NOT ASKED YET, which is not the same as "nothing is missing" — the
// same distinction `useReadiness` makes, and for the same reason. Before the answer arrives the light
// reports what it does know (the socket is up) rather than raising an alarm it cannot yet justify; it
// flips to `offline` when the answer actually says so. Truthful at every moment, at the cost of one
// round trip where a broken project still reads as online.
export function lightFor(conn: ConnState, agentRefusal: string | null | undefined): LightState {
  if (conn === 'unauthorized') return 'unauthorized';
  if (conn === 'closed') return 'closed';
  if (conn === 'connecting') return 'connecting';
  return agentRefusal ? 'offline' : 'online';
}

// The tooltip. For `offline` it is the server's OWN sentence — `agentRefusal`, computed by the same
// function the dispatch gate calls (src/server/boxes/sandbox.ts), so the light cannot describe a rule
// the gate does not apply. Re-wording it here would be a second opinion about whether agents can run,
// and this codebase has already had two of those diverge.
export function lightTitle(light: LightState, agentRefusal: string | null | undefined): string {
  if (light === 'offline' && agentRefusal) return agentRefusal;
  if (light === 'online') return 'Connected to the server, and this project has what it needs to run.';
  if (light === 'unauthorized') return 'This browser is not signed in.';
  if (light === 'closed')
    return 'Not connected — what you see is whatever was true when the connection dropped.';
  return 'Connecting…';
}
