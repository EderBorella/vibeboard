import { useEffect, useMemo } from 'react';

export type ConnState = 'connecting' | 'open' | 'closed';
type Listener = (msg: Record<string, unknown>) => void;

// ONE socket per tab, shared by the board and the copilot.
//
// There used to be two: useSnapshot opened one and useCopilot another, both to /ws, each
// ignoring the other's messages. The server therefore fanned every broadcast out twice and
// replayed the chat history twice per connect — and worse, only useSnapshot reconnected, so a
// server restart left the copilot deaf until a page reload while the board recovered.
//
// Reference-counted on purpose: React StrictMode mounts effects twice in dev, so a naive
// "close on unmount" would tear the socket down under the second subscriber.
export class SharedSocket {
  #socket: WebSocket | undefined;
  #listeners = new Set<Listener>();
  #connListeners = new Set<(c: ConnState) => void>();
  #refs = 0;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #closing = false;

  acquire(): void {
    this.#refs += 1;
    if (this.#refs === 1) this.#connect();
  }

  release(): void {
    this.#refs -= 1;
    if (this.#refs > 0) return;
    this.#closing = true;
    if (this.#retry) { clearTimeout(this.#retry); this.#retry = undefined; }
    this.#socket?.close();
    this.#socket = undefined;
  }

  #setConn(c: ConnState): void { for (const fn of this.#connListeners) fn(c); }

  #connect(): void {
    this.#closing = false;
    this.#setConn('connecting');
    const socket = new WebSocket(`ws://${location.host}/ws`);
    this.#socket = socket;
    // Every handler ignores a socket we have already replaced. close() is asynchronous, so a
    // released socket's events can land AFTER a new one is connecting — the StrictMode
    // remount does exactly that (release to 0, re-acquire, then the old close arrives). Without
    // this guard the stale close saw `#closing === false` and `#refs > 0` again and scheduled a
    // reconnect, orphaning the live socket: two sockets per tab, which is the bug this file
    // exists to fix.
    const stale = (): boolean => this.#socket !== socket;
    socket.onopen = () => { if (!stale()) this.#setConn('open'); };
    socket.onmessage = (ev) => {
      if (stale()) return;
      const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
      for (const fn of this.#listeners) fn(msg);
    };
    socket.onclose = () => {
      if (stale()) return;
      this.#setConn('closed');
      if (!this.#closing && this.#refs > 0) this.#retry = setTimeout(() => this.#connect(), 1000);
    };
  }

  subscribe(fn: Listener): () => void {
    this.#listeners.add(fn);
    return () => { this.#listeners.delete(fn); };
  }

  onConn(fn: (c: ConnState) => void): () => void {
    this.#connListeners.add(fn);
    return () => { this.#connListeners.delete(fn); };
  }

  send(payload: object): void {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(payload));
  }
}

// Keyed by `bump` so opening/switching a project forces a genuinely new socket — the server
// pushes the newly-open project's snapshot on connect.
let current: { bump: number; socket: SharedSocket } | undefined;

function socketFor(bump: number): SharedSocket {
  if (!current || current.bump !== bump) current = { bump, socket: new SharedSocket() };
  return current.socket;
}

export function useSharedWs(bump: number): SharedSocket {
  const socket = useMemo(() => socketFor(bump), [bump]);
  useEffect(() => {
    socket.acquire();
    return () => socket.release();
  }, [socket]);
  return socket;
}
