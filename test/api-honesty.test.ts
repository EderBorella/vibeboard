import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type StubbedBrowser, stubBrowser } from './browser-stubs.js';

// THE BUG THIS FILE EXISTS FOR. A browser with no credential opened the board and saw a working
// screen where every button failed: `getState` and five others read `res.json()` without ever
// checking `res.ok`, so a 401's `{ error: 'Unauthorized' }` was returned as if it were the answer.
// An empty project list is exactly what a fresh install looks like, so nothing on screen — and
// nothing in the code — could tell "you are not signed in" from "there is nothing here yet".
//
// The fix is in the wrapper every call already went through, not at the six call sites, so the
// dishonest shape is unreachable rather than merely corrected.

type Api = typeof import('../web/src/lib/api.js');
type Token = typeof import('../web/src/lib/token.js');

// api.ts memoises its unauthorized handler and token.ts memoises the URL read, so each test needs its
// own module registry — otherwise a 401 in one test signs out the browser the next one asserts on.
async function fresh(signedIn = true): Promise<{ api: Api; token: Token; browser: StubbedBrowser }> {
  vi.resetModules();
  const browser = stubBrowser({ signedIn });
  return {
    api: await import('../web/src/lib/api.js'),
    token: await import('../web/src/lib/token.js'),
    browser,
  };
}

// A credential arriving, as the server does it: the cookie comes back on the response, and the client
// is only TOLD. There is nothing for it to store — that was the per-tab state this change removes.
function credentialArrives(browser: StubbedBrowser, token: Token): void {
  browser.cookies.set('vb.in', '1');
  token.credentialArrived();
}

function answering(status: number, body: string): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

async function failure(call: () => Promise<unknown>): Promise<{ status?: number; message?: string }> {
  return call().then(
    () => ({}),
    (e: Error & { status?: number }) => ({ status: e.status, message: e.message }),
  );
}

describe('a reader does not return an error body as data', () => {
  beforeEach(() => {
    stubBrowser();
  });

  // The six that skipped the check. A table rather than one example: each was its own missing
  // `if`, and the wrapper is only proved by the whole set going through it.
  const readers: [string, (api: Api) => Promise<unknown>][] = [
    ['getState', (api) => api.getState()],
    ['listModels', (api) => api.listModels('opencode')],
    ['getModelStatus', (api) => api.getModelStatus('some/model')],
    ['listProjects', (api) => api.listProjects()],
    ['getSandbox', (api) => api.getSandbox()],
    ['getReadiness', (api) => api.getReadiness()],
  ];

  it.each(readers)('%s rejects with the status when the server says 401', async (_name, call) => {
    const { api } = await fresh();
    answering(401, '{"error":"Unauthorized"}');

    const err = await failure(() => call(api));

    expect(err.status).toBe(401);
    expect(err.message).toBe('Unauthorized');
  });

  it.each(readers)('%s still returns the body on 200', async (_name, call) => {
    // The other half of the same wrapper: a check that rejected everything would pass the test
    // above and break the app. `status` is absent from a success, so this cannot pass by throwing.
    const { api } = await fresh();
    answering(200, '{"status":{"up":true,"endpoints":1},"open":false}');

    await expect(call(api)).resolves.not.toBeUndefined();
  });

  it('prefers the server’s own words over the fallback copy', async () => {
    const { api } = await fresh();
    answering(500, '{"error":"the project moved"}');
    expect((await failure(() => api.listProjects())).message).toBe('the project moved');
  });

  it('falls back to its own copy when the server sends no error to quote', async () => {
    const { api } = await fresh();
    answering(500, 'not json at all');
    expect((await failure(() => api.listProjects())).message).toBe('Failed to list projects');
  });
});

describe('an endpoint whose 409 is a real answer', () => {
  beforeEach(() => {
    stubBrowser();
  });

  // `allow`, not a caught throw: deleting a non-empty folder is this endpoint's second normal
  // answer, and the tree asks the user a harder question about it. Moving the `res.ok` check into
  // the wrapper is what would have silently turned that into an error.
  it('reads a 409 from deleteFsEntry as not-empty rather than a failure', async () => {
    const { api } = await fresh();
    answering(409, '{"error":"not empty"}');
    await expect(api.deleteFsEntry('some/folder')).resolves.toBe('not-empty');
  });

  it('still throws on a 500 from the same endpoint', async () => {
    const { api } = await fresh();
    answering(500, '{"error":"disk went away"}');
    expect((await failure(() => api.deleteFsEntry('some/folder'))).status).toBe(500);
  });

  it('does not let the allowance leak to a 401', async () => {
    // `allow: [409]` on one endpoint must not make it the one place a 401 still passes for data.
    const { api } = await fresh();
    answering(401, '{"error":"Unauthorized"}');
    expect((await failure(() => api.deleteFsEntry('some/folder'))).status).toBe(401);
  });
});

