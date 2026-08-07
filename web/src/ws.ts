import { useEffect, useMemo } from 'react';
import { authToken, hasToken } from './token';

// `unauthorized` is a state of its own because a browser CANNOT SEE why a handshake failed: a 401'd
// upgrade arrives as close code 1006, indistinguishable from "the server is not running". So it is
// never derived from a close event — it is what this socket reports when it declines to connect at all
// for want of a credential, and the sign-in flow is what resolves it.
export type ConnState = 'connecting' | 'open' | 'closed' | 'unauthorized';
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
// Doubling from a second up to half a minute. The first two attempts are quick, because the common
// cause is a server restarting and the board should come back without a reload; past that the cause is
// something a person has to fix, and hammering it neither helps nor tells anyone.
//
// Exported so the bound is asserted rather than reasoned about: a flat 1s retry is 3,600 attempts an
// hour, and one log has 869 of them against a socket that could never have succeeded.
export const BACKOFF_CEILING_MS = 30_000;

export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_CEILING_MS, 1000 * 2 ** (attempt - 1));
}

export class SharedSocket {
  #socket: WebSocket | undefined;
  #listeners = new Set<Listener>();
  #connListeners = new Set<(c: ConnState) => void>();
  #refs = 0;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #closing = false;
  #attempts = 0;

  acquire(): void {
    this.#refs += 1;
    if (this.#refs === 1) this.#connect();
  }

  release(): void {
    this.#refs -= 1;
    if (this.#refs > 0) return;
    this.#closing = true;
    if (this.#retry) {
      clearTimeout(this.#retry);
      this.#retry = undefined;
    }
    this.#socket?.close();
    this.#socket = undefined;
  }

  #setConn(c: ConnState): void {
    for (const fn of this.#connListeners) fn(c);
  }

  #connect(): void {
    this.#closing = false;
    // NOTHING IS OPENED WITHOUT A CREDENTIAL. The server refuses the upgrade, the browser sees only
    // code 1006, and the old flat one-second retry turned that into an endless reconnect storm — 869
    // attempts in one log, all of them certain to fail. The sign-in flow is what fixes this state, and
    // it fires `onUnauthorized` → a re-render with a token, which re-acquires the socket.
    if (!hasToken()) {
      this.#setConn('unauthorized');
      return;
    }
    this.#setConn('connecting');
    // The credential goes in the query string because a browser cannot set headers on a WebSocket
    // handshake. The server refuses the upgrade without it.
    const socket = new WebSocket(`ws://${location.host}/ws?token=${encodeURIComponent(authToken())}`);
    this.#socket = socket;
    // Every handler ignores a socket we have already replaced. close() is asynchronous, so a
    // released socket's events can land AFTER a new one is connecting — the StrictMode
    // remount does exactly that (release to 0, re-acquire, then the old close arrives). Without
    // this guard the stale close saw `#closing === false` and `#refs > 0` again and scheduled a
    // reconnect, orphaning the live socket: two sockets per tab, which is the bug this file
    // exists to fix.
    const stale = (): boolean => this.#socket !== socket;
    socket.onopen = () => {
      if (stale()) return;
      this.#attempts = 0; // a connection that worked resets the backoff, so a later blip recovers fast
      this.#setConn('open');
    };
    // Without this, a handshake error is an unhandled event and the console fills with them. It says
    // nothing about WHY — see the note on ConnState — so it only stops the noise.
    socket.onerror = () => {
      /* the close handler below is what reacts */
    };
    socket.onmessage = (ev) => {
      if (stale()) return;
      const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
      for (const fn of this.#listeners) fn(msg);
    };
    socket.onclose = () => {
      if (stale()) return;
      this.#setConn('closed');
      if (this.#closing || this.#refs === 0) return;
      this.#attempts += 1;
      this.#retry = setTimeout(() => this.#connect(), backoffMs(this.#attempts));
    };
  }

  subscribe(fn: Listener): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  onConn(fn: (c: ConnState) => void): () => void {
    this.#connListeners.add(fn);
    return () => {
      this.#connListeners.delete(fn);
    };
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
