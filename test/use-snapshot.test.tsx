// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same shape as the real shared socket, keyed by bump so a project switch hands over a new one.
const h = vi.hoisted(() => {
  const make = () => {
    const msgs = new Set<(m: Record<string, unknown>) => void>();
    const conns = new Set<(c: string) => void>();
    return {
      msgs,
      conns,
      subscribe(fn: (m: Record<string, unknown>) => void) {
        msgs.add(fn);
        return () => msgs.delete(fn);
      },
      onConn(fn: (c: string) => void) {
        conns.add(fn);
        return () => conns.delete(fn);
      },
    };
  };
  const byBump = new Map<number, ReturnType<typeof make>>();
  return {
    byBump,
    get(bump: number) {
      let s = byBump.get(bump);
      if (!s) {
        s = make();
        byBump.set(bump, s);
      }
      return s;
    },
  };
});

vi.mock('../web/src/lib/ws.js', () => ({ useSharedWs: (bump: number) => h.get(bump) }));

import { useSnapshot } from '../web/src/lib/useSnapshot.js';

const push = (bump: number, msg: Record<string, unknown>): void => {
  act(() => {
    for (const fn of h.get(bump).msgs) fn(msg);
  });
};
const conn = (bump: number, c: string): void => {
  act(() => {
    for (const fn of h.get(bump).conns) fn(c);
  });
};

beforeEach(() => {
  for (const s of h.byBump.values()) {
    s.msgs.clear();
    s.conns.clear();
  }
});

describe('useSnapshot', () => {
  it('starts empty and connecting', () => {
    const { result } = renderHook(() => useSnapshot(0));
    expect(result.current.snapshot).toBeNull();
    expect(result.current.conn).toBe('connecting');
  });

  it('takes the snapshot from a snapshot message', () => {
    const { result } = renderHook(() => useSnapshot(1));
    push(1, { type: 'snapshot', snapshot: { config: { name: 'Demo' } } });
    expect(result.current.snapshot).toEqual({ config: { name: 'Demo' } });
  });

  it('ignores every other message type, including the copilot traffic it shares the socket with', () => {
    const { result } = renderHook(() => useSnapshot(2));
    push(2, { type: 'snapshot', snapshot: { config: { name: 'First' } } });
    for (const type of ['copilot:event', 'copilot:history', 'copilot:chats', 'copilot:error']) {
      push(2, { type, snapshot: { config: { name: 'Should not win' } } });
    }
    expect(result.current.snapshot).toEqual({ config: { name: 'First' } });
  });

  it('replaces the snapshot wholesale on each update', () => {
    const { result } = renderHook(() => useSnapshot(3));
    push(3, { type: 'snapshot', snapshot: { config: { name: 'One' }, extra: 1 } });
    push(3, { type: 'snapshot', snapshot: { config: { name: 'Two' } } });
    expect(result.current.snapshot).toEqual({ config: { name: 'Two' } });
  });

  it('tracks the connection state', () => {
    const { result } = renderHook(() => useSnapshot(4));
    conn(4, 'open');
    expect(result.current.conn).toBe('open');
    conn(4, 'closed');
    expect(result.current.conn).toBe('closed');
  });

  it('resubscribes to the new socket when the project changes', () => {
    const { result, rerender } = renderHook(({ bump }) => useSnapshot(bump), {
      initialProps: { bump: 5 },
    });
    push(5, { type: 'snapshot', snapshot: { config: { name: 'Old project' } } });

    rerender({ bump: 6 });
    // The old socket must no longer reach it, and the new one must.
    push(5, { type: 'snapshot', snapshot: { config: { name: 'Stale' } } });
    expect(result.current.snapshot).toEqual({ config: { name: 'Old project' } });

    push(6, { type: 'snapshot', snapshot: { config: { name: 'New project' } } });
    expect(result.current.snapshot).toEqual({ config: { name: 'New project' } });
  });

  it('detaches its listeners on unmount', () => {
    const { unmount } = renderHook(() => useSnapshot(7));
    expect(h.get(7).msgs.size).toBe(1);
    expect(h.get(7).conns.size).toBe(1);
    unmount();
    expect(h.get(7).msgs.size).toBe(0);
    expect(h.get(7).conns.size).toBe(0);
  });
});

describe('useSnapshot reattaches both listeners on a project change', () => {
  it('tracks connection state on the new socket, not the old one', () => {
    const { result, rerender } = renderHook(({ bump }) => useSnapshot(bump), {
      initialProps: { bump: 8 },
    });
    conn(8, 'open');
    expect(result.current.conn).toBe('open');

    rerender({ bump: 9 });
    conn(8, 'closed'); // the old socket must no longer be heard
    expect(result.current.conn).not.toBe('closed');
    conn(9, 'closed');
    expect(result.current.conn).toBe('closed');
  });
});
