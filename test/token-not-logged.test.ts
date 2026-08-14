import { PassThrough } from 'node:stream';
import { describe, expect, it, onTestFinished } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { CredentialStore } from '../src/server/auth/credentials.js';
import { ProjectSession } from '../src/server/boards/session.js';
import { stripSecrets } from '../src/server/logging.js';

// The admin token has no expiry and survives restarts by design, so one line in a log file is a
// permanent full-authority credential. It reaches the server in a query string twice — the launch
// URL, and the websocket handshake, which cannot carry a header — and Fastify's default serializer
// logs `req.url` verbatim. It was in the real log on the development machine when this was written.

const TOKEN = 'SUPER-SECRET-ADMIN-TOKEN';

// Captured with a real logger and real serializers rather than a fake: a redaction proven only
// against a stub is a redaction nobody has run.
async function captureLog(exercise: (app: ReturnType<typeof buildApp>) => Promise<void>): Promise<string> {
  const stream = new PassThrough();
  let captured = '';
  stream.on('data', (c: Buffer) => {
    captured += c.toString('utf8');
  });
  const session = new ProjectSession();
  const app = buildApp(session, {
    credentials: new CredentialStore(TOKEN),
    logger: { level: 'info', stream },
  });
  onTestFinished(async () => {
    await app.close();
    await session.close();
  });
  await exercise(app);
  await new Promise((r) => setTimeout(r, 50)); // pino writes are async through a PassThrough
  return captured;
}

describe('the admin token never reaches the log', () => {
  it('strips it from a request URL', async () => {
    const captured = await captureLog(async (app) => {
      await app.inject({ method: 'GET', url: `/?token=${TOKEN}` });
      await app.inject({ method: 'GET', url: `/ws?token=${TOKEN}` });
      await app.inject({ method: 'GET', url: `/api/state?token=${TOKEN}` });
    });
    expect(captured).not.toContain(TOKEN);
    // And the request really was logged — otherwise this passes on an empty file.
    expect(captured).toContain('token=%5Bredacted%5D');
  });
});

// The device credentials and the request ids are the same hazard with a new shape. A device token is a
// permanent full-authority credential exactly like the admin token, and a request id is one poll away
// from being one — an id in a log is an approved sign-in anybody who can read that file can collect.
describe('sign-in leaks nothing into the log', () => {
  it('does not log the credential it hands to a browser that claims', async () => {
    let token = '';
    const captured = await captureLog(async (app) => {
      const claimed = await app.inject({
        method: 'POST',
        url: '/auth/claim',
        headers: { 'user-agent': 'Firefox' },
      });
      token = claimed.json().token ?? '';
      expect(token).not.toBe('');
    });

    expect(captured).not.toContain(token);
    // The device ID is fine and is deliberately there: it is a name, and the log is where you look to
    // see that an unauthenticated caller was handed a credential at all.
    expect(captured).toContain('signed itself in');
  });

  it('does not log a request id, which is one poll away from being a credential', async () => {
    let id = '';
    const captured = await captureLog(async (app) => {
      await app.inject({ method: 'POST', url: '/auth/claim', headers: { 'user-agent': 'Firefox' } });
      const asked = await app.inject({
        method: 'POST',
        url: '/auth/request',
        headers: { 'user-agent': 'Safari' },
      });
      id = asked.json().id ?? '';
      expect(id).not.toBe('');
      // The id travels in the URL of the poll, which is exactly where the admin token was found.
      await app.inject({ url: `/auth/request/${id}` });
    });

    expect(captured).not.toContain(id);
    // And the poll really was logged, or this passes on a line that was never written.
    expect(captured).toContain('/auth/request/[redacted]');
  });
});

// G9. THE NEW SHAPE OF THE SAME HAZARD. The credential now travels as a Cookie header on every single
// request a browser makes — far more often than it ever appeared in a URL — so a serializer that logs
// headers, an error dump that includes them, or a 404 line would write a permanent credential to a file
// the README tells people to tail and paste.
describe('the credential never reaches the log as a cookie', () => {
  it('is absent after a browser has used it on /api, /ws and a 404', async () => {
    const captured = await captureLog(async (app) => {
      const cookie = `vb.in=1; vb=${TOKEN}`;
      await app.inject({ url: '/api/state', headers: { cookie, host: 'localhost:4610' } });
      // A route that throws: the error path is the one that dumps the most about a request.
      await app.inject({ method: 'POST', url: '/api/cards', headers: { cookie, host: 'localhost:4610' } });
      // Fastify's own 404 line, which the request serializer cannot reach.
      await app.inject({ url: '/api/nope', headers: { cookie, host: 'localhost:4610' } });
      await app.inject({ url: '/ws', headers: { cookie, host: 'localhost:4610' } });
    });

    expect(captured).not.toContain(TOKEN);
    // And the requests really were logged, or this passes on an empty file.
    expect(captured).toContain('/api/state');
    expect(captured).toContain('route not found');
  });

  it('is absent from the answer that hands it over as well as from the request', async () => {
    // `/auth/adopt` is the one route that takes a credential in a BODY, which is the other place a
    // serializer could reach for it.
    const captured = await captureLog(async (app) => {
      const res = await app.inject({ method: 'POST', url: '/auth/adopt', payload: { token: TOKEN } });
      expect(res.statusCode).toBe(200);
    });

    expect(captured).not.toContain(TOKEN);
    expect(captured).toContain('adopted a credential');
  });
});

describe('stripSecrets', () => {
  it('redacts the token and keeps everything else', () => {
    expect(stripSecrets('/ws?token=abc')).toBe('/ws?token=%5Bredacted%5D');
    expect(stripSecrets('/x?a=1&token=abc&b=2')).toBe('/x?a=1&token=%5Bredacted%5D&b=2');
  });

  it('redacts a sign-in request id, which is in the path and not the query string', () => {
    expect(stripSecrets('/auth/request/JyE4PeHGjypKf8NVd58SAj')).toBe('/auth/request/[redacted]');
    // With a query string as well, so neither redaction eats the other.
    expect(stripSecrets('/auth/request/abc?token=xyz')).toBe('/auth/request/[redacted]?token=%5Bredacted%5D');
  });

  it('leaves the routes that only LOOK like it alone', () => {
    // The anchor matters: an unanchored match would redact any URL that happened to contain the
    // segment, and a too-greedy one would eat the rest of the path.
    expect(stripSecrets('/auth/request')).toBe('/auth/request');
    expect(stripSecrets('/api/signin/approve/abc')).toBe('/api/signin/approve/abc');
    expect(stripSecrets('/x/auth/request/abc')).toBe('/x/auth/request/abc');
  });

  it('leaves a URL with no token exactly as it was', () => {
    // Byte-for-byte: re-serialising every URL through URLSearchParams would quietly rewrite
    // encodings across every line in the log.
    expect(stripSecrets('/api/cards/engineering/E-001')).toBe('/api/cards/engineering/E-001');
    expect(stripSecrets('/api/models?backend=claude-code')).toBe('/api/models?backend=claude-code');
  });
});
