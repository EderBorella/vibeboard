import { createWriteStream, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { FastifyServerOptions } from 'fastify';

// Fastify's own default is `logger: false`, and that silence was the whole problem: a route that
// threw answered 500 with nothing written anywhere, so a failure in the field left nothing to read
// afterwards.
//
// The lines go to a file rather than the terminal, because the point of them is to still be there
// tomorrow when you want to know what happened. Logs belong to VibeBoard's own folder, NOT to the
// open project: the server starts with no project open, outlives whichever one you switch to, and
// a board project's folder is the user's content, not ours to write app logs into.

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';
export const DEFAULT_LOG_KEEP = 14;

// pino throws on a level it doesn't know, which would turn a typo in an env var into a server that
// refuses to boot — the exact opposite of what turning logging on is for. Unknown values fall back.
export function resolveLevel(raw: string | undefined): LogLevel {
  const level = raw?.trim().toLowerCase() as LogLevel;
  return LOG_LEVELS.includes(level) ? level : DEFAULT_LOG_LEVEL;
}

// Resolved from this module, not from the working directory, so `npm start` from anywhere still
// writes to the install it is running. dist/server/logging.js and src/server/logging.ts both sit
// two levels below the root.
function installRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}

// An explicitly empty VIBEBOARD_LOG_DIR means "don't write files" — logging falls back to stdout.
export function logDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.VIBEBOARD_LOG_DIR;
  if (raw === undefined) return join(installRoot(), 'logs');
  const dir = raw.trim();
  return dir === '' ? undefined : resolve(dir);
}

// One file per day, appended. Deliberately not one per boot: `npm run dev` restarts on every save,
// which would leave hundreds of near-empty files. Each line carries its pid, so boots stay
// separable within a day.
export function logFileFor(dir: string, now: Date): string {
  return join(dir, `vibeboard-${now.toISOString().slice(0, 10)}.log`);
}

export function resolveKeep(raw: string | undefined): number {
  const keep = Number(raw);
  return Number.isInteger(keep) && keep > 0 ? keep : DEFAULT_LOG_KEEP;
}

// Keep the newest `keep` files and delete the rest. The date in the name sorts lexicographically,
// so no stat() is needed. A missing directory is the first-run case, not an error.
export function pruneLogs(dir: string, keep: number): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const stale = names
    .filter((n) => /^vibeboard-\d{4}-\d{2}-\d{2}\.log$/.test(n))
    .sort()
    .slice(0, -keep);
  for (const name of stale) rmSync(join(dir, name), { force: true });
  return stale;
}

export interface ServerLogger {
  options: FastifyServerOptions['logger'];
  /** Where the lines are going, when that is a file. Reported in the startup banner. */
  file?: string;
}

// Building this OPENS the file and prunes old ones, so it is called once per process. `silent`
// short-circuits before any of that: the test suite runs silenced and must not touch the disk.
export function serverLogger(env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): ServerLogger {
  const level = resolveLevel(env.VIBEBOARD_LOG_LEVEL);
  const dir = logDir(env);
  if (level === 'silent' || dir === undefined) return { options: { level } };

  try {
    mkdirSync(dir, { recursive: true });
    pruneLogs(dir, resolveKeep(env.VIBEBOARD_LOG_KEEP));
    const file = logFileFor(dir, now);
    const stream = createWriteStream(file, { flags: 'a' });
    // A log that cannot be written must not take the server with it, and must not recurse by
    // logging its own failure to the stream that just failed.
    stream.on('error', (err) => console.error('log write failed:', err.message));
    return { options: { level, stream: asDestination(stream) }, file };
  } catch (err) {
    // An unwritable folder (read-only install, wrong owner) degrades to stdout rather than
    // preventing startup. Said out loud, because silently losing the logs is the original bug.
    console.error(`log directory ${dir} is not writable, logging to stdout:`, (err as Error).message);
    return { options: { level } };
  }
}

// pino writes to anything with write(); wrapping keeps it from closing or ending the file stream on
// its own, so the process controls the file's lifetime. Backpressure is ignored on purpose — a debug
// log must never stall a request, and the buffer it can build at these volumes is nothing.
function asDestination(stream: Writable): Writable {
  return new Writable({
    write(chunk, _enc, cb) {
      stream.write(chunk);
      cb();
    },
  });
}
