import { vi } from 'vitest';

// Browser globals the web modules genuinely use, stubbed together rather than one field at a time.
// `location: { host }` alone was enough until the client had a credential to read; a partial stub
// of a browser API breaks the moment production code touches a field nobody thought to fake.
//
// `document.cookie` is now the interesting one: the credential is an HttpOnly cookie the server sets,
// and the only thing the page can see is the `vb.in` HINT. So a stub with a real cookie jar — a getter
// and a setter, not a string — because the client both reads it and deletes it, and a jar that ignores
// `Max-Age=0` would make a sign-out look like it worked.
//
// Deliberately not in ./helpers: that module imports the Fastify app, and these tests have no
// business loading a server.

export const STUB_TOKEN = 'browser-token';

export interface StubbedBrowser {
  // The jar behind `document.cookie`. Assert on it rather than on the string where the point is which
  // cookie exists.
  cookies: Map<string, string>;
  storage: Map<string, string>;
  // Every URL `history.replaceState` was given, so the address-bar rewrite is checkable.
  replaced: string[];
}

export function stubBrowser(
  opts: {
    // Whether this browser already holds a credential. The hint cookie is what says so — there is no
    // readable token any more.
    signedIn?: boolean;
    // A pre-cookie credential in localStorage, or one in the launch URL. Both are adopted, not used.
    legacy?: string;
    href?: string;
  } = {},
): StubbedBrowser {
  const cookies = new Map<string, string>();
  if (opts.signedIn ?? true) cookies.set('vb.in', '1');
  const storage = new Map<string, string>();
  if (opts.legacy) storage.set('vibeboard.token', opts.legacy);
  const replaced: string[] = [];
  const href = opts.href ?? 'http://localhost:4610/';

  vi.stubGlobal('location', {
    host: 'localhost:4610',
    href,
    pathname: '/',
    search: new URL(href).search,
  });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
  vi.stubGlobal('history', {
    replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url),
  });
  const jar = {
    get cookie(): string {
      return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(raw: string) {
      const [pair, ...attrs] = raw.split(';');
      const eq = (pair ?? '').indexOf('=');
      if (eq === -1) return;
      const name = (pair ?? '').slice(0, eq).trim();
      const value = (pair ?? '').slice(eq + 1).trim();
      // A real browser deletes on Max-Age=0 (or a past Expires). Honouring it is what makes a stubbed
      // sign-out mean anything.
      if (value === '' || /max-age\s*=\s*0\b/i.test(attrs.join(';'))) cookies.delete(name);
      else cookies.set(name, value);
    },
  };

  // UNDER JSDOM THERE IS A REAL DOCUMENT, and replacing it wholesale breaks every render: React reaches
  // for `document.body`, and this stub has none. So only the `cookie` accessor is swapped, leaving the
  // rest of the DOM intact — which is also the honest shape, since a cookie jar is all this fakes.
  // (Twelve component tests failed exactly this way when the whole object was stubbed.)
  if (typeof document === 'undefined') vi.stubGlobal('document', jar);
  else
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => jar.cookie,
      set: (raw: string) => {
        jar.cookie = raw;
      },
    });

  return { cookies, storage, replaced };
}
