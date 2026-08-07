// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmRequest } from '../web/src/confirm/useConfirm.js';

const STATE = {
  devices: [
    {
      id: 'dev_this',
      label: 'Firefox on the laptop',
      address: '192.168.0.16',
      created: '2026-08-01T10:00:00.000Z',
      lastSeen: '2026-08-07',
    },
    {
      id: 'dev_other',
      label: 'Safari on the phone',
      address: '192.168.0.31',
      created: '2026-08-05T10:00:00.000Z',
      lastSeen: '2026-08-06',
    },
  ],
  thisDevice: 'dev_this',
  pending: [],
};

const api = vi.hoisted(() => ({
  getSigninState: vi.fn(),
  revokeDevice: vi.fn().mockResolvedValue(undefined),
  signOutEverything: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/token.js', () => ({ authToken: () => 'dev_this.the-secret-half' }));

const { SignInPanel } = await import('../web/src/components/SignInPanel.js');

afterEach(cleanup);
beforeEach(() => {
  api.getSigninState.mockReset().mockResolvedValue(STATE);
  api.revokeDevice.mockClear();
  api.signOutEverything.mockClear();
});

// Typed with their argument, so `mock.calls` carries the request and the assertions below can read
// the words the user would actually have been shown.
const yes = vi.fn(async (_request: ConfirmRequest) => true);
const no = vi.fn(async (_request: ConfirmRequest) => false);

// THE "UNLESS HE WANTS TO CHECK IN THE SETTINGS" HALF. Nobody needs this panel to sign in — that
// happens by itself. It exists so the credential is findable, and because signing everything out is
// the only way to replace one.

describe('the list', () => {
  it('marks which row is this browser, and offers Sign out only on the others', async () => {
    render(<SignInPanel confirm={yes} />);

    await waitFor(() => expect(screen.getByText('Safari on the phone')).toBeTruthy());
    expect(screen.getByText('this browser')).toBeTruthy();
    // One button per OTHER device. Revoking this browser is Sign-everything-out with a confusing name.
    expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1);
  });

  it('shows where each one signed in from and when it was last seen', async () => {
    render(<SignInPanel confirm={yes} />);
    await waitFor(() => expect(screen.getByText(/192\.168\.0\.31/)).toBeTruthy());
    expect(screen.getByText(/last seen 2026-08-06/)).toBeTruthy();
  });

  it('says so plainly when nothing has signed in and the server’s own token is in use', async () => {
    api.getSigninState.mockResolvedValue({ devices: [], thisDevice: null, pending: [] });
    render(<SignInPanel confirm={yes} />);
    await waitFor(() => expect(screen.getByText(/No browser is signed in/)).toBeTruthy());
  });

  it('reports a failure to read it rather than showing an empty list', async () => {
    api.getSigninState.mockRejectedValue(new Error('could not read the device store'));
    render(<SignInPanel confirm={yes} />);
    await waitFor(() => expect(screen.getByText('could not read the device store')).toBeTruthy());
  });
});

describe('the token', () => {
  // Hidden until asked for. The user never needs it, and a credential on screen is a credential in a
  // screenshot or a screen share.
  it('is not on screen until Show token is clicked', async () => {
    render(<SignInPanel confirm={yes} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /show token/i })).toBeTruthy());
    expect(screen.queryByText('dev_this.the-secret-half')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /show token/i }));

    expect(screen.getByText('dev_this.the-secret-half')).toBeTruthy();
  });

  it('warns what holding it means', async () => {
    render(<SignInPanel confirm={yes} />);
    await waitFor(() => expect(screen.getByText(/start agents and edit files/i)).toBeTruthy());
  });
});

describe('signing another browser out', () => {
  it('asks first, then revokes that one', async () => {
    render(<SignInPanel confirm={yes} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(api.revokeDevice).toHaveBeenCalledWith('dev_other'));
    // Named by its label, because the id means nothing to the person deciding.
    expect(yes.mock.calls.at(-1)?.[0]).toMatchObject({ body: expect.stringContaining('Safari on the phone') });
  });

  it('does nothing when the question is answered no', async () => {
    render(<SignInPanel confirm={no} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(no).toHaveBeenCalled());
    expect(api.revokeDevice).not.toHaveBeenCalled();
  });

  it('refreshes the list afterwards, so the row it removed goes away', async () => {
    render(<SignInPanel confirm={yes} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy());
    api.getSigninState.mockResolvedValue({ ...STATE, devices: [STATE.devices[0]] });

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(screen.queryByText('Safari on the phone')).toBeNull());
  });

  it('shows the server’s refusal', async () => {
    api.revokeDevice.mockRejectedValue(new Error('No such device.'));
    render(<SignInPanel confirm={yes} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(screen.getByText('No such device.')).toBeTruthy());
  });
});

describe('signing everything out', () => {
  // The regenerate path. Its confirmation has to say the part people do not expect: THIS browser goes
  // too, and it comes back by itself on the next load.
  it('warns that this browser goes as well, then does it', async () => {
    render(<SignInPanel confirm={yes} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /sign every browser out/i })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /sign every browser out/i }));

    await waitFor(() => expect(api.signOutEverything).toHaveBeenCalledTimes(1));
    const asked = yes.mock.calls.at(-1)?.[0];
    expect(asked?.body).toMatch(/This browser/);
    expect(asked?.body).toMatch(/next page load/);
  });

  it('does nothing when the question is answered no', async () => {
    render(<SignInPanel confirm={no} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /sign every browser out/i })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /sign every browser out/i }));

    await waitFor(() => expect(no).toHaveBeenCalled());
    expect(api.signOutEverything).not.toHaveBeenCalled();
  });
});
