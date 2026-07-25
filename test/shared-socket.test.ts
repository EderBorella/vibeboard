import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SharedSocket } from '../web/src/ws.js';
import type { ConnState } from '../web/src/ws.js';

// The client's shared socket is the one piece of the two-sockets-into-one change that the
// server-side tests cannot reach: each of those opens a single client, so none of them
// exercises the reference counting. These drive it directly against a fake WebSocket.
// (test/ws.test.ts is the server's /ws endpoint — a different concern.)

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  closed = false;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  // close() deliberately does NOT fire onclose: the real event is asynchronous, and the
  // ordering between it and a subsequent reconnect is exactly what these tests pin down.
  close(): void {
    this.closed = true;
  }
  fireClose(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  fireOpen(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
}

const live = (): FakeSocket[] => FakeSocket.instances.filter((s) => !s.closed);

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { host: 'localhost:4610' });
});

describe('SharedSocket', () => {
  it('opens one socket however many subscribers attach', () => {
    const s = new SharedSocket();
    s.acquire();
    s.acquire();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('keeps the socket while any subscriber remains', () => {
    const s = new SharedSocket();
    s.acquire();
    s.acquire();
    s.release(); // the board let go; the copilot still needs it
    expect(live()).toHaveLength(1);
  });

  // Regression: close() is async, so a released socket's close event can land AFTER a new one
  // is already connecting. It then saw #closing back to false and #refs > 0, scheduled a
  // reconnect, and orphaned the live socket — two sockets per tab, the very thing the shared
  // socket exists to prevent. React StrictMode's double-mount hits this on every dev load.
  it('survives the StrictMode double-mount with exactly one live socket', () => {
    vi.useFakeTimers();
    const s = new SharedSocket();
    const seen: ConnState[] = [];
    s.onConn((c) => seen.push(c));

    s.acquire();
    s.acquire(); // board + copilot mount
    const first = FakeSocket.instances[0];
    s.release();
    s.release(); // StrictMode cleanup — refs reaches 0
    s.acquire();
    s.acquire(); // StrictMode remount

    first.fireClose(); // the superseded socket's close finally arrives
    vi.advanceTimersByTime(5000);

    expect(live()).toHaveLength(1);
    expect(live()[0]).not.toBe(first);
    // No spurious 'closed' from the superseded socket either.
    expect(seen).toEqual(['connecting', 'connecting']);
    vi.useRealTimers();
  });

  it('ignores messages from a superseded socket', () => {
    const s = new SharedSocket();
    s.acquire();
    const first = FakeSocket.instances[0];
    const got: unknown[] = [];
    s.subscribe((m) => got.push(m));

    s.release();
    s.acquire(); // a new socket is current now
    first.onmessage?.({ data: JSON.stringify({ type: 'snapshot' }) });

    expect(got).toEqual([]); // a stale project's snapshot must not reach the board
  });

  it('reconnects when the live socket drops with subscribers attached', () => {
    vi.useFakeTimers();
    const s = new SharedSocket();
    s.acquire();
    FakeSocket.instances[0].fireClose(); // server restarted
    vi.advanceTimersByTime(1000);

    expect(FakeSocket.instances).toHaveLength(2);
    vi.useRealTimers();
  });

  it('does not reconnect after the last subscriber leaves', () => {
    vi.useFakeTimers();
    const s = new SharedSocket();
    s.acquire();
    s.release();
    FakeSocket.instances[0].fireClose();
    vi.advanceTimersByTime(5000);

    expect(FakeSocket.instances).toHaveLength(1); // nobody left to serve
    vi.useRealTimers();
  });

  it('reports connection state to its listeners', () => {
    const s = new SharedSocket();
    const seen: ConnState[] = [];
    s.onConn((c) => seen.push(c));
    s.acquire();
    FakeSocket.instances[0].fireOpen();
    expect(seen).toEqual(['connecting', 'open']);
  });

  // A turn typed before the socket finishes connecting is dropped, not thrown — but it IS
  // dropped, so this pins the current contract rather than implying the message is queued.
  it('drops a send while connecting and delivers once open', () => {
    const s = new SharedSocket();
    s.acquire();
    const socket = FakeSocket.instances[0];

    s.send({ type: 'copilot:send', text: 'too early' });
    expect(socket.sent).toEqual([]);

    socket.fireOpen();
    s.send({ type: 'copilot:send', text: 'now' });
    expect(socket.sent).toEqual([JSON.stringify({ type: 'copilot:send', text: 'now' })]);
  });
});
