import { vi } from 'vitest';

// Browser globals the web modules genuinely use, stubbed together rather than one field at a time.
// `location: { host }` alone was enough until the client had a credential to read; a partial stub
// of a browser API breaks the moment production code touches a field nobody thought to fake.
//
// Deliberately not in ./helpers: that module imports the Fastify app, and these tests have no
// business loading a server.

export const STUB_TOKEN = 'browser-token';

export function stubBrowser(): void {
  const store = new Map<string, string>([['vibeboard.token', STUB_TOKEN]]);
  vi.stubGlobal('location', {
    host: 'localhost:4610',
    href: 'http://localhost:4610/',
    pathname: '/',
    search: '',
  });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  vi.stubGlobal('history', { replaceState: () => {} });
}
