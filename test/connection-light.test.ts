import { describe, expect, it } from 'vitest';
import {
  LIGHT_STATES,
  lightAdvice,
  lightFor,
  lightTitle,
  type RecentFailure,
} from '../web/src/organisms/topbar/connection-light.js';
import type { ConnState } from '../web/src/lib/ws.js';

const REFUSAL = 'Agents are disabled: the agent image vibeboard-agent:latest is not built.';
const NOTE = 'Failed to authenticate: OAuth session expired.';
const FAILING: RecentFailure = { runs: 2, note: NOTE, at: '2026-08-16T10:05:00.000Z' };

describe('what the light says', () => {
  it('is online only when the socket is up AND nothing is missing', () => {
    expect(lightFor('open', null)).toBe('online');
    expect(lightFor('open', REFUSAL)).toBe('offline');
  });

  // THE RULE THIS MODULE EXISTS FOR. A dead socket means the page is a snapshot frozen at whenever it
  // dropped — including whatever it last knew about dependencies — so `offline` from that position would
  // be stating something we cannot currently observe. Every socket problem beats a dependency problem,
  // and a table over all three proves it for each rather than for a favourite one.
  it.each(['closed', 'connecting', 'unauthorized'] as ConnState[])(
    'reports the socket problem "%s" even when dependencies are ALSO missing',
    (conn) => {
      expect(lightFor(conn, REFUSAL)).toBe(conn);
      expect(lightFor(conn, null)).toBe(conn);
    },
  );

  // Not asked yet is not the same as nothing is missing, and it is not the same as something IS missing
  // either. Before the answer arrives the light reports what it does know; raising `offline` on a
  // `undefined` would put an alarm on screen for the length of a round trip on every single page load.
  it('does not claim offline before the answer has arrived', () => {
    expect(lightFor('open', undefined)).toBe('online');
  });

  // An empty string is a refusal that says nothing, and `''` is falsy — so a server that answered with
  // one would silently read as "fine". Pinned because the field is typed `string | null` and the null is
  // the only documented "no refusal".
  it('treats an empty refusal as no refusal, which is what falsy means here', () => {
    expect(lightFor('open', '')).toBe('online');
  });

  it('only ever answers with a state the stylesheet and the label know about', () => {
    const answers = new Set(
      (['open', 'closed', 'connecting', 'unauthorized'] as ConnState[]).flatMap((c) => [
        lightFor(c, null),
        lightFor(c, REFUSAL),
        lightFor(c, null, FAILING),
        lightFor(c, REFUSAL, FAILING),
      ]),
    );
    for (const a of answers) expect(LIGHT_STATES).toContain(a);
  });
});

