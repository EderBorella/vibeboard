// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignIn } from '../web/src/components/SignIn.js';
import { chooseContent } from '../web/src/shell.js';

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

describe('waiting for another browser to allow it', () => {
  const waiting = { phase: 'waiting', label: 'Safari on the phone', address: '192.168.0.31' } as const;

  it('says where to look, and repeats what the other browser will show', () => {
    render(<SignIn phase={waiting} onRetry={() => {}} />);

    expect(screen.getByText(/look for the prompt/i)).toBeTruthy();
    // Both halves, because the user has to recognise the prompt on the other screen. Without them
    // they are asked to match this against nothing.
    expect(screen.getByText('Safari on the phone')).toBeTruthy();
    expect(screen.getByText('192.168.0.31')).toBeTruthy();
  });

  it('still asks for nothing', () => {
    render(<SignIn phase={waiting} onRetry={() => {}} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/nothing to type/i)).toBeTruthy();
  });
});

describe('when it stopped', () => {
  it('states the reason it was given, verbatim', () => {
    const reason = '2 agents are running on this project, so signing in a new browser is closed.';
    render(<SignIn phase={{ phase: 'stopped', reason, retry: true }} onRetry={() => {}} />);
    expect(screen.getByText(reason)).toBeTruthy();
  });

  it('offers Try again where trying again could work', () => {
    const onRetry = vi.fn();
    render(<SignIn phase={{ phase: 'stopped', reason: 'busy', retry: true }} onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // A refusal is a decision somebody made. Offering a retry beside it invites arguing with them, and
  // the server would rate-limit the argument anyway.
  it('offers nothing after a refusal', () => {
    render(<SignIn phase={{ phase: 'stopped', reason: 'That was refused.', retry: false }} onRetry={() => {}} />);
    expect(screen.getByText('That was refused.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

// THE ORDERING IS THE BUG. With no credential the project gate cannot work — listProjects 401s,
// scaffold 401s — so showing it is showing a screen whose every button fails. `!signedIn` has to come
// first, and that is a decision worth holding in one testable place rather than in JSX.
describe('what the shell shows', () => {
  const base = { signedIn: true, ready: true, showGate: false, hasSnapshot: true } as const;

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
});
