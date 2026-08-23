import { describe, expect, it } from 'vitest';
import { lightProps } from '../web/src/templates/shell.js';

// THE HOP THAT COULD NOT BE TESTED, and was measured to be untestable rather than assumed so.
//
// `App.tsx` used to reach into the sandbox state four times to feed the light. Nothing in the repo
// mounts `App` — no test file imports it — so all four reaches were unverified: deleting the one that
// passes `recentFailure` into `lightFor` left the light unable to ever report a failure in the real
// product, with all 114 tests of that feature still green. That is the whole reason this function
// exists, and these are its tests.
//
// The call site spreads the result into `<TopBar>`, so a dropped key is now a type error rather than a
// light that quietly never changes colour. What is left for a test is the derivation itself.

const FAILED = { runs: 2, note: 'The agent never reached a model: expired', at: '2026-08-16T12:32:50Z' };

describe('the light props the top bar is given', () => {
  it('reports online when the socket is up and nothing is wrong', () => {
    const p = lightProps('open', { agentRefusal: null });
    expect(p.light).toBe('online');
    expect(p.recentFailure).toBeUndefined();
  });

  // THE BUG THE USER REPORTED: auto-pilot stopped on two infrastructure failures and the light went on
  // saying "online" as if everything were fine.
  it('reports failing when the last runs died before reaching a model', () => {
    const p = lightProps('open', { agentRefusal: null, recentFailure: FAILED });
    expect(p.light).toBe('failing');
    // Carried through as well as consulted — the balloon shows the harness's own words.
    expect(p.recentFailure).toEqual(FAILED);
  });

  // A refusal outranks a past failure: "you cannot run anything" beats "the last thing you ran broke".
  it('reports the refusal, not the failure, when both are true', () => {
    const p = lightProps('open', {
      agentRefusal: 'Agents are disabled: the sign-in has expired.',
      refusalKind: 'credential',
      recentFailure: FAILED,
    });
    expect(p.light).toBe('offline');
    expect(p.refusalKind).toBe('credential');
    // Still handed down, because the balloon may show both.
    expect(p.recentFailure).toEqual(FAILED);
  });

  // The socket wins over everything: with no connection the page is a snapshot, and reporting anything
  // about the project would be stating a fact we cannot currently observe.
  it.each(['closed', 'connecting', 'unauthorized'] as const)('lets the socket state %s win', (conn) => {
    expect(lightProps(conn, { agentRefusal: 'x', recentFailure: FAILED }).light).toBe(
      conn === 'closed' ? 'closed' : conn,
    );
  });

  // NOT ASKED YET is not "nothing is wrong". Before the first answer the light reports what it does
  // know — the socket is up — rather than raising an alarm it cannot justify.
  it('reports online, not failing, before the sandbox has answered', () => {
    expect(lightProps('open', undefined).light).toBe('online');
    expect(lightProps('open', null).light).toBe('online');
  });

  // The tooltip is derived from the same three facts, so it cannot describe a state the light is not in.
  it('titles the light consistently with the state it chose', () => {
    expect(lightProps('open', { agentRefusal: null, recentFailure: FAILED }).lightTitle).not.toBe(
      lightProps('open', { agentRefusal: null }).lightTitle,
    );
  });
});
