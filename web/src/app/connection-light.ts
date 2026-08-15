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

// WHICH kind of refusal the server reported, so the advice can be about the right thing. Structurally
// the same union as `SandboxState.refusalKind` in api/sandbox.ts and deliberately not imported from
// there: this module is the display vocabulary and is tested without the API layer, exactly as
// `LightState` is kept apart from `ConnState` above.
export type RefusalKind = 'docker' | 'credential' | 'attached';

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

// What the balloon says when you click the light: what is wrong, and what you can do about it.
//
// SPLIT INTO THREE FIELDS rather than one paragraph, because they have different authors. `heading` and
// `next` are ours and are about the person; `detail` for `offline` is the SERVER's sentence, verbatim,
// for the same reason the tooltip is. Blending them into one string would make it impossible to tell
// which half is the enforced rule and which is our advice about it.
export interface LightAdvice {
  heading: string;
  detail: string;
  // What to do. Absent when there is nothing to do — `online` needs no instruction, and inventing one
  // would imply the state is a problem.
  next?: string;
}

// A LIE THE HEADING USED TO TELL. `offline` said "Docker is not ready" whatever the cause, from the
// days when a missing daemon or an unbuilt image was the only cause there was. It is not any more: a
// box holding a credential the host has since replaced fails every turn while docker is perfectly
// healthy, and being sent to check the daemon is being sent to the wrong machine entirely. The heading
// is the line a person actually reads and acts on, so it follows the cause the server named.
//
// `detail` does NOT vary — it stays the server's sentence verbatim, for the reason above the interface:
// the two halves have different authors, and the enforced rule is the server's to word.
export function lightAdvice(
  light: LightState,
  agentRefusal: string | null | undefined,
  refusalKind?: RefusalKind | null,
): LightAdvice {
  if (light === 'offline') {
    // The server's own words, whichever cause this is. See lightTitle below.
    const detail = agentRefusal ?? 'This project cannot run agents.';
    // What survives the fault, said once: the board and the reading tools keep working under every one
    // of these, and that is the sentence that stops a person assuming the whole app is down.
    const stillWorks =
      'The board, the Project Log and the Explorer all keep working — it is agents and the copilot that cannot start.';
    if (refusalKind === 'credential') {
      return {
        heading: 'The agent box has a stale sign-in',
        detail,
        // Rebuilt, not restarted: the mount is bound to the file when the container is created, so
        // starting the same box again picks up the same dead one.
        next: `Open Settings and use "Rebuild the agent boxes" — the next turn builds one against the current sign-in. ${stillWorks}`,
      };
    }
    if (refusalKind === 'attached') {
      return {
        heading: 'Agents would run outside the sandbox',
        detail,
        next: `Open Settings and take over with a managed server. ${stillWorks}`,
      };
    }
    return {
      heading: 'Docker is not ready',
      detail,
      next: stillWorks,
    };
  }
  if (light === 'closed') {
    return {
      heading: 'Not connected',
      detail:
        'What you see is whatever was true when the connection dropped. Nothing on this page is updating.',
      next: 'It keeps retrying on its own. If it does not come back, the server has probably stopped.',
    };
  }
  if (light === 'connecting') {
    return {
      heading: 'Reconnecting',
      detail: 'Trying to reach the server. Anything on screen may be a moment out of date.',
    };
  }
  if (light === 'unauthorized') {
    return {
      heading: 'This browser is not signed in',
      detail: 'Without a credential every button here fails, whatever the board appears to show.',
      next: 'Open the board on a browser that is already signed in and approve this one.',
    };
  }
  return {
    heading: 'Everything is running',
    detail: 'Connected to the server, and this project has what it needs to run agents.',
  };
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
