// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  restartOpencodeServer: vi.fn().mockResolvedValue({ ok: true, url: 'http://127.0.0.1:1' }),
  takeOverOpencodeServer: vi.fn().mockResolvedValue({ ok: true, url: 'http://127.0.0.1:2' }),
}));
vi.mock('../web/src/api.js', () => api);

const { SandboxPanel } = await import('../web/src/components/SandboxPanel.js');
import type { SandboxState } from '../web/src/api.js';

afterEach(() => {
  cleanup();
  api.restartOpencodeServer.mockClear();
  api.takeOverOpencodeServer.mockClear();
});

const state = (over: Partial<SandboxState> = {}): SandboxState => ({
  ok: true,
  profile: 'vibeboard-agent',
  backend: 'managed',
  autopilotRefusal: null,
  ...over,
});

const show = (over: Partial<SandboxState> = {}, backend = 'opencode') =>
  render(<SandboxPanel state={state(over)} backend={backend} onChanged={() => {}} />);

describe('what it says is enforced', () => {
  it('names the files an agent cannot write, not just that something is on', () => {
    show();
    // "Sandbox: enabled" would be a claim nobody can check. The panel has to say what it means.
    expect(screen.getByText(/cannot write the files that govern it/i)).toBeTruthy();
    expect(screen.getByText(/config\.yaml/)).toBeTruthy();
  });

  it('carries the reason and the consequence when there is no sandbox', () => {
    show({ ok: false, profile: undefined, reason: 'profile not loaded — run `npm run sandbox:install`' });
    expect(screen.getByText(/sandbox:install/)).toBeTruthy();
    // Both halves: what still works, and what will not. Either alone misleads.
    expect(screen.getByText(/Manual runs and chat still work/i)).toBeTruthy();
    expect(screen.getByText(/auto-pilot will refuse to start/i)).toBeTruthy();
  });

  it('warns about an attached server even when the profile is loaded', () => {
    // The dangerous case: everything looks fine, and the server we never spawned is unconfined.
    show({ ok: true, backend: 'attached', attachedUrl: 'http://127.0.0.1:9999' });
    expect(screen.getByText(/VibeBoard did not start/i)).toBeTruthy();
    expect(screen.getByText(/127\.0\.0\.1:9999/)).toBeTruthy();
  });
});

describe('the two actions', () => {
  it('explains what restarting does to the running session', () => {
    show();
    expect(screen.getByRole('button', { name: /restart server/i })).toBeTruthy();
    expect(screen.getByText(/Any turn in flight is lost/i)).toBeTruthy();
  });

  it('offers take-over only while attached to an external server', () => {
    show({ backend: 'managed' });
    expect(screen.queryByRole('button', { name: /take over/i })).toBeNull();
    cleanup();
    show({ backend: 'attached', attachedUrl: 'http://127.0.0.1:9999' });
    expect(screen.getByRole('button', { name: /take over/i })).toBeTruthy();
  });

  it('hides restart while attached, because it would spawn a server nothing talks to', () => {
    // opencodeBaseUrl() short-circuits to the attached URL, so the new process would just hold a
    // port while the UI reported success and the attachment warning still stood.
    show({ backend: 'attached', attachedUrl: 'http://127.0.0.1:9999' });
    expect(screen.queryByRole('button', { name: /restart server/i })).toBeNull();
    expect(screen.getByRole('button', { name: /take over/i })).toBeTruthy();
  });

  it('offers neither for Claude Code', () => {
    // It spawns a process per turn and has no persistent server, so a restart button would be a lie.
    show({ backend: 'attached', attachedUrl: 'http://127.0.0.1:9999' }, 'claude-code');
    expect(screen.queryByRole('button', { name: /restart server/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /take over/i })).toBeNull();
  });

  it('calls restart, and only restart', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /restart server/i }));
    await waitFor(() => expect(api.restartOpencodeServer).toHaveBeenCalledTimes(1));
    // The two actions are one line apart and do different things to somebody's session.
    expect(api.takeOverOpencodeServer).not.toHaveBeenCalled();
  });

  it('shows the failure instead of silently doing nothing', async () => {
    api.restartOpencodeServer.mockRejectedValueOnce(new Error('opencode serve exited (1)'));
    show();
    fireEvent.click(screen.getByRole('button', { name: /restart server/i }));
    expect(await screen.findByText(/opencode serve exited \(1\)/)).toBeTruthy();
  });
});
