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

const halted = (over: Partial<AutopilotState> = {}): AutopilotState => ({
  state: 'halted',
  iteration: 4,
  dispatchesSinceCheckup: 1,
  needsCheckup: true,
  reason: 'killed',
  detail: 'Everything in this project was killed by an emergency stop.',
  at: '2026-08-03T09:15:00.000Z',
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
