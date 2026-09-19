// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignIn } from '../web/src/pages/signin/SignIn.js';
import { chooseContent, emptyMessage, rebindOnSignIn } from '../web/src/templates/shell.js';

afterEach(cleanup);

// THE SCREEN THAT SAYS WHY. What it replaces: a browser with no credential was shown the project
// gate, every button on it failed, and the only clue was one red "unauthorized" — which sent the user
// looking for a token they had no way to know existed, obtain or replace.

describe('the common case', () => {
  it('shows nothing to do while it signs itself in', () => {
    render(<SignIn phase={{ phase: 'claiming' }} onRetry={() => {}} />);

    expect(screen.getByText(/signing this browser in/i)).toBeTruthy();
    // No button, no field, no code to copy. The first visit ever sees this for milliseconds.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('waiting for another device to allow it', () => {
  const waiting = { phase: 'waiting', label: 'Safari on the phone', address: '192.168.0.31' } as const;

  it('opens by saying what to do, and where', () => {
    render(<SignIn phase={waiting} onRetry={() => {}} />);

    expect(screen.getByText(/go to that device/i)).toBeTruthy();
    expect(screen.getByText(/Allow/)).toBeTruthy();
  });

  it('shows the address, so the user can tell their own request apart', () => {
    render(<SignIn phase={waiting} onRetry={() => {}} />);
    expect(screen.getByText('192.168.0.31')).toBeTruthy();
  });

  // THE COMPLAINT THIS FIXES, kept as a test because it is a class of writing and not one sentence.
  // The screen used to say "Nothing to type, and nothing to copy" — an absence, about a mechanism the
  // reader has never heard of, which only raises the question of what they were supposed to copy. It
  // also repeated the raw User-Agent, which means nothing at this end; the approving end is what has
  // to recognise the device.
  it('describes no absences, and does not repeat the User-Agent', () => {
    render(<SignIn phase={waiting} onRetry={() => {}} />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/nothing to (type|copy)/i);
    expect(text).not.toContain('Safari on the phone');
  });

  it('still asks for nothing, and says the page carries on by itself', () => {
    render(<SignIn phase={waiting} onRetry={() => {}} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/continues on its own/i)).toBeTruthy();
  });
});

describe('rebinding when sign-in completes', () => {
  // Nothing else retries those fetches or reopens that socket, so getting this wrong leaves a browser
  // that signed itself in sitting on an empty board saying "Connecting…" until a manual reload.
  it('rebinds on the transition into signed-in, and at no other time', () => {
    expect(rebindOnSignIn(true, false)).toBe(true);
    // Already signed in on first render — rebinding would discard the socket just opened.
    expect(rebindOnSignIn(true, true)).toBe(false);
    // Signing out is the sign-in screen's business, not a reason to re-fetch a board.
    expect(rebindOnSignIn(false, true)).toBe(false);
    expect(rebindOnSignIn(false, false)).toBe(false);
  });
});

describe('when it stopped', () => {
  it('states the reason it was given, verbatim', () => {
    const reason = '2 agents are running on this project, so signing in a new browser is closed.';
    render(<SignIn phase={{ phase: 'stopped', reason, retry: true }} onRetry={() => {}} />);
    expect(screen.getByText(reason)).toBeTruthy();
  });

  it('offers Try again where trying again could work, and paints it as the action', () => {
    const onRetry = vi.fn();
    render(<SignIn phase={{ phase: 'stopped', reason: 'busy', retry: true }} onRetry={onRetry} />);

    const again = screen.getByRole('button', { name: /try again/i });
    // The only thing on a first-contact screen a person can do, so it reads as one. It used to be
    // painted filled by `.gate button`, a surface writing the primary variant over every button in the
    // frame; that rule is gone, and the atom is what says this now.
    expect(again.className).toContain('vb-btn-primary');

    fireEvent.click(again);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // A refusal is a decision somebody made. Offering a retry beside it invites arguing with them, and
  // the server would rate-limit the argument anyway.
  it('offers nothing after a refusal', () => {
    render(
      <SignIn phase={{ phase: 'stopped', reason: 'That was refused.', retry: false }} onRetry={() => {}} />,
    );
    expect(screen.getByText('That was refused.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

// TWO DIFFERENT FACTS, AND ONLY ONE OF THEM IS AN ANSWER. Telling somebody their project is gone while
// the socket is still opening is a lie for the length of a round trip.
describe('what the blank pane says', () => {
  it('says the project is gone only once the socket can answer for it', () => {
    expect(emptyMessage('open')).toBe('No project open.');
    expect(emptyMessage('connecting')).toBe('Connecting…');
    expect(emptyMessage('closed')).toBe('Connecting…');
  });
});

// THE ORDERING IS THE BUG. With no credential the project gate cannot work — listProjects 401s,
// scaffold 401s — so showing it is showing a screen whose every button fails. `!signedIn` has to come
// first, and that is a decision worth holding in one testable place rather than in JSX.
describe('what the shell shows', () => {
  const base = { signedIn: true, ready: true, showGate: false, hasSnapshot: true, wizard: false } as const;

  it('shows sign-in before anything else when there is no credential', () => {
    // Every other condition says "show the board" — only the credential is missing.
    expect(chooseContent({ ...base, signedIn: false })).toBe('signin');
    // And specifically not the gate, which is what it used to show.
    expect(chooseContent({ ...base, signedIn: false, showGate: true })).toBe('signin');
    expect(chooseContent({ ...base, signedIn: false, ready: false })).toBe('signin');
    expect(chooseContent({ ...base, signedIn: false, hasSnapshot: false })).toBe('signin');
  });

  it('shows each of the others in turn once there is one', () => {
    expect(chooseContent({ ...base, ready: false })).toBe('loading');
    expect(chooseContent({ ...base, showGate: true })).toBe('gate');
    expect(chooseContent({ ...base, hasSnapshot: false })).toBe('empty');
    expect(chooseContent(base)).toBe('work');
  });

  // The wizard sits BETWEEN the gate and the snapshot check, and both edges are the point. Its first
  // step scaffolds, so it has to be reachable with no project open; and Switch Project is an explicit
  // request that must win over a setup someone left half-finished.
  it('the wizard shows instead of the work area, and never over the gate or sign-in', () => {
    const inWizard = { ...base, wizard: true };
    expect(chooseContent(inWizard)).toBe('wizard');
    expect(chooseContent({ ...inWizard, hasSnapshot: false })).toBe('wizard');
    expect(chooseContent({ ...inWizard, showGate: true })).toBe('gate');
    expect(chooseContent({ ...inWizard, ready: false })).toBe('loading');
    expect(chooseContent({ ...inWizard, signedIn: false })).toBe('signin');
    expect(chooseContent(base)).toBe('work');
  });
});
