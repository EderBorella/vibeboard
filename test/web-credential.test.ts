import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createControlFile, getState, patchConfig, putSkill } from '../web/src/api.js';
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

  // Through a fresh module registry: token.ts memoises, and the first test in this file already
  // populated the memo — so read through the module-scope import this was asserting the cache, not
  // the fallback it is named for.
  it('falls back to the stored token when the URL carries none', async () => {
    vi.resetModules();
    stubBrowser(); // search: '' — nothing in the URL to read
    const { authToken: fresh } = await import('../web/src/token.js');
    expect(fresh()).toBe(STUB_TOKEN);
  });

  // One call site out of twenty-five was exercised, and the file's own comment claimed all of them.
  // Testing one more proved nothing either: the twenty-five reach the network through four helpers,
  // so it is the four that have to be held, not four of the twenty-five. Breaking any one of them
  // now fails here.
  it.each([
    ['post', () => createControlFile('docs')],
    ['put', () => putSkill('execute', { name: 'x', description: 'd', boards: [], columns: [], prompt: 'p' })],
    ['patch', () => patchConfig({ name: 'renamed' })],
    ['a bare read', () => getState()],
  ])('sends the credential through %s', async (_shape, call) => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await call();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${STUB_TOKEN}`);
  });

  it('does not eat the caller’s own headers on the way past', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await patchConfig({ name: 'renamed' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });
});
