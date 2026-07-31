import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/server/app.js';
import {
  DEFAULT_LOG_KEEP,
  DEFAULT_LOG_LEVEL,
  LOG_LEVELS,
  logDir,
  logFileFor,
  pruneLogs,
  resolveKeep,
  resolveLevel,
  serverLogger,
} from '../src/server/logging.js';
import { ProjectSession } from '../src/server/session.js';
import { tempDir } from './helpers.js';

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

describe('logDir', () => {
  it('defaults to a logs folder inside the install, not the working directory', () => {
    // Module-relative, so `npm start` from another folder still writes to the install it runs.
    // Derived from THIS file's location rather than from cwd, which would pass by coincidence.
    expect(logDir({})).toBe(join(import.meta.dirname, '..', 'logs'));
  });

  it('takes an override, resolved to an absolute path', () => {
    expect(logDir({ VIBEBOARD_LOG_DIR: '/var/log/vibeboard' })).toBe('/var/log/vibeboard');
    expect(logDir({ VIBEBOARD_LOG_DIR: 'relative/logs' })).toBe(join(process.cwd(), 'relative/logs'));
  });

  it('treats an empty override as "no file", which is how you get stdout back', () => {
    expect(logDir({ VIBEBOARD_LOG_DIR: '' })).toBeUndefined();
    expect(logDir({ VIBEBOARD_LOG_DIR: '   ' })).toBeUndefined();
  });
});

describe('resolveKeep', () => {
  it('takes a positive integer and ignores anything else', () => {
    expect(resolveKeep('3')).toBe(3);
    expect(resolveKeep('0')).toBe(DEFAULT_LOG_KEEP);
    expect(resolveKeep('-2')).toBe(DEFAULT_LOG_KEEP);
    expect(resolveKeep('7.5')).toBe(DEFAULT_LOG_KEEP);
    expect(resolveKeep('lots')).toBe(DEFAULT_LOG_KEEP);
    expect(resolveKeep(undefined)).toBe(DEFAULT_LOG_KEEP);
  });
});

describe('logFileFor', () => {
  it('names the file by date, so a day of restarts appends to one file', () => {
    // One file per boot would mean hundreds of them under `tsx watch`, which restarts on every save.
    const at = new Date('2026-07-31T23:12:03.000Z');
    expect(logFileFor('/logs', at)).toBe('/logs/vibeboard-2026-07-31.log');
    expect(logFileFor('/logs', new Date('2026-08-01T00:00:00.000Z'))).toBe('/logs/vibeboard-2026-08-01.log');
  });
});

describe('pruneLogs', () => {
  it('keeps the newest N and deletes the rest', async () => {
    const dir = await tempDir();
    for (const day of ['01', '02', '03', '04']) {
      writeFileSync(join(dir, `vibeboard-2026-07-${day}.log`), 'x');
    }
    expect(pruneLogs(dir, 2)).toEqual(['vibeboard-2026-07-01.log', 'vibeboard-2026-07-02.log']);
    expect(readdirSync(dir).sort()).toEqual(['vibeboard-2026-07-03.log', 'vibeboard-2026-07-04.log']);
  });

  it('deletes nothing when there are fewer files than the limit', async () => {
    const dir = await tempDir();
    writeFileSync(join(dir, 'vibeboard-2026-07-01.log'), 'x');
    expect(pruneLogs(dir, 14)).toEqual([]);
    expect(readdirSync(dir)).toEqual(['vibeboard-2026-07-01.log']);
  });

  it('touches only its own files, whatever else is in the folder', async () => {
    // The folder is the user's to look in, and a `.log` this did not write is not its to delete.
    const dir = await tempDir();
    for (const name of ['notes.md', 'vibeboard.log', 'vibeboard-2026-07.log', 'other-2026-07-01.log']) {
      writeFileSync(join(dir, name), 'x');
    }
    writeFileSync(join(dir, 'vibeboard-2026-07-01.log'), 'x');
    expect(pruneLogs(dir, 1)).toEqual([]);
    expect(readdirSync(dir)).toHaveLength(5);
  });

  it('is a no-op on the first run, when the folder does not exist yet', () => {
    expect(pruneLogs('/nonexistent/vibeboard-logs', 5)).toEqual([]);
  });
});

