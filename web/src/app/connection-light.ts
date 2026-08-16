import type { ConnState } from '../ws';

// What the light in the top bar says. ONE question — "can I use this project right now?" — answered
// from two independent facts: whether this browser is talking to the server, and whether the project
// has what it needs to run anything.
//
// A SEPARATE VOCABULARY FROM ConnState, deliberately. `open` and `closed` are WebSocket words; they
// describe a socket, not a project, and `open` in particular says nothing to anyone who has not read
// the transport layer. The socket keeps its own names because `App.tsx` and `ws.ts` reason about
// sockets — this is the display vocabulary, and the two are allowed to differ.
export const LIGHT_STATES = ['online', 'offline', 'failing', 'connecting', 'closed', 'unauthorized'] as const;
export type LightState = (typeof LIGHT_STATES)[number];

// WHICH kind of refusal the server reported, so the advice can be about the right thing. Structurally
// the same union as `SandboxState.refusalKind` in api/sandbox.ts and deliberately not imported from
// there: this module is the display vocabulary and is tested without the API layer, exactly as
// `LightState` is kept apart from `ConnState` above.
export type RefusalKind = 'docker' | 'credential' | 'attached';

// WHAT ALREADY WENT WRONG, as distinct from what is wrong now. Structurally the same as
// `SandboxState.recentFailure` in api/sandbox.ts and deliberately not imported from there, for the reason
// `RefusalKind` above is not: this module is the display vocabulary and is tested without the API layer.
//
// It is EVIDENCE, not a verdict. `runs` is how many in a row died before reaching a model, `note` is what
// the harness said on the most recent one — the server's words, and they stay the server's — and `at` is
// when that one started. Nothing here refuses anything: the state it produces sits below `offline`
// precisely because "the last thing you ran broke" is a weaker claim than "you cannot run anything".
export interface RecentFailure {
  runs: number;
  note: string;
  at: string;
}

// THE SOCKET WINS. If the connection is down, the page is a snapshot frozen at whenever it dropped —
// including whatever it last knew about the project's dependencies. Reporting `offline` then would be
// stating a fact we cannot currently observe, and reporting `online` would be worse. So a socket
// problem is always what the light shows, and `offline` is reachable only from a healthy connection.
//
// `undefined` for the refusal means NOT ASKED YET, which is not the same as "nothing is missing" — the
// same distinction `useReadiness` makes, and for the same reason. Before the answer arrives the light
// reports what it does know (the socket is up) rather than raising an alarm it cannot yet justify; it
// flips to `offline` when the answer actually says so. Truthful at every moment, at the cost of one
// round trip where a broken project still reads as online. `recentFailure` carries the same semantics:
// absent is either "not asked yet" or "the last runs were healthy", and neither is an alarm.
//
// `failing` SITS BELOW `offline`, and the order is the reading of the two facts. A refusal says you cannot
// run anything at all, which is a fact about now and is enforced; a streak of infrastructure failures says
// the last things you ran broke, which is a fact about the past and refuses nothing. When both are true
// the one that stops you working is the one worth the word. It sits above `online` because `online` was
// the lie: a box holding a sign-in the host had replaced failed two runs in a row, auto-pilot stopped
// itself over it, and this light went on saying everything was fine because nothing was refusing yet.
export function lightFor(
  conn: ConnState,
  agentRefusal: string | null | undefined,
  recentFailure?: RecentFailure | null,
): LightState {
  if (conn === 'unauthorized') return 'unauthorized';
  if (conn === 'closed') return 'closed';
  if (conn === 'connecting') return 'connecting';
  if (agentRefusal) return 'offline';
  return recentFailure ? 'failing' : 'online';
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
  recentFailure?: RecentFailure | null,
): LightAdvice {
  if (light === 'failing') {
    // The harness's own sentence, verbatim — the same rule `offline` follows above and for the same
    // reason. Reworded into "some runs failed" it becomes advice about nothing: a dead credential and a
    // working directory that no longer exists read identically once the specifics are dropped, and they
    // send a person to two different machines.
    const said = recentFailure?.note ?? 'The runs left nothing behind that says why.';
    const runs = recentFailure?.runs ?? 0;
    return {
      // THE HEADING DOES NOT NAME THE FAILURE, because the detail under it already does — every
      // infrastructure note is prefixed "The agent never reached a model:" by `infrastructureNote` on
      // the server. Saying it in both made the balloon read "…failed before reaching a model / The agent
      // never reached a model: …", which is a stutter, and a reader who trips on the first line trusts
      // the rest of it less. The loop's own stop sentence had the same duplication and was fixed the
      // same way round: keep it in the note, which is also shown alone on the Execution row, and drop it
      // from whatever introduces the note.
      heading: runs === 1 ? 'The last run never got started' : 'The last runs never got started',
      detail: said,
      // WHAT THIS DOES NOT SAY IS THE POINT: it does not tell anyone they are blocked, because they are
      // not. Nothing here refuses a dispatch, and a balloon implying otherwise would be describing a gate
      // that does not exist — while auto-pilot really has stopped, on its own, and will not restart until
      // somebody presses the button.
      next: 'Agents can still be started by hand. Auto-pilot stopped itself over this — deal with the cause above, then press Start to run it again.',
    };
  }
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
export function lightTitle(
  light: LightState,
  agentRefusal: string | null | undefined,
  recentFailure?: RecentFailure | null,
): string {
  if (light === 'offline' && agentRefusal) return agentRefusal;
  // Same rule, other evidence: the note is the harness's sentence off the run record the loop itself
  // read, so hovering the light shows what stopped auto-pilot rather than our summary of it.
  if (light === 'failing' && recentFailure) {
    return `${recentFailure.runs} run${recentFailure.runs === 1 ? '' : 's'} in a row failed before reaching a model: ${recentFailure.note}`;
  }
  if (light === 'failing') return 'Recent runs failed before reaching a model.';
  if (light === 'online') return 'Connected to the server, and this project has what it needs to run.';
  if (light === 'unauthorized') return 'This browser is not signed in.';
  if (light === 'closed')
    return 'Not connected — what you see is whatever was true when the connection dropped.';
  return 'Connecting…';
}
