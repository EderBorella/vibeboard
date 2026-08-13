// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutopilotState } from '../web/src/api.js';

const api = vi.hoisted(() => ({ restartAutopilot: vi.fn() }));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { HaltOverlay } = await import('../web/src/components/HaltOverlay.js');

afterEach(() => {
  cleanup();
  api.restartAutopilot.mockReset();
});

const NOW = '2026-08-03T09:15:00.000Z';

const halted = (over: Partial<AutopilotState> = {}): AutopilotState => ({
  state: 'halted',
  iteration: 4,
  reason: 'killed',
  detail: 'Everything in this project was killed by an emergency stop.',
  at: NOW,
  ...over,
});

// Decision 12 asks for an overlay that STATES THE REASON AND THE TIMESTAMP and carries the way back.
// Blocking is the easy half: a halted app that only refused would leave the user clicking things that
// silently do nothing, over a board that looks perfectly healthy.
describe('the halt overlay', () => {
  it('says why the project is halted and when', () => {
    render(<HaltOverlay state={halted()} onRestarted={vi.fn()} />);
    expect(screen.getByText(/killed by an emergency stop/)).toBeTruthy();
    // The date as well as the time: a project halted on Friday is opened on Monday.
    expect(screen.getByText(/Halted at .*2026/)).toBeTruthy();
  });

  it('says what is still refused, not merely that something is wrong', () => {
    render(<HaltOverlay state={halted()} onRestarted={vi.fn()} />);
    // The half people do not expect: the chat stops too, because nothing may be spawned for a halted
    // project — without that, the Restart button would be decorative.
    expect(screen.getByText(/not even by the chat/i)).toBeTruthy();
  });

  it('still explains itself when the reason was lost', () => {
    // A hand-edited state file can lose the detail. The overlay must not become a blank wall.
    render(<HaltOverlay state={halted({ detail: undefined, at: undefined })} onRestarted={vi.fn()} />);
    expect(screen.getByText(/Everything in this project was stopped/)).toBeTruthy();
    expect(screen.getByText(/at an unrecorded time/)).toBeTruthy();
  });

  it('restarts, and tells the shell so the overlay can go', async () => {
    api.restartAutopilot.mockResolvedValue({ state: { state: 'idle' } });
    const onRestarted = vi.fn();
    render(<HaltOverlay state={halted()} onRestarted={onRestarted} />);
    fireEvent.click(screen.getByText('Restart project'));
    await waitFor(() => expect(onRestarted).toHaveBeenCalled());
    expect(api.restartAutopilot).toHaveBeenCalled();
  });

  // A refusal that vanished would leave the user pressing a button that does nothing.
  it('shows a refusal and stays put', async () => {
    api.restartAutopilot.mockRejectedValue(new Error('Auto-pilot is running. Soft-stop it first.'));
    const onRestarted = vi.fn();
    render(<HaltOverlay state={halted()} onRestarted={onRestarted} />);
    fireEvent.click(screen.getByText('Restart project'));
    expect(await screen.findByText(/Soft-stop it first/)).toBeTruthy();
    expect(onRestarted).not.toHaveBeenCalled();
  });
});

// Decision 12 asks the overlay to state the reason AND the timestamp. One halt has no timestamp to
// state: `unreadable` is detected on every read of a damaged file, so `at` was re-derived as "now" each
// poll and the overlay said the project had been halted seconds ago, indefinitely. Recording it would
// mean writing to the file that could not be read, destroying the only evidence there is.
describe('a halt with nothing behind its clock', () => {
  it('says so, rather than showing a time that keeps moving', () => {
    render(<HaltOverlay state={halted({ reason: 'unreadable', at: NOW })} onRestarted={vi.fn()} />);
    expect(screen.getByText(/nothing recorded/)).toBeTruthy();
    expect(screen.queryByText(new RegExp(new Date(NOW).getFullYear().toString()))).toBeNull();
  });

  it('still shows the real time for a halt that has one', () => {
    render(<HaltOverlay state={halted({ reason: 'killed', at: NOW })} onRestarted={vi.fn()} />);
    expect(screen.queryByText(/nothing recorded/)).toBeNull();
    expect(screen.getByText(new RegExp(new Date(NOW).getFullYear().toString()))).toBeTruthy();
  });
});

// The backdrop blocks the pointer; it did not block Tab. Reaching "Switch project" behind it and pressing
// Enter set the gate, and the overlay renders `&& !showGate` — so the only explanation of why the project
// is dead dismissed itself, by keyboard, with no way back to it.
describe('keeping focus inside', () => {
  it('focuses the way out as soon as it appears', () => {
    render(<HaltOverlay state={halted()} onRestarted={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByText('Restart project').closest('button'));
  });

  it('will not let Tab leave for what is behind it', () => {
    // A control outside the overlay, standing in for the TopBar: without the trap, Tab reaches it.
    const outside = document.createElement('button');
    outside.textContent = 'Switch project';
    document.body.appendChild(outside);
    render(<HaltOverlay state={halted()} onRestarted={vi.fn()} />);
    outside.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('Restart project').closest('button'));
    outside.remove();
  });
});
