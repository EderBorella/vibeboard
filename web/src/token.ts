const KEY = 'vibeboard.token';

// The browser's credential. It arrives exactly once, in the `?token=` link the server prints when
// it starts, and lives in localStorage from then on — so a plain http://localhost:4610 works on
// every later visit from the same browser.
//
// It cannot be fetched from the server instead: an agent can reach loopback too, so any endpoint
// that hands out the token hands it to the agents the token exists to keep out. The one thing the
// browser has that they do not is the terminal the link was printed in.
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
