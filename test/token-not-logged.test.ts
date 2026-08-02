import { PassThrough } from 'node:stream';
import { describe, expect, it, onTestFinished } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { CredentialStore } from '../src/server/credentials.js';
import { stripSecrets } from '../src/server/logging.js';
import { ProjectSession } from '../src/server/session.js';

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

describe('stripSecrets', () => {
  it('redacts the token and keeps everything else', () => {
    expect(stripSecrets('/ws?token=abc')).toBe('/ws?token=%5Bredacted%5D');
    expect(stripSecrets('/x?a=1&token=abc&b=2')).toBe('/x?a=1&token=%5Bredacted%5D&b=2');
  });

  it('leaves a URL with no token exactly as it was', () => {
    // Byte-for-byte: re-serialising every URL through URLSearchParams would quietly rewrite
    // encodings across every line in the log.
    expect(stripSecrets('/api/cards/engineering/E-001')).toBe('/api/cards/engineering/E-001');
    expect(stripSecrets('/api/models?backend=claude-code')).toBe('/api/models?backend=claude-code');
  });
});