// THE LIE THIS STATE EXISTS TO STOP TELLING. Auto-pilot stopped itself on two runs that never reached a
// model — a box holding a sign-in the host had replaced — and this light said `online` all morning,
// because every fact it had answers "may an agent start" and the answer to that was still yes.
describe('what the light says about runs that already failed', () => {
  it('is failing when the last runs died and nothing is refusing', () => {
    expect(lightFor('open', null, FAILING)).toBe('failing');
  });

  it('is still online when the last runs were healthy', () => {
    expect(lightFor('open', null)).toBe('online');
    expect(lightFor('open', null, null)).toBe('online');
  });

  // A REFUSAL OUTRANKS A PAST FAILURE, because "you cannot run anything" is a harder fact than "the last
  // thing you ran broke". Asserted with BOTH present — a version that checked the failure first would
  // pass every test above and send a person whose docker is down to read a run note instead.
  it('reports the refusal, not the failure, when both are true', () => {
    expect(lightFor('open', REFUSAL, FAILING)).toBe('offline');
  });

  // Same rule as `offline` and for the same reason: with the socket down the page is a snapshot, and the
  // run history in it is as frozen as everything else. The table covers all three so this is proved for
  // each rather than for a favourite one.
  it.each(['closed', 'connecting', 'unauthorized'] as ConnState[])(
    'reports the socket problem "%s" over a recent failure',
    (conn) => {
      expect(lightFor(conn, null, FAILING)).toBe(conn);
      expect(lightFor(conn, REFUSAL, FAILING)).toBe(conn);
    },
  );

  // VERBATIM, the same rule the refusal follows. Asserted as the WHOLE detail string rather than with
  // `toContain`, which would pass against a version that wrapped the harness's sentence in one of ours —
  // and the wrapping is exactly the failure mode, since a reworded note sends a person to the wrong
  // machine: a dead credential and a working directory that no longer exists read identically once the
  // specifics are dropped.
  it('carries the harness’s note as the detail, unchanged', () => {
    expect(lightAdvice('failing', null, null, FAILING).detail).toBe(NOTE);
  });

  // The heading says the runs never STARTED, which is what makes it not the card's fault — and it
  // deliberately does not repeat the note's own "The agent never reached a model:" prefix, which used to
  // make the balloon stutter across its two lines.
  it('says the runs never got started, without repeating the note under it', () => {
    const advice = lightAdvice('failing', null, null, FAILING);
    expect(advice.heading.toLowerCase()).toContain('never got started');
    expect(advice.heading.toLowerCase()).not.toContain('reach');
  });

  it('counts one failure as one, rather than announcing runs that did not happen', () => {
    const one = lightAdvice('failing', null, null, { ...FAILING, runs: 1 });
    expect(one.heading).toContain('The last run ');
  });

  // THE OTHER HALF OF NOT BEING A GATE. Nothing on this path refuses a dispatch, so a balloon telling
  // someone they are blocked would be describing a gate that does not exist — while auto-pilot really has
  // stopped on its own and will not restart until somebody presses the button. Both halves, because
  // either one alone leaves the person with the wrong model of what happened.
  it('says agents still run by hand, and that auto-pilot stopped itself', () => {
    const next = lightAdvice('failing', null, null, FAILING).next ?? '';
    expect(next).toContain('still be started');
    expect(next).toContain('Auto-pilot stopped itself');
    expect(next).toContain('Start');
  });

  // `lightAdvice` is pure and anyone may call it, so the state has to survive arriving with no record —
  // exactly as `offline` survives arriving with no refusal.
  it('still says something when failing arrives with no record attached', () => {
    expect(lightAdvice('failing', null).detail.length).toBeGreaterThan(0);
    expect(lightAdvice('failing', null).heading.length).toBeGreaterThan(0);
  });

  it('quotes the note in the tooltip too, beside the count', () => {
    const title = lightTitle('failing', null, FAILING);
    expect(title).toContain(NOTE);
    expect(title).toContain('2 runs in a row');
  });
});

