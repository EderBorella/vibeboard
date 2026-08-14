import type { FastifyInstance } from 'fastify';
import { describe, expect, it, onTestFinished } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../src/server/app.js';
import { sameOrigin } from '../src/server/auth/auth.js';
import { CREDENTIAL_COOKIE, HINT_COOKIE } from '../src/server/auth/cookies.js';
import { CredentialStore } from '../src/server/auth/credentials.js';
import { DeviceStore } from '../src/server/auth/devices.js';
import { ProjectSession } from '../src/server/boards/session.js';
import { tempDir } from './helpers.js';

// THE COOKIE TRANSPORT AT THE BOUNDARY, and every request here presents exactly what the test gives
// it.
//
// `testApp` in ./helpers injects an `Authorization` header onto every request, so a cookie test built
// on it would pass while actually authenticating as a bearer — the same trap that would have made the
// unauthenticated sign-in tests worthless. Hence `buildApp` directly, the way auth.test.ts does.

const ADMIN = 'admin-token';
const admin = { authorization: `Bearer ${ADMIN}` };
const ORIGIN = 'http://localhost:4610';

async function open(): Promise<{ app: FastifyInstance; store: CredentialStore; devices: DeviceStore }> {
  const session = new ProjectSession();
  const devices = DeviceStore.inMemory();
  const store = new CredentialStore(ADMIN, devices);
  const app = buildApp(session, { credentials: store, devices, logger: false });
  const root = await tempDir();
  onTestFinished(async () => {
    await app.close();
    await session.close();
  });
  await app.inject({
    method: 'POST',
    url: '/api/project/scaffold',
    headers: admin,
    payload: { path: root, name: 'A', mode: 'greenfield' },
  });
  return { app, store, devices };
}

// Cookies as a browser sends them: one header, the hint alongside the credential, because that is what
// the server will actually receive and a test that sent only `vb` would not notice a parser that broke
// on the pair.
const jar = (token: string): Record<string, string> => ({
  cookie: `${HINT_COOKIE}=1; ${CREDENTIAL_COOKIE}=${token}`,
  origin: ORIGIN,
  host: 'localhost:4610',
});

describe('a browser authenticating by cookie', () => {
  // G1. The whole point: no Authorization header anywhere, and the board loads.
  it('is let in with no Authorization header at all', async () => {
    const { app } = await open();
    const res = await app.inject({ url: '/api/state', headers: jar(ADMIN) });
    expect(res.statusCode).toBe(200);
  });

  it('is refused with no credential of any kind', async () => {
    const { app } = await open();
    const res = await app.inject({ url: '/api/state' });
    expect(res.statusCode).toBe(401);
  });

  it('is refused when the cookie holds a credential the server does not know', async () => {
    const { app } = await open();
    const res = await app.inject({ url: '/api/state', headers: jar('not-a-credential') });
    expect(res.statusCode).toBe(401);
  });

  // A device credential, not the admin token — the ordinary case for every browser after the first.
  it('works for a signed-in device', async () => {
    const { app, devices } = await open();
    const { token } = await devices.add('Firefox', '192.168.0.31');
    expect((await app.inject({ url: '/api/state', headers: jar(token) })).statusCode).toBe(200);
  });

  // The hint is not authority. Forging it grants nothing, and it must not be readable as a credential.
  it('is refused when only the hint is present', async () => {
    const { app } = await open();
    const res = await app.inject({
      url: '/api/state',
      headers: { cookie: `${HINT_COOKIE}=1`, origin: ORIGIN, host: 'localhost:4610' },
    });
    expect(res.statusCode).toBe(401);
  });

  // An explicitly presented credential is the one that is judged, so a caller cannot send a bad bearer
  // and quietly succeed as whoever holds the cookie.
  it('does not fall back to the cookie when a bad bearer is presented', async () => {
    const { app } = await open();
    const res = await app.inject({
      url: '/api/state',
      headers: { ...jar(ADMIN), authorization: 'Bearer wrong' },
    });
    expect(res.statusCode).toBe(401);
  });
});

