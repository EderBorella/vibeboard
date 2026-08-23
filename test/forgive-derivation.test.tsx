// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// THE WAY OUT OF A SPENT BOOTSTRAP — the one position with no card, and therefore the one with no button
// until now.
//
// An empty board plus a README is derived by a card-less run, and its cap is counted over the project's own
// runs. On 2026-08-16 an OpenCode server that could not be reached spent all three of the calculator's
// derivation attempts in five seconds — 449ms each, no model, no tokens — and auto-pilot stopped saying the
// README might be too thin to derive from. Clearing them meant deleting files out of `project-runs/` by
// hand: undiscoverable, and it destroys the only account of why the project was stuck.
const api = vi.hoisted(() => ({ forgiveProjectAttempts: vi.fn(async () => ({ forgiven: 3 })) }));
vi.mock('../web/src/lib/api.js', () => api);
vi.mock('../web/src/lib/api', () => api);

const { ForgiveDerivation } = await import('../web/src/organisms/autopilot/ForgiveDerivation.js');

afterEach(() => {
  cleanup();
  api.forgiveProjectAttempts.mockReset();
  api.forgiveProjectAttempts.mockResolvedValue({ forgiven: 3 });
});

// The confirmation is part of the control, so it is answered rather than bypassed: a test that called the
// endpoint directly would pass with the dialog wired to nothing.
async function clearIt(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /clear the derivation/i }));
  fireEvent.click(await screen.findByRole('button', { name: /clear them/i }));
}

describe('clearing the project’s derivation attempts', () => {
  it('calls the project endpoint, not a card one', async () => {
    render(<ForgiveDerivation reason="stalled" onForgiven={() => {}} />);

    await clearIt();

    await waitFor(() => expect(api.forgiveProjectAttempts).toHaveBeenCalledTimes(1));
  });

  it('says how many it cleared, because “done” would imply the machine is fixed', async () => {
    render(<ForgiveDerivation reason="stalled" onForgiven={() => {}} />);

    await clearIt();

    expect(await screen.findByText(/cleared 3 attempts/i)).toBeTruthy();
  });

  it('says plainly when nothing was counting', async () => {
    // The honest answer to a stalled project whose derivation was never the problem: whatever is holding it
    // is somewhere else, and reporting success here would send the user back to the same wall.
    api.forgiveProjectAttempts.mockResolvedValue({ forgiven: 0 });
    render(<ForgiveDerivation reason="stalled" onForgiven={() => {}} />);

    await clearIt();

    expect(await screen.findByText(/nothing was counting/i)).toBeTruthy();
  });

  it('refetches, so the bar stops showing the stop it just cleared', async () => {
    // The sentence in the bar is derived from the records this write stamps. Without the refetch the stop
    // text stays exactly as it was and the button reads as having done nothing.
    const onForgiven = vi.fn();
    render(<ForgiveDerivation reason="stalled" onForgiven={onForgiven} />);

    await clearIt();

    await waitFor(() => expect(onForgiven).toHaveBeenCalledTimes(1));
  });

  it('does nothing at all if the confirmation is declined', async () => {
    render(<ForgiveDerivation reason="stalled" onForgiven={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /clear the derivation/i }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));

    expect(api.forgiveProjectAttempts).not.toHaveBeenCalled();
  });
});

// WHEN IT IS OFFERED AT ALL. Asserted here rather than in the bar: the rule moved into this component when
// the complexity gate refused it upstairs, and when a remedy is offered is part of what the remedy means.
describe('when the control appears', () => {
  it('renders nothing unless the loop stalled', () => {
    // `complete` is the loop having finished — nothing went wrong, so offering to clear attempts would
    // invent a problem. `undefined` is a loop that has not stopped at all.
    const done = render(<ForgiveDerivation reason="complete" onForgiven={() => {}} />);
    expect(done.container.textContent).toBe('');
    cleanup();

    const running = render(<ForgiveDerivation reason={undefined} onForgiven={() => {}} />);
    expect(running.container.textContent).toBe('');
  });
});
