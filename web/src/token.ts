const KEY = 'vibeboard.token';

// The browser's credential, kept in localStorage so a plain http://localhost:4610 works on every
// later visit from the same browser. It is obtained by the sign-in flow in ./signin and the user
// never sees or handles it — see the comment there for why an endpoint may hand one out at all,
// which is not obvious given that an agent can reach loopback too.
//
// `?token=` remains an accepted ingestion path for the admin token in ~/.vibeboard/token: the
// documented recovery route when every device has been signed out and the loopback claim is not
// reachable. Nothing prints it any more.
function read(): string {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get('token');
  if (!fromUrl) return localStorage.getItem(KEY) ?? '';
  localStorage.setItem(KEY, fromUrl);
  // Stripped from the address bar straight away. A credential in a URL survives in bookmarks,
  // screen shares and browser history, and this one has no expiry.
  url.searchParams.delete('token');
  history.replaceState(null, '', url.toString());
  return fromUrl;
}

let cached: string | undefined;

export function authToken(): string {
  cached ??= read();
  return cached;
}

export function authHeader(): Record<string, string> {
  const token = authToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export function hasToken(): boolean {
  return authToken() !== '';
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

function announce(): void {
  for (const listener of listeners) listener();
}

// Writes BOTH halves. The memo is what `authToken` serves, so a setter that only reached
// localStorage would leave every request in this page's life carrying the previous value — and the
// one that matters is the request immediately after signing in.
export function setToken(token: string): void {
  cached = token;
  localStorage.setItem(KEY, token);
  announce();
}

// `cached = ''` rather than `undefined`: `??=` above would re-read localStorage on the next call,
// and on a 401 the point is that this browser has no credential until it signs in again.
export function clearToken(): void {
  cached = '';
  localStorage.removeItem(KEY);
  announce();
}
