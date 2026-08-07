// What this browser knows about being signed in — which is deliberately almost nothing.
//
// THE CREDENTIAL IS NOT HERE ANY MORE. It is an `HttpOnly` cookie the server sets during sign-in and
// the browser attaches to `/api` and to the `/ws` handshake by itself; page JS cannot read it, so
// nothing in this module can hand it out. See src/server/cookies.ts for why, but the short version is
// that a credential in `localStorage` plus a per-page memo is PER-TAB state, and one tab holding a
// permanently-wrong credential is what made a page load take a minute to connect.
//
// Mirrors `HINT_COOKIE` in src/server/cookies.ts across the Vite/tsc boundary, the way ./shared
// mirrors the core types. test/cookies.test.ts asserts the two are the same string, because a mirror
// nobody checks is a mirror that drifts.
const HINT_COOKIE = 'vb.in';

// The pre-cookie storage key. Read once, to hand the value to `/auth/adopt` so a browser that was
// already signed in does not land on "waiting for approval" with nobody able to approve it. Delete
// this and the key when the release after next goes out.
const LEGACY_KEY = 'vibeboard.token';

// Carries no secret: it says only that a credential exists. Forging it grants nothing — the server
// never reads it, and a forged one only renders a board whose every call 401s.
//
// Read fresh every time, with no memo. The memo was the other half of the per-tab problem: it let one
// page keep serving a value the rest of the browser had replaced.
export function signedIn(): boolean {
  return readCookie(HINT_COOKIE) === '1';
}

function readCookie(name: string): string {
  for (const pair of (typeof document === 'undefined' ? '' : document.cookie).split(';')) {
    const eq = pair.indexOf('=');
    if (eq !== -1 && pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return '';
}

// A credential this browser holds from before the cookie transport existed, or one handed to it in a
// launch URL — the documented recovery route when every device has been signed out. Either way it is
// POSTed to `/auth/adopt`, which sets the cookie; nothing here stores it.
//
// MEMOISED, and it has to be: the read REWRITES the address bar, so a second caller would find nothing
// and fall through to localStorage. Two callers is the normal case — the effect that decides whether to
// sign in at all, and the flow it starts.
let fromUrl: string | undefined;

function urlToken(): string {
  if (fromUrl !== undefined) return fromUrl;
  const url = new URL(location.href);
  fromUrl = url.searchParams.get('token') ?? '';
  if (fromUrl) {
    // A credential left in the address bar survives in bookmarks, screen shares and history, and this
    // one has no expiry.
    url.searchParams.delete('token');
    history.replaceState(null, '', url.toString());
  }
  return fromUrl;
}

export function legacyToken(): string {
  return urlToken() || (localStorage.getItem(LEGACY_KEY) ?? '');
}

// Both halves, or the flow retries a credential it has already been refused on every load.
export function forgetLegacyToken(): void {
  fromUrl = '';
  localStorage.removeItem(LEGACY_KEY);
}

// Told whenever the credential appears, changes or goes away.
//
// It exists because the WEBSOCKET CANNOT POLL FOR ONE. It declines to open without a credential — the
// server refuses the upgrade anyway — and at that point it has nothing to retry, so it needs to be
// woken. Routing that through React state made it depend on a `false → true` flip being observable,
// and inside a single batch it is not: sign-in clearing a dead credential and obtaining a new one can
// leave `signedIn` looking unchanged, and the socket then waited for something unrelated to rebind it.
// One page load took eighty-three seconds to connect that way.
const listeners = new Set<() => void>();

export function onCredentialChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Bumped by every change. It replaces the value comparison `api.ts` used to do around a 401, which is
// no longer possible now that the credential is unreadable — and it is strictly better at the job: it
// tells "the credential that was refused is still the one we hold" from "a newer one arrived while
// that request was in flight" without needing to know either value.
let generation = 0;

export function credentialGeneration(): number {
  return generation;
}

function announce(): void {
  generation += 1;
  for (const listener of listeners) listener();
}

// The server set the cookies as it answered; this only tells the app. There is nothing to write, which
// is the point — the old `setToken` had to update two places and a bug in the second one left every
// request in the page's life carrying the previous value.
export function credentialArrived(): void {
  announce();
}

// Clears the HINT only, because the credential cookie is `HttpOnly` and this side genuinely cannot
// touch it. That is enough: the routes that really end a session (`/api/signin/clear`, revoking this
// browser) clear both from the server, and this path exists for the 401 case, where the credential the
// browser still holds is already dead.
export function signOutLocally(): void {
  // biome-ignore lint/suspicious/noDocumentCookie: the rule wants the CookieStore API, which Firefox does not implement — and Firefox is the browser this whole change was debugged in
  document.cookie = `${HINT_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0`;
  announce();
}
