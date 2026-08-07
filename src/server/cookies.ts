// The browser's credential, as a cookie.
//
// It used to ride in the WebSocket URL as `?token=`, which every reference on the subject warns
// against — and the proof that the cost is real rather than theoretical is `stripSecrets()` in
// logging.ts: a redaction that exists only because the credential is in a URI, and which had to be
// extended twice after a test found a leak the design had not.
//
// The other half is worse. A browser cannot read the status of a refused handshake — a 401'd upgrade
// arrives as close code 1006, byte-for-byte identical to "the server is not running" — so a tab
// holding a credential that can never work retries for ever. `localStorage` plus a per-page memo is
// PER-TAB state, so that tab keeps its wrong credential indefinitely, and Firefox's per-host
// fail-delay grows to a 60-second ceiling while the waiting channel still holds the
// one-connection-per-host admission slot. A good tab's handshake then does not reach the network for
// a minute or two. A cookie is SHARED browser state: the stale tab sends whatever the current
// credential is and its handshake succeeds, so no tab can sit failing and no delay accumulates.
//
// Written here rather than adding `@fastify/cookie`: this needs one header out and one header in, and
// a dependency for two ten-line pure functions is more surface than substance.

// `vb` carries the credential and is HttpOnly, so page JS cannot read it.
export const CREDENTIAL_COOKIE = 'vb';
// `vb.in` carries no secret and exists only so the page can answer "am I signed in?" synchronously,
// without a round trip in front of the first render. Forging it grants nothing — the server never
// reads it, and a forged one only makes this browser render a board whose every call 401s.
export const HINT_COOKIE = 'vb.in';

export const CROSS_ORIGIN = 'Cross-origin request refused';

// A year. The credential itself has no expiry — a shorter cookie would only mean signing in again for
// no gain in authority, since the server-side device record is what revocation acts on.
const YEAR_S = 31_536_000;

interface CookieOptions {
  httpOnly?: boolean;
  // Seconds. Zero (with the epoch expiry below) is how a cookie is deleted.
  maxAgeS?: number;
}

// `Path=/` and `SameSite=Strict` are not options, because neither may vary: the cookie has to reach
// `/ws`, `/api` and `/auth` alike, and Strict is the first of the three CSRF defences.
//
// `Secure` is deliberately ABSENT. The board is served over plain HTTP on a LAN, and `Secure` would
// stop the browser sending the cookie at all — the sign-in would appear to succeed and every request
// after it would 401. This looks like an omission and is not.
export function serialiseCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const maxAge = opts.maxAgeS ?? YEAR_S;
  const parts = [`${name}=${value}`, 'Path=/', 'SameSite=Strict', `Max-Age=${maxAge}`];
  // Max-Age alone is enough for every browser in use, but a deletion is worth stating twice: a cookie
  // the server thinks it cleared and the browser kept is the poisoned state this whole change removes.
  if (maxAge === 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (opts.httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

// The two always move together, so there is no call site that can set one and forget the other.
export function credentialCookies(token: string): string[] {
  return [serialiseCookie(CREDENTIAL_COOKIE, token, { httpOnly: true }), serialiseCookie(HINT_COOKIE, '1')];
}

// Both, for the same reason. Clearing only the credential leaves a page that believes it is signed in
// and whose every call fails; clearing only the hint leaves the browser still presenting a credential
// the server has forgotten, which is precisely the state that poisons the host.
export function clearedCookies(): string[] {
  return [
    serialiseCookie(CREDENTIAL_COOKIE, '', { httpOnly: true, maxAgeS: 0 }),
    serialiseCookie(HINT_COOKIE, '', { maxAgeS: 0 }),
  ];
}

// Fastify accumulates repeated `set-cookie` headers into a list; one call per value rather than an
// array, so this does not depend on that behaviour.
export function attachCookies(
  reply: { header: (name: string, value: string) => unknown },
  values: string[],
): void {
  for (const value of values) reply.header('set-cookie', value);
}

// One name out of a Cookie header. Split on the FIRST `=` only: a value is allowed to contain them,
// and a parser that splits on every one silently truncates the credential to nothing recognisable.
export function readCookie(header: string | undefined, name: string): string {
  for (const pair of (header ?? '').split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== name) continue;
    return pair.slice(eq + 1).trim();
  }
  return '';
}
