import { useEffect, useMemo } from 'react';
import { probeCredential } from './api';
import { onCredentialChange, signedIn } from './token';

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
  // Called when a handshake is refused, to find out why over a channel that can say. Injected so it is
  // testable and so this module does not decide policy — the default asks the API, whose 401 handling
  // already clears the credential and restarts sign-in.
  readonly #probe: () => void;

  constructor(probe: () => void = () => void probeCredential()) {
    this.#probe = probe;
  }

  #socket: WebSocket | undefined;
  #listeners = new Set<Listener>();
  #connListeners = new Set<(c: ConnState) => void>();
  #refs = 0;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #closing = false;
  #attempts = 0;
  #unwatch: (() => void) | undefined;
  // True only while a connection is actually up. A socket OBJECT outlives its connection, so it
  // cannot answer this question.
  #live = false;

  acquire(): void {
    this.#refs += 1;
    if (this.#refs !== 1) return;
    // Woken when a credential arrives, because the branch below has nothing to retry: it never opened
    // a socket, so no close event will ever bring it back.
    this.#unwatch = onCredentialChange(() => this.#credentialChanged());
    this.#connect();
  }

  // A new credential is worth acting on in BOTH states that are not connected:
  //
  //   nothing at all      the dead end — no socket, no retry, so nothing would ever bring it back.
  //   a pending retry     the attempts that failed did so with the credential this one REPLACES, and
  //                       the backoff they earned is up to thirty seconds. Waiting it out was the
  //                       first version of this method and it is a large part of what the user saw as
  //                       the board taking a minute to connect: sign-in had already fixed the problem
  //                       the socket was still being punished for.
  //
  // A LIVE socket is the one case to leave alone: replacing it would be two sockets per tab, which is
  // the bug this whole file exists to prevent. `#live` rather than `#socket !== undefined`, because a
  // socket object outlives its connection — it is still there, dead, while the retry is pending.
  #credentialChanged(): void {
    if (this.#refs === 0 || this.#live || !signedIn()) return;
    if (this.#retry) {
      clearTimeout(this.#retry);
      this.#retry = undefined;
    }
    this.#attempts = 0;
    this.#connect();
  }

  release(): void {
    this.#refs -= 1;
    if (this.#refs > 0) return;
    this.#unwatch?.();
    this.#unwatch = undefined;
    this.#closing = true;
    if (this.#retry) {
      clearTimeout(this.#retry);
      this.#retry = undefined;
    }
    this.#live = false;
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
    // attempts in one log, all of them certain to fail.
    //
    // This branch schedules NOTHING, which is what makes it a dead end: no socket exists, so no close
    // event will ever come back. `onCredentialChange` in acquire() is the way out — and it has to be
    // that rather than a React state change, because sign-in replacing a dead credential with a live
    // one can leave `signedIn` looking unchanged within a single batch, and then nothing re-rendered.
    if (!signedIn()) {
      this.#setConn('unauthorized');
      return;
    }
    this.#setConn('connecting');
    // NO QUERY STRING. The credential is a cookie and the browser attaches it to the handshake itself,
    // which is why `stripSecrets` in the server's logging no longer has a token to find here.
    //
    // A cookie is also SHARED browser state, and that is what fixed the bug this class kept being
    // patched for: a stale tab running an older bundle sends whatever credential the browser currently
    // holds, so its handshake SUCCEEDS. Nothing sits failing, so Firefox's per-host fail-delay never
    // grows, so a good tab's handshake is never queued behind a socket that cannot work.
    const socket = new WebSocket(`ws://${location.host}/ws`);
    this.#socket = socket;
    // Every handler ignores a socket we have already replaced. close() is asynchronous, so a
    // released socket's events can land AFTER a new one is connecting — the StrictMode
    // remount does exactly that (release to 0, re-acquire, then the old close arrives). Without
    // this guard the stale close saw `#closing === false` and `#refs > 0` again and scheduled a
    // reconnect, orphaning the live socket: two sockets per tab, which is the bug this file
    // exists to fix.
    const stale = (): boolean => this.#socket !== socket;
    // Per attempt, not per socket: a socket that opened and then dropped is a server restarting, and
    // retrying is the right answer. One that never opened had its HANDSHAKE refused, which is the case
    // that needs explaining.
    let opened = false;
    socket.onopen = () => {
      if (stale()) return;
      opened = true;
      this.#live = true;
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
      this.#live = false;
      this.#setConn('closed');
      if (this.#closing || this.#refs === 0) return;
      // THE HALF THAT WAS MISSING. Without it a browser whose credential was revoked — from another
      // device, or by Sign everything out — retries this socket every thirty seconds for ever and can
      // never recover, because 1006 tells it nothing and it makes no other request that would.
      if (!opened) this.#probe();
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
