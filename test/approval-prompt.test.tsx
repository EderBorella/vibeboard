// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  approveSignin: vi.fn().mockResolvedValue({ ok: true }),
  refuseSignin: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../web/src/api.js', () => api);

const { ApprovalPrompt } = await import('../web/src/signin/ApprovalPrompt.js');

afterEach(cleanup);
beforeEach(() => {
  api.approveSignin.mockClear();
  api.refuseSignin.mockClear();
});

const pending = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `req-${i}`,
    label: `Browser ${i}`,
    address: `192.168.0.${20 + i}`,
    at: '2026-08-07T09:00:00.000Z',
  }));

// THE ATTACK ON THIS DIALOG IS PROMPT FATIGUE, not guessing: request ids are 32 random bytes, so the
// only way in is a person clicking Allow without reading. The server caps how often this can appear;
// everything asserted here is the other half of that, and each one is a decision rather than a style.

describe('what the prompt says', () => {
  it('names the address as well as what the browser calls itself', () => {
    render(<ApprovalPrompt pending={pending(1)} />);

    expect(screen.getByText('Browser 0')).toBeTruthy();
    // The label is a User-Agent, and `curl -H 'User-Agent: …'` forges any of those. The address is the
    // only thing on this dialog that narrows down where the request actually came from, so a prompt
    // without it asks the user to decide on evidence that is worthless.
    expect(screen.getByText('192.168.0.20')).toBeTruthy();
  });

  it('says what allowing it actually grants', () => {
    render(<ApprovalPrompt pending={pending(1)} />);
    expect(screen.getByText(/start agents and edit files/i)).toBeTruthy();
  });

  it('says how many more are queued behind this one', () => {
    render(<ApprovalPrompt pending={pending(3)} />);
    expect(screen.getByText(/2 more waiting/i)).toBeTruthy();
  });

  it('renders nothing when nobody is asking', () => {
    const { container } = render(<ApprovalPrompt pending={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('which action is the easy one', () => {
  // The reflex click and the reflex Enter both have to land on "no".
  it('puts Refuse first in the DOM and gives it the focus', () => {
    render(<ApprovalPrompt pending={pending(1)} />);
    const buttons = screen.getAllByRole('button');

    expect(buttons[0].textContent).toBe('Refuse');
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('does not allow anything when Enter is pressed', () => {
    render(<ApprovalPrompt pending={pending(1)} />);

    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });
    // Clicking the focused element is what Enter does in a browser, and the focused element is Refuse.
    fireEvent.click(document.activeElement as Element);

    expect(api.approveSignin).not.toHaveBeenCalled();
    expect(api.refuseSignin).toHaveBeenCalledWith('req-0');
  });

  it('offers no bulk action: three waiting is still one decision', () => {
    // Asserted as the EXACT set of labels. `not.toContain('all')` was the first attempt and it is
    // worthless — "allow" contains "all" — which is the substring trap in miniature.
    render(<ApprovalPrompt pending={pending(3)} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Refuse', 'Allow']);
  });
});

describe('deciding', () => {
  it('approves exactly the request on screen', async () => {
    render(<ApprovalPrompt pending={pending(2)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));

    await waitFor(() => expect(api.approveSignin).toHaveBeenCalledWith('req-0'));
    expect(api.approveSignin).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while the decision is in flight, so one click is one decision', async () => {
    let settle: () => void = () => {};
    api.refuseSignin.mockImplementationOnce(
      () =>
        new Promise((r) => {
          settle = () => r({ ok: true });
        }),
    );
    render(<ApprovalPrompt pending={pending(1)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Refuse' }));

    await waitFor(() => {
      for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
    });
    settle();
  });

  it('reports a failure rather than swallowing it', async () => {
    api.refuseSignin.mockRejectedValueOnce(new Error('the server went away'));
    const onError = vi.fn();
    render(<ApprovalPrompt pending={pending(1)} onError={onError} />);

    fireEvent.click(screen.getByRole('button', { name: 'Refuse' }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('the server went away'));
  });

  // A second request arriving while the first is on screen must not inherit a focus aimed at the
  // decision already being made.
  it('moves the focus back to Refuse when the request changes', async () => {
    const { rerender } = render(<ApprovalPrompt pending={pending(1)} />);
    (screen.getByRole('button', { name: 'Allow' }) as HTMLButtonElement).focus();
    expect((document.activeElement as HTMLElement).textContent).toBe('Allow');

    rerender(<ApprovalPrompt pending={[pending(2)[1]]} />);

    await waitFor(() => expect((document.activeElement as HTMLElement).textContent).toBe('Refuse'));
  });
});
