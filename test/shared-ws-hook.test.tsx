// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSharedWs } from '../web/src/lib/ws.js';
import { stubBrowser } from './browser-stubs.js';

// The module keeps ONE socket per `bump`, so the board and the copilot share it and switching
// project forces a genuinely new one — the server pushes the newly-open project's snapshot on
// connect. That caching plus the acquire/release pairing is only reachable through the hook.

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.closed = true;
  }
}

// `bump` is module-scoped state, so every test needs one nobody else has used.
let nextBump = 1000;
const freshBump = (): number => ++nextBump;

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  stubBrowser();
});

describe('useSharedWs', () => {
  it('hands the same socket to every caller on the same bump', () => {
    const bump = freshBump();
    const a = renderHook(() => useSharedWs(bump));
    const b = renderHook(() => useSharedWs(bump));
    expect(a.result.current).toBe(b.result.current);
    // Reference counted, so two subscribers still means one connection.
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('builds a new socket when the bump changes, and keeps the old one closed', () => {
    const first = freshBump();
    const { result, rerender } = renderHook(({ bump }) => useSharedWs(bump), {
      initialProps: { bump: first },
    });
    const before = result.current;
    expect(FakeSocket.instances).toHaveLength(1);

    rerender({ bump: freshBump() });
    expect(result.current).not.toBe(before);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[0].closed).toBe(true);
  });

  it('keeps handing back the same instance across re-renders with an unchanged bump', () => {
    const bump = freshBump();
    const { result, rerender } = renderHook(({ b }) => useSharedWs(b), { initialProps: { b: bump } });
    const before = result.current;
    rerender({ b: bump });
    rerender({ b: bump });
    expect(result.current).toBe(before);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('closes the socket once the last consumer unmounts', () => {
    const bump = freshBump();
    const a = renderHook(() => useSharedWs(bump));
    const b = renderHook(() => useSharedWs(bump));

    a.unmount();
    expect(FakeSocket.instances[0].closed).toBe(false); // b still holds a reference
    b.unmount();
    expect(FakeSocket.instances[0].closed).toBe(true);
  });
});
