// THE ONE PLACE THIS MODULE TALKS TO THE NETWORK. Every feature module in `api/` calls `request` here and
// nothing calls `fetch` itself — that singularity is the point, not an accident of layout, so a route
// quietly returning an error body as data cannot come back.

import { credentialGeneration, signedIn, signOutLocally } from '../token';

// A failed call, carrying the status as data rather than only as prose. Six readers in this module
// used to skip the `res.ok` check entirely and return the error body as if it were the answer, so an
// unauthenticated browser saw an empty project list and no explanation — indistinguishable from a
// fresh install. `status` is what lets a caller tell "you are not signed in" from "that failed".
export class ApiError extends Error {
  readonly status: number;
  // The server's machine-readable code where it sent one, so a caller can branch on WHY without
  // matching on prose that is meant to be improvable. Only the sign-in routes send it today.
  readonly reason: string | undefined;

  constructor(status: number, message: string, reason?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
  }

  get unauthorized(): boolean {
    return this.status === 401;
  }
}

let unauthorizedHandler: (() => void) | undefined;

// Fired once per 401 from anywhere in the module, so a credential that stops working — revoked from
// another device, or a server whose store was cleared — drops the app back to sign-in from one place
// instead of twenty-five call sites each deciding for themselves.
export function onUnauthorized(fn: () => void): void {
  unauthorizedHandler = fn;
}

interface RequestOptions {
  // What to say when the server sends no `error` of its own. The server's words win where it has any.
  fallback?: string;
  // Statuses that are a normal answer for this endpoint rather than a failure, handed back to the
  // caller as a Response. Only 409-means-something cases; never 401.
  allow?: number[];
}

// Every call in this module goes through here, and a non-ok response becomes a thrown ApiError in the
// same place. There is deliberately no bypass flag — a bypass is how the laundering came back.
//
// NOTHING ATTACHES A CREDENTIAL. It is an HttpOnly cookie; the browser sends it. `same-origin` is
// stated rather than left to the default because that default has changed over the fetch spec's life,
// and a request that silently omits the cookie is a board on which every button fails.
export async function request(
  url: string,
  init: RequestInit = {},
  opts: RequestOptions = {},
): Promise<Response> {
  // Captured before the call, so the 401 handler below can tell WHICH credential was refused.
  const held = signedIn();
  const generation = credentialGeneration();
  const res = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: { ...(init.headers as Record<string, string>) },
  });
  if (res.ok || opts.allow?.includes(res.status)) return res;
  const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
  if (res.status === 401 && held && credentialGeneration() === generation) discardCredential();
  throw new ApiError(res.status, body.error ?? opts.fallback ?? res.statusText, body.reason);
}

// A 401 only means "this browser's credential is no good" when the credential that was refused is
// still the one this browser holds. THE TWO CASES IT MUST NOT FIRE ON, both of which happened:
//
//   !held                  a request made while signing in. Five hooks fetch on mount, so five 401s
//                          were already in flight when the claim came back — and clearing on those
//                          threw away the credential the claim had just obtained, then started a
//                          fresh flow, which found the device store no longer empty and asked a
//                          person to approve the browser that had already signed itself in.
//   generation changed     a request that left before a newer credential arrived. Same shape: a late
//                          answer about an old token must not revoke the new one. Compared by
//                          GENERATION rather than by value, because the value is now unreadable —
//                          which is a better test anyway: it catches a replacement by an identical
//                          token, which a value comparison would call unchanged.
function discardCredential(): void {
  signOutLocally();
  unauthorizedHandler?.();
}

async function send<T>(method: 'POST' | 'PUT' | 'PATCH', url: string, body: unknown): Promise<T> {
  const res = await request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

export function post<T>(url: string, body: unknown): Promise<T> {
  return send<T>('POST', url, body);
}

export function put<T>(url: string, body: unknown): Promise<T> {
  return send<T>('PUT', url, body);
}

export function patch<T>(url: string, body: unknown): Promise<T> {
  return send<T>('PATCH', url, body);
}
