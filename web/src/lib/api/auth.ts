// ---- Signing in ------------------------------------------------------------
// The four `/auth/*` calls are the ones a browser with no credential makes, because they are how it
// gets one. They still go through `request` — there is no header to omit any more, and routing them
// anywhere else would be a second path to the network.
//
// Each of them answers with `Set-Cookie`, which the browser applies before this code sees the
// response. That is the whole transport: nothing here reads or stores a token.

import { post, request } from './http';

// Asks the server, over HTTP, whether this browser's credential still works — and does nothing with
// the answer, because `request()` already does it: a 401 there clears the credential and fires
// `onUnauthorized`, which restarts sign-in.
//
// It exists because A BROWSER CANNOT SEE WHY A WEBSOCKET HANDSHAKE FAILED. A refused upgrade arrives
// as close code 1006, byte-for-byte identical to "the server is not running", so a socket whose
// credential has been revoked retries for ever and the app never learns anything. HTTP is the only
// channel where the 401 is visible.
//
// It probes `/api/state` because any authenticated route would do and that one is cheap — it is filed
// with the credential it is about, not with the project route it borrows.
export async function probeCredential(): Promise<void> {
  await request('/api/state').catch(() => {});
}

export interface SigninRequestOpened {
  id: string;
  // What the approving browser will be shown, so this browser can display the same thing and the
  // user can match one against the other.
  label: string;
  address: string;
}

export type SigninCollected =
  | { state: 'pending' }
  | { state: 'refused' }
  | { state: 'approved'; token: string }
  | { state: 'expired' };

export async function claimSignin(): Promise<{ token: string }> {
  return (await request('/auth/claim', { method: 'POST' })).json();
}

// Hands the server a credential this browser already holds — from a `?token=` launch URL, the
// documented recovery route, or from localStorage where the pre-cookie version left it — so it can be
// set as a cookie. Without this, a browser that was already signed in before the transport changed
// would claim, be told a device already exists, and sit waiting for an approval nobody can give.
export async function adoptCredential(token: string): Promise<void> {
  await request('/auth/adopt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

export async function requestSignin(): Promise<SigninRequestOpened> {
  return (await request('/auth/request', { method: 'POST' })).json();
}

export async function collectSignin(id: string): Promise<SigninCollected> {
  return (await request(`/auth/request/${encodeURIComponent(id)}`)).json();
}

// Whether the chat copilot may use the API for this conversation. The server owns the credential and
// its lifetime; this only asks for it to be minted or revoked.
export async function setAuthority(enabled: boolean): Promise<{ authorised: boolean }> {
  return post('/api/copilot/authority', { enabled });
}

// Fix board: the server opens a new conversation, grants it `repair` for one turn and starts that turn, then
// answers with the conversation's id. Nothing here grants anything — there is no call that elevates an
// existing conversation, which is why this is one request rather than the socket's three verbs.
export async function fixBoard(): Promise<{ chat: string }> {
  return post('/api/copilot/fix-board', {});
}

export interface SigninDevice {
  id: string;
  label: string;
  address: string;
  created: string;
  lastSeen: string;
}

export interface SigninPending {
  id: string;
  label: string;
  address: string;
  at: string;
}

export interface SigninState {
  devices: SigninDevice[];
  // Which row is this browser. Null for a caller holding the admin token, which belongs to no device.
  thisDevice: string | null;
  pending: SigninPending[];
}

export async function getSigninState(): Promise<SigninState> {
  return (await request('/api/signin', {}, { fallback: 'Failed to read the sign-in state' })).json();
}

export function approveSignin(id: string): Promise<{ ok: true }> {
  return post(`/api/signin/approve/${encodeURIComponent(id)}`, {});
}

export function refuseSignin(id: string): Promise<{ ok: true }> {
  return post(`/api/signin/refuse/${encodeURIComponent(id)}`, {});
}

export async function revokeDevice(id: string): Promise<void> {
  await request(
    `/api/signin/devices/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    { fallback: 'Failed to sign that browser out' },
  );
}

// Signs every browser out, this one included, and re-opens the silent first claim — so the next page
// load on this machine signs itself in again. This is "regenerate the token", without a restart.
export function signOutEverything(): Promise<{ ok: true }> {
  return post('/api/signin/clear', {});
}
