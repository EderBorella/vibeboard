// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubBrowser } from './browser-stubs.js';

const api = vi.hoisted(() => ({ getAutopilotState: vi.fn() }));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { useAutopilot } = await import('../web/src/useAutopilot.js');

// Two sources, and the socket half is the one that matters: an emergency stop in ANOTHER tab must raise
// the overlay here. Without it, a tab left open would show a working app over a project whose agents are
// dead — and the overlay is the one piece of UI that must never be stale.

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(): void {}
  close(): void {}
}

let nextBump = 5000;
const freshBump = (): number => ++nextBump;

const idle = { state: 'idle', iteration: 0 };

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  stubBrowser();
  api.getAutopilotState.mockReset();
  api.getAutopilotState.mockResolvedValue(idle);
});

describe('useAutopilot', () => {
  // Captured per test, never called inside the render function: `bump` keys the shared socket, so a
  // fresh one on every render would open a socket per render and leave the live one unfindable.
  let bump = 0;
  beforeEach(() => {
    bump = freshBump();
  });

  it('starts with nothing, so no overlay blocks a project nobody has heard from yet', () => {
    const { result } = renderHook(() => useAutopilot(bump));
    expect(result.current.state).toBeNull();
  });

  it('takes its first answer from the endpoint', async () => {
    const { result } = renderHook(() => useAutopilot(bump));
    await waitFor(() => expect(result.current.state?.state).toBe('idle'));
  });

  it('keeps nothing when the endpoint refuses, rather than inventing a state', async () => {
    api.getAutopilotState.mockRejectedValue(new Error('No project open'));
    const { result } = renderHook(() => useAutopilot(bump));
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.state).toBeNull();
  });

  // The point of the socket half. A kill anywhere reaches every tab.
  it('takes a halt pushed over the socket', async () => {
    const { result } = renderHook(() => useAutopilot(bump));
    await waitFor(() => expect(result.current.state?.state).toBe('idle'));
    const socket = FakeSocket.instances[0];
    act(() => {
      socket.onmessage?.({
        data: JSON.stringify({
          type: 'autopilot:state',
          state: { ...idle, state: 'halted', reason: 'killed', detail: 'gone' },
        }),
      });
    });
    expect(result.current.state?.state).toBe('halted');
    expect(result.current.state?.detail).toBe('gone');
  });

  it('ignores the other traffic on that socket', async () => {
    const { result } = renderHook(() => useAutopilot(bump));
    await waitFor(() => expect(result.current.state?.state).toBe('idle'));
    act(() => {
      FakeSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'snapshot', snapshot: {} }) });
    });
    expect(result.current.state?.state).toBe('idle');
  });

  it('asks again when told to refresh', async () => {
    const { result } = renderHook(() => useAutopilot(bump));
    await waitFor(() => expect(api.getAutopilotState).toHaveBeenCalledTimes(1));
    api.getAutopilotState.mockResolvedValue({ ...idle, state: 'stopped', reason: 'complete' });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.state?.reason).toBe('complete'));
  });

  // THE COUNTER, which arrives by no other route. The loop writes `iteration` straight to the state file
  // — decision 20's carve-out — and nothing watches that file, so no broadcast
  // accompanies them: without this poll the panel says "0 dispatches" for a whole run while the ledger beside
  // it, computed server-side from the same file, says seven. A review found the entire effect deletable with
  // the full suite green.
  //
  // Fake timers here rather than four real seconds, and they are safe because what is being observed is the
  // TIMER firing — not a write landing on a disk, which a faked clock cannot flush.
  it('polls the counters while the loop is running', async () => {
    vi.useFakeTimers();
    try {
      api.getAutopilotState.mockResolvedValue({ ...idle, state: 'running', iteration: 2 });
      renderHook(() => useAutopilot(bump));
      // Flush the first fetch so `state` is `running` and the effect has installed its interval. `waitFor`
      // cannot do this job under fake timers — it schedules its own.
      await act(async () => {});
      expect(api.getAutopilotState).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      expect(api.getAutopilotState).toHaveBeenCalledTimes(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      expect(api.getAutopilotState).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  // And it STOPS with the run: a tab left open on a finished project must not poll for ever. The effect keys on
  // the state name, so the interval goes the moment the loop reports anything else.
  it('stops polling once the loop is no longer running', async () => {
    vi.useFakeTimers();
    try {
      api.getAutopilotState.mockResolvedValue({ ...idle, state: 'running' });
      renderHook(() => useAutopilot(bump));
      await act(async () => {});
      expect(api.getAutopilotState).toHaveBeenCalledTimes(1);

      // The next poll answers `stopped`, which must take the interval down with it.
      api.getAutopilotState.mockResolvedValue({ ...idle, state: 'stopped', reason: 'complete' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      const afterStop = api.getAutopilotState.mock.calls.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(api.getAutopilotState).toHaveBeenCalledTimes(afterStop);
    } finally {
      vi.useRealTimers();
    }
  });
});
