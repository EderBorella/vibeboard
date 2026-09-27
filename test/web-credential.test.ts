import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createControlFile, getState, patchConfig, putSkill } from '../web/src/lib/api.js';
import { STUB_TOKEN, stubBrowser } from './browser-stubs.js';

// The client half of the boundary. Every call in web/src/lib/api.ts goes through one wrapper, so this
// covers all of them — and what it proves has changed: the wrapper must attach NO credential and must
// ask for the cookie to be sent.
//
// A `Bearer` header from the browser is now a defect, not a feature. It was the transport that put a
// permanent credential in the WebSocket URL, and the redaction in the server's logging exists only
// because of it.

describe('the browser sends no credential of its own', () => {
  beforeEach(() => {
    stubBrowser();
  });

  it.each([
    ['post', () => createControlFile('docs')],
    [
      'put',
      () =>
        putSkill('execute', {
          name: 'x',
          description: 'd',
          boards: [],
          columns: [],
          prompt: 'p',
          autopilotOnly: false,
          moveOnSuccess: true,
        }),
    ],
    ['patch', () => patchConfig({ name: 'renamed' })],
    ['a bare read', () => getState()],
  ])('sends the cookie and no Authorization header through %s', async (_shape, call) => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await call();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // Stated rather than left to the default, because that default has changed over the fetch spec's
    // life and a request that silently omits the cookie is a board on which every button fails.
    expect(init.credentials).toBe('same-origin');
    expect(init.headers as Record<string, string>).not.toHaveProperty('authorization');
  });

  it('does not eat the caller’s own headers on the way past', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await patchConfig({ name: 'renamed' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });
});

// G10: what the page may know is that a credential EXISTS, never what it is. Every one of these runs in
// its own module registry, because token.ts memoises the URL read — it rewrites the address bar, so a
// second read would find nothing.
describe('what the page can tell about being signed in', () => {
  it('reads the hint cookie, and exposes no way to read the credential', async () => {
    vi.resetModules();
    stubBrowser({ signedIn: true });
    const mod = await import('../web/src/lib/token.js');

    expect(mod.signedIn()).toBe(true);
    // The credential is HttpOnly, so it is not in `document.cookie` at all — and nothing in this module
    // returns a token. A `authToken()` here would be the transport coming back.
    expect(document.cookie).not.toContain(STUB_TOKEN);
    expect(Object.keys(mod)).not.toContain('authToken');
  });

  it('is not signed in without the hint', async () => {
    vi.resetModules();
    stubBrowser({ signedIn: false });
    const { signedIn } = await import('../web/src/lib/token.js');
    expect(signedIn()).toBe(false);
  });

  // The hint is not a credential, so a forged one is not an escalation — but it must not be READ as one
  // either: anything other than the exact value the server sets is not a sign-in.
  it('treats a hint with any other value as not signed in', async () => {
    vi.resetModules();
    const browser = stubBrowser({ signedIn: false });
    browser.cookies.set('vb.in', 'yes');
    const { signedIn } = await import('../web/src/lib/token.js');
    expect(signedIn()).toBe(false);
  });

  it('does not confuse a cookie whose name merely starts the same', async () => {
    vi.resetModules();
    const browser = stubBrowser({ signedIn: false });
    browser.cookies.set('vb', 'the-credential');
    browser.cookies.set('vb.inbox', '1');
    const { signedIn } = await import('../web/src/lib/token.js');
    expect(signedIn()).toBe(false);
  });

  it('signing out locally drops the hint and bumps the generation', async () => {
    vi.resetModules();
    const browser = stubBrowser({ signedIn: true });
    const { signedIn, signOutLocally, credentialGeneration } = await import('../web/src/lib/token.js');
    const before = credentialGeneration();

    signOutLocally();

    expect(signedIn()).toBe(false);
    expect(browser.cookies.has('vb.in')).toBe(false);
    expect(credentialGeneration()).toBeGreaterThan(before);
  });
});

// G11: the `?token=` recovery route and the upgrade from the pre-cookie release. Neither stores the
// value — both hand it to /auth/adopt, which is the only thing that can set the cookie.
describe('a credential this browser already holds', () => {
  it('is read out of the launch URL and taken out of the address bar', async () => {
    vi.resetModules();
    const browser = stubBrowser({ signedIn: false, href: 'http://localhost:4610/?token=from-the-link' });
    const { legacyToken } = await import('../web/src/lib/token.js');

    expect(legacyToken()).toBe('from-the-link');
    expect(browser.replaced).toEqual(['http://localhost:4610/']);
    // Nowhere else. The old version wrote it to localStorage on the way past, which is the storage this
    // whole change removes.
    expect(browser.storage.size).toBe(0);
  });

  // THE READ REWRITES THE URL, so it has to be memoised: two callers is the normal case — the effect
  // that decides whether to sign in, and the flow it starts. Un-memoised, the second found nothing and
  // the browser sat waiting for an approval only it could give.
  it('answers the same on a second read', async () => {
    vi.resetModules();
    stubBrowser({ signedIn: false, href: 'http://localhost:4610/?token=from-the-link' });
    const { legacyToken } = await import('../web/src/lib/token.js');

    expect(legacyToken()).toBe('from-the-link');
    expect(legacyToken()).toBe('from-the-link');
  });

  it('falls back to the pre-cookie localStorage key', async () => {
    vi.resetModules();
    stubBrowser({ signedIn: false, legacy: STUB_TOKEN });
    const { legacyToken } = await import('../web/src/lib/token.js');
    expect(legacyToken()).toBe(STUB_TOKEN);
  });

  it('forgets both halves, so a refused credential is not retried on every load', async () => {
    vi.resetModules();
    const browser = stubBrowser({
      signedIn: false,
      legacy: STUB_TOKEN,
      href: 'http://localhost:4610/?token=from-the-link',
    });
    const { legacyToken, forgetLegacyToken } = await import('../web/src/lib/token.js');
    expect(legacyToken()).toBe('from-the-link');

    forgetLegacyToken();

    expect(legacyToken()).toBe('');
    expect(browser.storage.has('vibeboard.token')).toBe(false);
  });

  it('is absent on an ordinary load', async () => {
    vi.resetModules();
    stubBrowser();
    const { legacyToken } = await import('../web/src/lib/token.js');
    expect(legacyToken()).toBe('');
  });
});