// G3 IS THE MISTAKE THAT WOULD BREAK EVERY RUN. An agent sends `Authorization` and no `Origin` at all,
// so an Origin check applied to every request refuses every dispatch in the project — and it would look
// like an agent problem, not an auth problem.
describe('an agent authenticating by bearer', () => {
  it('succeeds with no Origin header', async () => {
    const { app } = await open();
    const res = await app.inject({ url: '/api/state', headers: admin });
    expect(res.statusCode).toBe(200);
  });

  it('succeeds on a write with no Origin header', async () => {
    const { app } = await open();
    const res = await app.inject({
      method: 'POST',
      url: '/api/log',
      headers: { ...admin, 'content-type': 'application/json' },
      payload: { kind: 'note', text: 'from a run' },
    });
    // Whatever the route answers, it is NOT a cross-origin refusal.
    expect(res.statusCode).not.toBe(403);
  });

  // And a foreign Origin is fine on the bearer path: an agent's HTTP client is entitled to send one,
  // and it is not a browser being steered by another site.
  it('succeeds even with a foreign Origin, because it presented a credential itself', async () => {
    const { app } = await open();
    const res = await app.inject({
      url: '/api/state',
      headers: { ...admin, origin: 'http://evil.example', host: 'localhost:4610' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('cross-origin requests on the cookie path', () => {
  // G4. A cookie is attached automatically, which is the one thing a bearer is not.
  it('refuses a POST from another origin', async () => {
    const { app } = await open();
    const res = await app.inject({
      method: 'POST',
      url: '/api/log',
      headers: { ...jar(ADMIN), origin: 'http://evil.example', 'content-type': 'application/json' },
      payload: { kind: 'note', text: 'not mine' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/cross-origin/i);
  });

  it('refuses a GET from another origin too', async () => {
    const { app } = await open();
    const res = await app.inject({
      url: '/api/state',
      headers: { ...jar(ADMIN), origin: 'http://evil.example' },
    });
    expect(res.statusCode).toBe(403);
  });

  // G5. A top-level navigation sends no Origin, and neither does a same-origin GET in Chrome. Refusing
  // an absent one outright would mean the board never loads.
  it('allows a GET with no Origin, which is what a navigation looks like', async () => {
    const { app } = await open();
    const res = await app.inject({
      url: '/api/state',
      headers: { cookie: `${CREDENTIAL_COOKIE}=${ADMIN}`, host: 'localhost:4610' },
    });
    expect(res.statusCode).toBe(200);
  });

  // But an absent Origin is not a licence to mutate.
  it('refuses a cookie-authenticated POST with no Origin', async () => {
    const { app } = await open();
    const res = await app.inject({
      method: 'POST',
      url: '/api/log',
      headers: {
        cookie: `${CREDENTIAL_COOKIE}=${ADMIN}`,
        host: 'localhost:4610',
        'content-type': 'application/json',
      },
      payload: { kind: 'note', text: 'no origin' },
    });
    expect(res.statusCode).toBe(403);
  });
});

// The predicate on its own, because the interesting cases are the ones a route test cannot construct
// cleanly — and because getting `null` or a port mismatch wrong is a silent hole rather than a failure.
describe('sameOrigin', () => {
  const req = (method: string, origin?: string, host = 'localhost:4610') => ({
    method,
    headers: { ...(origin === undefined ? {} : { origin }), host },
  });

  it('accepts an Origin whose host matches, port included', () => {
    expect(sameOrigin(req('POST', 'http://localhost:4610'))).toBe(true);
  });

  it('refuses a different port on the same hostname', () => {
    // A page on another port is another origin, and on a dev box it is the likeliest attacker.
    expect(sameOrigin(req('POST', 'http://localhost:5173'))).toBe(false);
  });

  it('refuses a different hostname', () => {
    expect(sameOrigin(req('POST', 'http://evil.example'))).toBe(false);
  });

  it('refuses the literal `null` a sandboxed frame sends', () => {
    expect(sameOrigin(req('POST', 'null'))).toBe(false);
    expect(sameOrigin(req('GET', 'null'))).toBe(false);
  });

  it('refuses an unparseable Origin rather than throwing', () => {
    expect(sameOrigin(req('GET', '://'))).toBe(false);
  });

  it('allows an absent Origin only for a read', () => {
    expect(sameOrigin(req('GET', undefined))).toBe(true);
    expect(sameOrigin(req('HEAD', undefined))).toBe(true);
    expect(sameOrigin(req('POST', undefined))).toBe(false);
    expect(sameOrigin(req('DELETE', undefined))).toBe(false);
    expect(sameOrigin(req('PATCH', undefined))).toBe(false);
  });

  // An empty Origin is absent, not present-and-empty: `new URL('')` throws, so a truthiness test is
  // what keeps this out of the catch and on the GET/HEAD branch.
  it('treats an empty Origin as absent', () => {
    expect(sameOrigin(req('GET', ''))).toBe(true);
    expect(sameOrigin(req('POST', ''))).toBe(false);
  });
});

// The socket, over a real listening server: `inject` cannot perform an upgrade, and the handshake is
// the request that used to carry the credential in its URL.
describe('the /ws handshake', () => {
  // `origin` is derived from the port the server actually got, not written down: the Origin check
  // compares against the Host header the handshake carries, and a hard-coded one would only ever
  // exercise the refusal branch — which is how a broken accept branch hides.
  async function listening(): Promise<{ address: string; origin: string; devices: DeviceStore }> {
    const { app, devices } = await open();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    return { address: `ws://127.0.0.1:${port}/ws`, origin: `http://127.0.0.1:${port}`, devices };
  }

  function handshake(address: string, headers: Record<string, string>): Promise<number | 'open'> {
    const ws = new WebSocket(address, { headers });
    return new Promise((resolve) => {
      ws.on('open', () => {
        ws.close();
        resolve('open');
      });
      // `ws` surfaces a refused upgrade as this event, with the status — the one thing a BROWSER cannot
      // see, which is why the client still has to ask over HTTP.
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('error', () => resolve(0));
    });
  }

  // G2's server half: the credential arrives as a cookie on the upgrade, with no query string.
  it('upgrades on a cookie alone', async () => {
    const { address, origin } = await listening();
    expect(await handshake(address, { cookie: `${CREDENTIAL_COOKIE}=${ADMIN}`, origin })).toBe('open');
  });

  // A signed-in device, which is what every browser after the first holds.
  it('upgrades on a device’s cookie', async () => {
    const { address, origin, devices } = await listening();
    const { token } = await devices.add('Firefox', '192.168.0.31');
    expect(await handshake(address, { cookie: `${CREDENTIAL_COOKIE}=${token}`, origin })).toBe('open');
  });

  it('refuses an upgrade with no credential', async () => {
    const { address } = await listening();
    expect(await handshake(address, {})).toBe(401);
  });

  it('refuses a cookie-authenticated upgrade from another origin', async () => {
    const { address } = await listening();
    const status = await handshake(address, {
      cookie: `${CREDENTIAL_COOKIE}=${ADMIN}`,
      origin: 'http://evil.example',
    });
    expect(status).toBe(403);
  });

  // The recovery route and every non-browser client. Neither sends an Origin, and refusing them would
  // break `wsClient` in the test suite as well as the documented way back in.
  it('still accepts a bearer with no Origin', async () => {
    const { address } = await listening();
    expect(await handshake(address, { authorization: `Bearer ${ADMIN}` })).toBe('open');
  });
});