describe('what a 401 does beyond throwing', () => {
  beforeEach(() => {
    stubBrowser();
  });

  it('fires onUnauthorized once and signs the browser out', async () => {
    const { api, token } = await fresh();
    let fired = 0;
    api.onUnauthorized(() => {
      fired += 1;
    });
    answering(401, '{"error":"Unauthorized"}');

    await failure(() => api.getState());

    expect(fired).toBe(1);
    expect(token.signedIn()).toBe(false);
  });

  it('does not fire it on any other failure', async () => {
    const { api, token } = await fresh();
    let fired = 0;
    api.onUnauthorized(() => {
      fired += 1;
    });
    answering(500, '{"error":"broken"}');

    await failure(() => api.getState());

    expect(fired).toBe(0);
    expect(token.signedIn()).toBe(true);
  });

  // THE BUG THAT REACHED THE USER. Five hooks fetch on mount, so five requests carrying NO credential
  // were already in flight when the silent claim came back with one. Each 401 cleared the token — the
  // one the claim had just obtained — and restarted sign-in, which now found the device store
  // non-empty and asked a person to approve the browser that had already signed itself in.
  it('does not sign out over a 401 for a request that carried no credential', async () => {
    const { api, token, browser } = await fresh(false); // signing in: nothing yet
    let fired = 0;
    api.onUnauthorized(() => {
      fired += 1;
    });
    // The 401 for that credential-less request arrives AFTER the claim has been answered.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        credentialArrives(browser, token);
        return new Response('{"error":"Unauthorized"}', { status: 401 });
      }),
    );

    await failure(() => api.getState());

    expect(token.signedIn()).toBe(true);
    expect(fired).toBe(0);
  });

  it('does not discard a NEWER credential over a 401 about the one it replaced', async () => {
    // The same shape without the empty case: a request that left before the credential changed must not
    // revoke the one that replaced it. The credential is unreadable now, so this is decided by the
    // GENERATION counter — which is a better test than the old value comparison, because it also catches
    // a replacement by an identical token.
    const { api, token, browser } = await fresh();
    let fired = 0;
    api.onUnauthorized(() => {
      fired += 1;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        credentialArrives(browser, token);
        return new Response('{"error":"Unauthorized"}', { status: 401 });
      }),
    );

    await failure(() => api.getState());

    expect(token.signedIn()).toBe(true);
    expect(fired).toBe(0);
  });

  it('still discards the credential that was actually refused', async () => {
    // The other half. A check that never cleared would pass both tests above and leave a revoked
    // browser sitting on a board where every button fails — which is where this all started.
    const { api, token } = await fresh();
    let fired = 0;
    api.onUnauthorized(() => {
      fired += 1;
    });
    answering(401, '{"error":"Unauthorized"}');

    await failure(() => api.getState());

    expect(token.signedIn()).toBe(false);
    expect(fired).toBe(1);
  });

  // A dropped connection and a refused credential are different problems with different remedies,
  // and treating one as the other would sign the user out of a board that is merely restarting.
  it('does not read a network failure as unauthenticated', async () => {
    const { api, token } = await fresh();
    let fired = 0;
    api.onUnauthorized(() => {
      fired += 1;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const err = await failure(() => api.getState());

    expect(err.status).toBeUndefined();
    expect(fired).toBe(0);
    expect(token.signedIn()).toBe(true);
  });
});

describe('the diary POST', () => {
  beforeEach(() => {
    stubBrowser();
  });

  // It sent no content-type, so a real server answered 415 and no test noticed: every caller-side
  // test of this function mocks web/src/lib/api.js at its boundary, so the request never left the process.
  it('sends a content-type, which is what Fastify refuses without', async () => {
    const { api } = await fresh();
    const fetchMock = answering(200, '{"entry":{"at":"2026-08-07T00:00:00.000Z","kind":"note","text":"x"}}');

    await api.addDiaryEntry({ kind: 'note', text: 'x' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });
});
