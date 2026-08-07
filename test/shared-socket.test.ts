import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnState } from '../web/src/ws.js';
import { BACKOFF_CEILING_MS, backoffMs, SharedSocket } from '../web/src/ws.js';
import { STUB_TOKEN, stubBrowser } from './browser-stubs.js';

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
  stubBrowser();
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

describe('SharedSocket reconnect and teardown', () => {
  it('connects to the /ws endpoint on the current host', () => {
    const s = new SharedSocket();
    s.acquire();
    // With the credential: the server refuses the upgrade without one, so a socket URL that
    // carried only the path would connect to nothing.
    expect(FakeSocket.instances[0].url).toBe(`ws://localhost:4610/ws?token=${STUB_TOKEN}`);
  });

  it('reconnects a second later when the socket drops while still in use', () => {
    vi.useFakeTimers();
    const s = new SharedSocket();
    s.acquire();
    FakeSocket.instances[0].fireClose();
    expect(FakeSocket.instances).toHaveLength(1); // not yet
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.useRealTimers();
  });

  it('does not reconnect after the last subscriber has gone', () => {
    vi.useFakeTimers();
    const s = new SharedSocket();
    s.acquire();
    s.release();
    FakeSocket.instances[0].fireClose(); // the real close event lands after release
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.useRealTimers();
  });

  it('cancels a pending reconnect when the last subscriber leaves first', () => {
    vi.useFakeTimers();
    const s = new SharedSocket();
    s.acquire();
    FakeSocket.instances[0].fireClose(); // schedules the retry
    s.release(); // must clear it
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.useRealTimers();
  });

  it('reports closed to connection listeners when the socket drops', () => {
    const seen: ConnState[] = [];
    const s = new SharedSocket();
    s.onConn((c) => seen.push(c));
    s.acquire();
    FakeSocket.instances[0].fireOpen();
    FakeSocket.instances[0].fireClose();
    expect(seen).toEqual(['connecting', 'open', 'closed']);
  });

  it('ignores events from a socket it has already replaced', () => {
    const seen: ConnState[] = [];
    const msgs: unknown[] = [];
    const s = new SharedSocket();
    s.onConn((c) => seen.push(c));
    s.subscribe((m) => msgs.push(m));
    s.acquire();
    const first = FakeSocket.instances[0];

    // StrictMode's remount: drop to zero, re-acquire, and only then the old close arrives.
    s.release();
    s.acquire();
    const second = FakeSocket.instances[1];
    expect(second).not.toBe(first);

    seen.length = 0;
    first.fireOpen();
    first.fireClose();
    first.onmessage?.({ data: JSON.stringify({ type: 'stale' }) });
    expect(seen).toEqual([]); // none of the stale socket's events counted
    expect(msgs).toEqual([]);

    // The live one still works.
    second.fireOpen();
    second.onmessage?.({ data: JSON.stringify({ type: 'live' }) });
    expect(seen).toEqual(['open']);
    expect(msgs).toEqual([{ type: 'live' }]);
  });

  it('stops delivering to a listener that has unsubscribed', () => {
    const msgs: unknown[] = [];
    const s = new SharedSocket();
    const off = s.subscribe((m) => msgs.push(m));
    s.acquire();
    FakeSocket.instances[0].onmessage?.({ data: JSON.stringify({ n: 1 }) });
    off();
    FakeSocket.instances[0].onmessage?.({ data: JSON.stringify({ n: 2 }) });
    expect(msgs).toEqual([{ n: 1 }]);
  });

  it('stops notifying a connection listener that has unsubscribed', () => {
    const seen: ConnState[] = [];
    const s = new SharedSocket();
    const off = s.onConn((c) => seen.push(c));
    s.acquire();
    off();
    FakeSocket.instances[0].fireOpen();
    expect(seen).toEqual(['connecting']);
  });

  it('survives release and send before anything was ever connected', () => {
    const s = new SharedSocket();
    expect(() => s.release()).not.toThrow();
    expect(() => s.send({ a: 1 })).not.toThrow();
  });

  it('only sends once the socket is actually open', () => {
    const s = new SharedSocket();
    s.acquire();
    s.send({ early: true }); // readyState is still CONNECTING
    expect(FakeSocket.instances[0].sent).toEqual([]);
    FakeSocket.instances[0].fireOpen();
    s.send({ now: true });
    expect(FakeSocket.instances[0].sent).toEqual([JSON.stringify({ now: true })]);
  });
});

// THE 869-ATTEMPT STORM. With no credential the server refuses the upgrade, the browser sees only
// close code 1006 — which is indistinguishable from "the server is not running" — and a flat
// one-second retry turned that into a reconnect every second, for ever, against a socket that could
// never have succeeded.
describe('a socket with no credential', () => {
  beforeEach(() => {
    // No `vibeboard.token` at all, unlike stubBrowser's store.
    vi.stubGlobal('location', { host: 'localhost:4610', href: 'http://localhost:4610/', search: '' });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    vi.stubGlobal('history', { replaceState: () => {} });
    vi.resetModules();
  });

  it('opens nothing at all, and says why', async () => {
    const { SharedSocket: Fresh } = await import('../web/src/ws.js');
    const s = new Fresh();
    const seen: ConnState[] = [];
    s.onConn((c) => seen.push(c));

    s.acquire();

    expect(FakeSocket.instances).toEqual([]);
    // 'unauthorized', not 'closed': the two need different remedies, and only one of them is
    // something the user's own browser can fix by signing in.
    expect(seen).toEqual(['unauthorized']);
  });

  it('does not retry, because nothing was tried', async () => {
    vi.useFakeTimers();
    const { SharedSocket: Fresh } = await import('../web/src/ws.js');
    const s = new Fresh();
    s.acquire();
    vi.advanceTimersByTime(600_000);
    expect(FakeSocket.instances).toEqual([]);
    vi.useRealTimers();
  });
});

describe('the reconnect backoff', () => {
  it('doubles from a second and stops at the ceiling', () => {
    expect([1, 2, 3, 4, 5, 6].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
    expect(backoffMs(50)).toBe(BACKOFF_CEILING_MS);
  });

  // The bound, measured rather than reasoned about. A flat 1s retry is 3,600 attempts an hour.
  it('makes an hour of a dead server cost tens of attempts, not thousands', () => {
    vi.useFakeTimers();
    const s = new SharedSocket();
    s.acquire();
    for (let elapsed = 0; elapsed < 3_600_000; elapsed += 1000) {
      // Every socket it opens fails immediately, which is what a server that is down looks like.
      for (const sock of FakeSocket.instances) if (sock.readyState !== 3) sock.fireClose();
      vi.advanceTimersByTime(1000);
    }

    expect(FakeSocket.instances.length).toBeLessThan(130); // ~121: five short ones, then one per 30s
    vi.useRealTimers();
  });

  it('resets after a connection that worked, so a later blip still recovers in a second', () => {
    vi.useFakeTimers();
    const s = new SharedSocket();
    s.acquire();
    // Fail four times to push the delay out to 8s.
    for (let i = 0; i < 4; i += 1) {
      FakeSocket.instances.at(-1)?.fireClose();
      vi.advanceTimersByTime(BACKOFF_CEILING_MS);
    }
    const beforeSuccess = FakeSocket.instances.length;
    FakeSocket.instances.at(-1)?.fireOpen();

    FakeSocket.instances.at(-1)?.fireClose();
    vi.advanceTimersByTime(1000);

    expect(FakeSocket.instances.length).toBe(beforeSuccess + 1);
    vi.useRealTimers();
  });
});
