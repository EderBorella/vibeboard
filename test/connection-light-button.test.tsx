// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionLight } from '../web/src/organisms/topbar/ConnectionLight.js';
import { LIGHT_STATES } from '../web/src/organisms/topbar/connection-light.js';

afterEach(cleanup);

const REFUSAL =
  'Agents are disabled: the agent image vibeboard-agent:latest is not built — run `npm run box:build`. VibeBoard runs every agent inside a container, and there is none available here.';

const light = (over: Partial<Parameters<typeof ConnectionLight>[0]> = {}) => (
  <ConnectionLight light="offline" title="tip" agentRefusal={REFUSAL} {...over} />
);

describe('the light is a button', () => {
  it('says nothing until it is clicked', () => {
    render(light());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on click and reports that it is open', () => {
    render(light());
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });

  it('closes on a second click, so the same control both opens and closes it', () => {
    render(light());
    const button = screen.getByRole('button');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape', () => {
    render(light());
    fireEvent.click(screen.getByRole('button'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on a click elsewhere', () => {
    render(light());
    fireEvent.click(screen.getByRole('button'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // A click that lands INSIDE must not dismiss it — the sentence in there is the one thing a person
  // will want to select and copy, and a balloon that vanishes mid-drag cannot be copied out of.
  it('stays open when the click is inside it', () => {
    render(light());
    fireEvent.click(screen.getByRole('button'));
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  // The whole reason this stopped being a tooltip: `title` truncates, needs a hover, and cannot be
  // reached at all on a touch device. The refusal is the longest text the light can carry.
  it('shows the server’s refusal IN FULL, which is what the tooltip could not', () => {
    render(light());
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog').textContent).toContain(REFUSAL);
  });

  it('keeps the tooltip as well, for the people who do hover', () => {
    render(light());
    expect(screen.getByRole('button').getAttribute('title')).toBe('tip');
  });

  // No state may open an empty balloon, and `online` in particular must not invent a problem: it gets a
  // heading and a detail but no "what to do", because there is nothing to do.
  it.each(LIGHT_STATES)('has something to say in the "%s" state', (state) => {
    render(light({ light: state, agentRefusal: state === 'offline' ? REFUSAL : null }));
    fireEvent.click(screen.getByRole('button'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('.vb-status-head')?.textContent?.length).toBeGreaterThan(0);
    expect(dialog.querySelector('.vb-status-detail')?.textContent?.length).toBeGreaterThan(0);
    cleanup();
  });

  it('offers no instruction when everything is fine', () => {
    render(light({ light: 'online', agentRefusal: null }));
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog').querySelector('.vb-status-next')).toBeNull();
  });

  // THE CAUSE HAS TO REACH THE BALLOON. The component renders whatever `lightAdvice` returns, so a
  // `refusalKind` prop that was accepted and then not passed on would leave every offline balloon
  // saying "Docker is not ready" with every unit test of `lightAdvice` still green.
  //
  // Both halves are asserted on the SAME refusal sentence with only the kind changed — a fixture that
  // varied the sentence too would pass against a component that read the sentence instead of the kind.
  it('titles the credential fault as a credential fault, not as Docker', () => {
    render(light({ refusalKind: 'credential' }));
    fireEvent.click(screen.getByRole('button'));
    const head = screen.getByRole('dialog').querySelector('.vb-status-head')?.textContent ?? '';
    expect(head.toLowerCase()).not.toContain('docker');
    expect(screen.getByRole('dialog').textContent).toContain('Rebuild the agent boxes');
  });

  it('still titles a Docker fault as Docker, on that same sentence', () => {
    render(light({ refusalKind: 'docker' }));
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog').querySelector('.vb-status-head')?.textContent).toBe(
      'Docker is not ready',
    );
  });

  // THE RECORD HAS TO REACH THE BALLOON, the same hop `refusalKind` needed a test for. The component
  // renders whatever `lightAdvice` returns, so a `recentFailure` prop that was accepted and then not
  // passed on would leave every failing balloon saying nothing about what actually broke, with every unit
  // test of `lightAdvice` still green.
  it('shows the harness’s note when the light is failing', () => {
    const note = 'Failed to authenticate: OAuth session expired.';
    render(
      light({
        light: 'failing',
        agentRefusal: null,
        recentFailure: { runs: 2, note, at: '2026-08-16T10:05:00.000Z' },
      }),
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog').querySelector('.vb-status-detail')?.textContent).toBe(note);
  });

  // A FIXTURE THAT CANNOT TELL THE TWO APART TESTS NEITHER. `failing` and `offline` are the two states
  // that are not about the socket, and they mean opposite things about whether you can work — so they are
  // rendered here from the same component with only the state and its evidence changed, and must not read
  // alike. A component that fell through to one advice for both would pass everything above.
  it('says something different for a past failure than for a live refusal', () => {
    render(
      light({
        light: 'failing',
        agentRefusal: null,
        recentFailure: { runs: 2, note: 'OAuth session expired.', at: '2026-08-16T10:05:00.000Z' },
      }),
    );
    fireEvent.click(screen.getByRole('button'));
    const failing = screen.getByRole('dialog').textContent;
    cleanup();
    render(light({ light: 'offline', agentRefusal: REFUSAL, refusalKind: 'credential' }));
    fireEvent.click(screen.getByRole('button'));
    const offline = screen.getByRole('dialog').textContent;
    expect(failing).not.toBe(offline);
    // And specifically: only one of them tells you to go and rebuild the boxes, because only one of them
    // is a refusal. The other says agents can still be started.
    expect(offline).toContain('Rebuild the agent boxes');
    expect(failing).not.toContain('Rebuild the agent boxes');
  });

  // Each state's balloon has to be about THAT state. One `lightAdvice` returning the same heading for
  // everything would pass every test above.
  it('says something different for a dead socket than for a missing dependency', () => {
    render(light({ light: 'closed', agentRefusal: null }));
    fireEvent.click(screen.getByRole('button'));
    const closed = screen.getByRole('dialog').textContent;
    cleanup();
    render(light({ light: 'offline', agentRefusal: REFUSAL }));
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog').textContent).not.toBe(closed);
  });
});
