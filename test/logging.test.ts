import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { DEFAULT_LOG_LEVEL, LOG_LEVELS, loggerOptions, resolveLevel } from '../src/server/logging.js';
import { ProjectSession } from '../src/server/session.js';

describe('resolveLevel', () => {
  it('accepts every level it advertises', () => {
    for (const level of LOG_LEVELS) expect(resolveLevel(level)).toBe(level);
  });

  it('tolerates the casing and padding a hand-edited .env comes with', () => {
    expect(resolveLevel(' DEBUG ')).toBe('debug');
    expect(resolveLevel('Warn')).toBe('warn');
  });

  it('falls back rather than letting a typo stop the server booting', () => {
    // pino throws on an unknown level, and that throw happens inside Fastify's constructor — so
    // without this the whole app would fail to start over a misspelled env var.
    expect(resolveLevel('verbose')).toBe(DEFAULT_LOG_LEVEL);
    expect(resolveLevel('')).toBe(DEFAULT_LOG_LEVEL);
    expect(resolveLevel(undefined)).toBe(DEFAULT_LOG_LEVEL);
    expect(DEFAULT_LOG_LEVEL).toBe('info');
  });
});

describe('loggerOptions', () => {
  it('reads the level from the environment, and is on when nothing is set', () => {
    expect(loggerOptions({ VIBEBOARD_LOG_LEVEL: 'trace' })).toEqual({ level: 'trace' });
    // Never `false`: Fastify's silent default is the thing being fixed.
    expect(loggerOptions({})).toEqual({ level: 'info' });
  });
});

// Everything below reads back what pino actually wrote. Asserting on `app.log.level` alone would
// pass for a logger that is configured and never used.
function sink(): { lines: Record<string, unknown>[]; stream: Writable } {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const line of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(line));
      cb();
    },
  });
  return { lines, stream };
}

// Fastify's request/response lines are written from an onResponse hook, which is not guaranteed to
// have run by the time inject() resolves. Real time with a generous margin — a faked clock cannot
// flush a stream.
async function settle(done: () => boolean, ms = 1000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
}

let session: ProjectSession | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe('the server logger', () => {
  it('records every request with its method, url and status', async () => {
    const { lines, stream } = sink();
    session = new ProjectSession();
    const app = buildApp(session, { logger: { level: 'info', stream } });

    await app.inject({ method: 'GET', url: '/api/state' });
    await settle(() => lines.some((l) => l.res !== undefined));
    await app.close();

    const req = lines.find((l) => (l.req as { url?: string } | undefined)?.url === '/api/state');
    expect(req?.req).toMatchObject({ method: 'GET', url: '/api/state' });
    expect(lines.find((l) => l.res !== undefined)?.res).toMatchObject({ statusCode: 200 });
  });

  it('records a route that throws, with the stack — the reason logging was turned on', async () => {
    // Before this, Fastify's `logger: false` default meant a 500 reached the browser and left
    // nothing behind on the server: no message, no stack, nowhere to look afterwards.
    const { lines, stream } = sink();
    session = new ProjectSession();
    const app = buildApp(session, { logger: { level: 'info', stream } });
    app.get('/boom', () => {
      throw new Error('kaboom');
    });

    const res = await app.inject({ method: 'GET', url: '/boom' });
    await settle(() => lines.some((l) => l.level === 50));
    await app.close();

    expect(res.statusCode).toBe(500);
    const error = lines.find((l) => l.level === 50);
    expect(error).toBeDefined();
    const err = error?.err as { message?: string; stack?: string } | undefined;
    expect(err?.message).toBe('kaboom');
    expect(err?.stack).toContain('logging.test.ts');
  });

  it('writes nothing at all when silenced', async () => {
    // What the suite itself runs with, so it has to mean silence and not merely a quieter level.
    const { lines, stream } = sink();
    session = new ProjectSession();
    const app = buildApp(session, { logger: { level: 'silent', stream } });
    app.get('/boom', () => {
      throw new Error('kaboom');
    });

    await app.inject({ method: 'GET', url: '/api/state' });
    await app.inject({ method: 'GET', url: '/boom' });
    // A short window only: nothing is expected, and the stream write is synchronous when it happens.
    await settle(() => lines.length > 0, 150);
    await app.close();

    expect(lines).toEqual([]);
  });

  it('takes its level from the environment when no logger is passed', async () => {
    // The wiring that main.ts relies on: buildApp() with no options must still be logging. Asserted
    // through process.env because that is the only path production takes.
    const before = process.env.VIBEBOARD_LOG_LEVEL;
    process.env.VIBEBOARD_LOG_LEVEL = 'warn';
    try {
      session = new ProjectSession();
      const app = buildApp(session);
      expect(app.log.level).toBe('warn');
      await app.close();
    } finally {
      process.env.VIBEBOARD_LOG_LEVEL = before;
    }
  });
});