// Read back what actually landed on disk. Anything less proves only that the code was configured.
// Waits for `needle` rather than for a non-empty file: the append test starts with content already
// there, so "not empty" would return before the new line arrived.
async function contents(file: string, needle: string, ms = 1000): Promise<string> {
  const deadline = Date.now() + ms;
  let text = '';
  while (!text.includes(needle) && Date.now() < deadline) {
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      /* opened lazily by createWriteStream — not there until the first write */
    }
    if (!text.includes(needle)) await new Promise((r) => setTimeout(r, 5));
  }
  return text;
}

let session: ProjectSession | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe('serverLogger', () => {
  it('creates the folder and puts the lines in a file, not on the terminal', async () => {
    const dir = join(await tempDir(), 'logs');
    const { options, file } = serverLogger({ VIBEBOARD_LOG_DIR: dir }, new Date('2026-07-31T10:00:00.000Z'));
    expect(file).toBe(join(dir, 'vibeboard-2026-07-31.log'));

    session = new ProjectSession();
    const app = buildApp(session, { logger: options });
    await app.inject({ method: 'GET', url: '/api/state' });
    const text = await contents(file as string, '/api/state');
    await app.close();

    const lines = text
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.find((l) => (l.req as { url?: string })?.url === '/api/state')).toBeDefined();
    expect(lines.find((l) => l.res !== undefined)?.res).toMatchObject({ statusCode: 200 });
  });

  it('appends across restarts instead of truncating the day', async () => {
    // Restarting is the most common thing you do while debugging; it must not delete the evidence
    // of what you just did.
    const dir = join(await tempDir(), 'logs');
    const env = { VIBEBOARD_LOG_DIR: dir };
    const at = new Date('2026-07-31T10:00:00.000Z');
    mkdirSync(dir, { recursive: true });
    writeFileSync(logFileFor(dir, at), '{"msg":"from an earlier boot"}\n');

    const { options, file } = serverLogger(env, at);
    session = new ProjectSession();
    const app = buildApp(session, { logger: options });
    await app.inject({ method: 'GET', url: '/api/state' });
    const text = await contents(file as string, '/api/state');
    await app.close();

    expect(text).toContain('from an earlier boot');
    expect(text).toContain('/api/state');
  });

  it('prunes old days when it opens the new one', async () => {
    const dir = join(await tempDir(), 'logs');
    mkdirSync(dir, { recursive: true });
    for (const day of ['01', '02', '03']) writeFileSync(join(dir, `vibeboard-2026-07-${day}.log`), 'x');

    serverLogger({ VIBEBOARD_LOG_DIR: dir, VIBEBOARD_LOG_KEEP: '2' }, new Date('2026-07-31T10:00:00.000Z'));
    // Today's file exists straight away: it is opened with openSync rather than lazily, so a file
    // that cannot be written fails here, where it can still fall back, instead of later with the
    // lines already lost.
    expect(readdirSync(dir).sort()).toEqual([
      'vibeboard-2026-07-02.log',
      'vibeboard-2026-07-03.log',
      'vibeboard-2026-07-31.log',
    ]);
  });

  it('writes no file when silenced, and none when the folder is opted out of', async () => {
    // The suite runs silenced. If this ever wrote, every test run would litter the repo.
    const dir = join(await tempDir(), 'logs');
    expect(serverLogger({ VIBEBOARD_LOG_DIR: dir, VIBEBOARD_LOG_LEVEL: 'silent' })).toEqual({
      options: { level: 'silent' },
    });
    expect(() => readdirSync(dir)).toThrow();

    expect(serverLogger({ VIBEBOARD_LOG_DIR: '' })).toEqual({ options: { level: 'info' } });
  });

  it('falls back to stdout instead of refusing to start when the folder is unwritable', async () => {
    // A read-only install or a wrong owner must not stop the server. Losing the logs silently is
    // the original bug, so it says so on stderr.
    const parent = await tempDir();
    const blocked = join(parent, 'not-a-dir');
    writeFileSync(blocked, 'this is a file');
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { options, file } = serverLogger({ VIBEBOARD_LOG_DIR: join(blocked, 'logs') });
    expect(file).toBeUndefined();
    expect(options).toEqual({ level: 'info' });
    expect(said).toHaveBeenCalledOnce();
    said.mockRestore();
  });
});

// The app-level assertions below inject their own stream, which is the only way to see what pino
// emitted for a given request without going through the filesystem.
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
    // The wiring main.ts relies on: buildApp() with no options must still be logging. Asserted
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
