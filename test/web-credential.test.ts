import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getState } from '../web/src/api.js';
import { authToken } from '../web/src/token.js';
import { STUB_TOKEN, stubBrowser } from './browser-stubs.js';

// The client half of the boundary. Every call in web/src/api.ts goes through one wrapper, so this
// covers all of them: what it proves is that the wrapper attaches the credential at all.

describe('the browser attaches its credential', () => {
  beforeEach(() => {
    stubBrowser();
  });

  it('sends the stored token as a bearer header', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await getState();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${STUB_TOKEN}`);
  });

  it('reads the token from the launch URL and takes it out of the address bar', () => {
    // A credential left in the address bar survives in bookmarks, screen shares and history, and
    // this one does not expire.
    const store = new Map<string, string>();
    const replaced: string[] = [];
    vi.stubGlobal('location', {
      host: 'localhost:4610',
      href: 'http://localhost:4610/?token=from-the-link',
      pathname: '/',
      search: '?token=from-the-link',
    });
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    vi.stubGlobal('history', { replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) });
    // The module memoises, so this has to run in its own module registry.
    vi.resetModules();

    return import('../web/src/token.js').then(({ authToken: fresh }) => {
      expect(fresh()).toBe('from-the-link');
      expect(store.get('vibeboard.token')).toBe('from-the-link');
      expect(replaced).toEqual(['http://localhost:4610/']);
    });
  });

  it('falls back to the stored token when the URL carries none', () => {
    expect(authToken()).toBe(STUB_TOKEN);
  });
});
