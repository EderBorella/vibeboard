import { describe, expect, it } from 'vitest';
import { LIGHT_STATES, lightAdvice, lightFor, lightTitle } from '../web/src/app/connection-light.js';
import type { ConnState } from '../web/src/ws.js';

const REFUSAL = 'Agents are disabled: the agent image vibeboard-agent:latest is not built.';

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
      ]),
    );
    for (const a of answers) expect(LIGHT_STATES).toContain(a);
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
    expect(lightAdvice('offline', REFUSAL).heading.toLowerCase()).toContain('docker');
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
    for (const state of ['offline', 'closed', 'unauthorized'] as const) {
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