describe('what the balloon says', () => {
  // FIVE DISTINCT HEADINGS, asserted as a set. The weaker version of this test compared the whole
  // rendered text of two states and passed while a mutant gave every state the heading "Not connected" —
  // because the details still differed underneath. The heading is the line a person actually reads, and
  // a wrong one sends them to fix the wrong thing.
  it('gives every state its own heading', () => {
    const headings = LIGHT_STATES.map((s) => lightAdvice(s, REFUSAL).heading);
    expect(new Set(headings).size).toBe(LIGHT_STATES.length);
  });

  it('names Docker in the offline heading, since that is the thing to go and fix', () => {
    expect(lightAdvice('offline', REFUSAL, 'docker').heading.toLowerCase()).toContain('docker');
  });

  // THE DEFECT THIS PAIR EXISTS FOR. The offline heading was the constant 'Docker is not ready', from
  // the days when a missing daemon was the only way to be offline. A box pinned to a credential the
  // host has since replaced fails every turn with docker in perfect health — measured: three attempts
  // burned in 58ms each, auto-pilot then blaming the CARD — and sending that person to check their
  // daemon sends them to the wrong machine.
  //
  // A FIXTURE THAT CANNOT TELL THE TWO APART TESTS NEITHER, so this asserts on the SAME sentence with
  // only the kind changed. A version keying off words in the refusal would pass a test that varied both.
  it('does not blame Docker when the cause is the credential', () => {
    const advice = lightAdvice('offline', REFUSAL, 'credential');
    expect(advice.heading.toLowerCase()).not.toContain('docker');
    expect(advice.heading.toLowerCase()).toContain('sign-in');
  });

  it('still blames Docker when the cause IS Docker, on that same sentence', () => {
    expect(lightAdvice('offline', REFUSAL, 'docker').heading).toBe('Docker is not ready');
  });

  // The heading changes and the detail does not: the sentence is the server's, and the two halves of
  // this balloon have different authors on purpose.
  it('keeps the server’s sentence whichever cause it is about', () => {
    for (const kind of ['docker', 'credential', 'attached'] as const) {
      expect(lightAdvice('offline', REFUSAL, kind).detail, kind).toBe(REFUSAL);
    }
  });

  // Every cause must say what to do, and none of them may say the same thing — an advice line that is
  // right for a missing daemon is useless to someone whose box needs rebuilding.
  it('sends the person somewhere different for each cause', () => {
    const next = (['docker', 'credential', 'attached'] as const).map(
      (k) => lightAdvice('offline', REFUSAL, k).next,
    );
    expect(next.every((n) => Boolean(n))).toBe(true);
    expect(new Set(next).size).toBe(3);
  });

  it('points the credential case at the Settings button that fixes it', () => {
    expect(lightAdvice('offline', REFUSAL, 'credential').next).toContain('Rebuild the agent boxes');
  });

  // The answer that has not arrived yet, and the one the server did not label. Neither may produce an
  // empty balloon, and both fall back to the cause that was the only one for most of this file's life.
  it('falls back to the Docker heading when no kind was reported', () => {
    expect(lightAdvice('offline', REFUSAL).heading).toBe('Docker is not ready');
    expect(lightAdvice('offline', REFUSAL, null).heading).toBe('Docker is not ready');
  });

  // Same rule as the tooltip: the refusal is the server's, verbatim, and the balloon is where it is
  // shown IN FULL rather than truncated into a title attribute.
  it('carries the server’s refusal as the offline detail, unchanged', () => {
    expect(lightAdvice('offline', REFUSAL).detail).toBe(REFUSAL);
  });

  // A missing refusal must still produce a usable balloon rather than an empty one — the light can only
  // reach `offline` with a refusal in hand, but `lightAdvice` is a pure function anyone may call.
  it('still says something when offline arrives with no sentence attached', () => {
    const advice = lightAdvice('offline', null);
    expect(advice.detail.length).toBeGreaterThan(0);
  });

  it('offers no instruction for online, because there is nothing to do', () => {
    expect(lightAdvice('online', null).next).toBeUndefined();
  });

  it('offers one for every state that IS a problem', () => {
    for (const state of ['offline', 'failing', 'closed', 'unauthorized'] as const) {
      expect(lightAdvice(state, REFUSAL).next, state).toBeTruthy();
    }
  });
});

describe('what the light says when you hover it', () => {
  // VERBATIM, not reworded. `agentRefusal` is computed on the server by the same function the dispatch
  // gate calls, precisely so the UI cannot describe a rule the gate does not apply — two such functions
  // diverged here once already. Rewriting the sentence in the client would recreate that.
  it('uses the server’s own sentence for offline, unchanged', () => {
    expect(lightTitle('offline', REFUSAL)).toBe(REFUSAL);
  });

  it('never renders an empty tooltip, whatever the state', () => {
    for (const state of LIGHT_STATES) {
      expect(lightTitle(state, null).length).toBeGreaterThan(0);
      expect(lightTitle(state, REFUSAL).length).toBeGreaterThan(0);
    }
  });
});

// A BACKEND THAT IS NOT ANSWERING is the third refusal, and it needed its own advice or it would have fallen
// through to "Docker is not ready" — which is both wrong and unactionable when docker is fine.
//
// It exists because the two older checks say the machine COULD run an agent, not that the thing it talks to is
// alive. On 2026-08-16 an OpenCode server was destroyed under a live URL, every dispatch died in 449ms, and
// this light stayed green because nothing was refusing and nothing had asked.
describe('the balloon for a backend that is not answering', () => {
  const refusal =
    'the OpenCode server for this project is not answering — restart it in Settings › Sandbox, or switch backend';

  it('names the backend rather than Docker, and carries the server’s own sentence', () => {
    const advice = lightAdvice('offline', refusal, 'backend');

    expect(advice.heading).toMatch(/not answering/i);
    // The heading must not blame docker: docker is up, and sending someone to rebuild an image they have
    // is the same class of wrong answer as telling them their README is too thin.
    expect(advice.heading).not.toMatch(/docker/i);
    expect(advice.detail).toBe(refusal);
  });

  it('says what still works, like every other offline branch', () => {
    // The sentence that stops a person assuming the whole app is down — the reading surfaces are unaffected.
    expect(lightAdvice('offline', refusal, 'backend').next).toMatch(/board/i);
  });
});
