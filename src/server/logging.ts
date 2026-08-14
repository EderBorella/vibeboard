import { mkdirSync, openSync, readdirSync, rmSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { FastifyRequest, FastifyServerOptions } from 'fastify';

// Fastify's own default is `logger: false`, and that silence was the whole problem: a route that
// threw answered 500 with nothing written anywhere, so a failure in the field left nothing to read
// afterwards.
//
// The lines go to a file rather than the terminal, because the point of them is to still be there
// tomorrow when you want to know what happened. Logs belong to VibeBoard's own folder, NOT to the
// open project: the server starts with no project open, outlives whichever one you switch to, and
// a board project's folder is the user's content, not ours to write app logs into.

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];
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

// WHERE THE LOOP'S OWN OUTPUT GOES, and it is a second file rather than the server's.
//
// It cannot be the server's: the loop is a separate process (decision 20), and pino owns that file
// through one open descriptor with synchronous writes. Two processes appending to one file interleave
// mid-line, and the server's is machine-readable JSON — a plain `[autopilot] …` line in the middle of it
// makes the whole day's log unparseable by whatever reads it.
//
// Same directory and the same one-file-per-day shape, so there is one folder to look in and `pruneLogs`
// bounds both.
export function autopilotLogFileFor(dir: string, now: Date): string {
  return join(dir, `autopilot-${now.toISOString().slice(0, 10)}.log`);
}

// The two families of file this directory holds. Both are pruned, and each keeps its own `keep` — a day
// with no auto-pilot session writes no autopilot file, so counting them together would silently shorten
// how far back the server's log goes.
const LOG_FAMILIES = [/^vibeboard-\d{4}-\d{2}-\d{2}\.log$/, /^autopilot-\d{4}-\d{2}-\d{2}\.log$/] as const;

export function resolveKeep(raw: string | undefined): number {
  const keep = Number(raw);
  return Number.isInteger(keep) && keep > 0 ? keep : DEFAULT_LOG_KEEP;
}

// Keep the newest `keep` files of EACH family and delete the rest. The date in the name sorts
// lexicographically, so no stat() is needed. A missing directory is the first-run case, not an error.
export function pruneLogs(dir: string, keep: number): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const stale = LOG_FAMILIES.flatMap((family) =>
    names
      .filter((n) => family.test(n))
      .sort()
      .slice(0, -keep),
  );
  for (const name of stale) rmSync(join(dir, name), { force: true });
  return stale;
}

interface ServerLogger {
  options: FastifyServerOptions['logger'];
  /** Where the lines are going, when that is a file. Reported in the startup banner. */
  file?: string;
}

// The admin credential travels in a query string — in the launch URL, and on the websocket
// handshake, which cannot carry a header. Fastify's default serializer logs `req.url` verbatim, so
// both were being written to a file in plaintext: a credential with no expiry, in the file the
// README tells people to tail and paste when something misbehaves, inside the directory a sandboxed
// agent is granted read access to. Stripped in one place so no future query parameter can be
// forgotten here.
// A sign-in request id is the SAME hazard in a path segment rather than a query parameter: whoever
// holds one can collect the credential a person approves for somebody else, and this URL is polled
// every two seconds. Found by the test in test/token-not-logged.test.ts, which is where the query-string
// leak was found too — the file was right that the query string was not the whole of it.
const REQUEST_ID = /^\/auth\/request\/[^/?]+/;

export function stripSecrets(url: string): string {
  const path = url.replace(REQUEST_ID, '/auth/request/[redacted]');
  const q = path.indexOf('?');
  if (q === -1) return path;
  const params = new URLSearchParams(path.slice(q + 1));
  if (!params.has('token')) return path;
  params.set('token', '[redacted]');
  return `${path.slice(0, q)}?${params.toString()}`;
}

const serializers = {
  req(req: FastifyRequest) {
    return { method: req.method, url: stripSecrets(req.url), host: req.headers.host };
  },
};

// Applied by the composition root to WHATEVER logger options it ends up with, not only the ones
// built here. main.ts and the tests both pass their own, and a redaction that a caller can bypass
// by supplying a logger is a redaction that will be bypassed.
export function withRedaction(options: FastifyServerOptions['logger']): FastifyServerOptions['logger'] {
  if (options === undefined || options === false || options === true) return options;
  return { ...options, serializers: { ...serializers, ...options.serializers } };
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
    // openSync, not createWriteStream: opened here rather than lazily, so a file that cannot be
    // written (a root-owned log left by a sudo run) is caught below instead of surfacing later as a
    // stream error with the lines already lost.
    return { options: { level, stream: fileDestination(openSync(file, 'a')) }, file };
  } catch (err) {
    // An unwritable folder (read-only install, wrong owner) degrades to stdout rather than
    // preventing startup. Said out loud, because silently losing the logs is the original bug.
    console.error(`log directory ${dir} is not writable, logging to stdout:`, (err as Error).message);
    return { options: { level } };
  }
}

// A descriptor for the loop to write into, or nothing. Handed to `spawn` as the child's stderr — and,
// when the debug setting is on, its stdout too.
//
// A FILE DESCRIPTOR RATHER THAN A PIPE, and that is the whole reason this is safe now when it was not
// before: a pipe needs a reader, and the parent had none, so an unread one fills its buffer and then
// blocks the writer for ever — which is worse than losing the output. A file cannot block, needs nobody
// listening, and outlives both processes.
//
// The caller must close it once `spawn` has returned: the child gets its own duplicate, so a descriptor
// left open here leaks one per start for the life of the server.
export interface AutopilotLogTarget {
  fd: number;
  file: string;
}

export function openAutopilotLog(
  // What the header line names, so a day's file separates one session from the next.
  what: string,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): AutopilotLogTarget | undefined {
  const dir = logDir(env);
  // An explicitly empty VIBEBOARD_LOG_DIR means "write no files", and it means it here too. The test
  // suite runs that way, so nothing below touches the disk during a test that has not asked for it.
  if (dir === undefined) return undefined;
  try {
    mkdirSync(dir, { recursive: true });
    const file = autopilotLogFileFor(dir, now);
    const fd = openSync(file, 'a');
    // Appended by the SERVER before the child exists, so the file says a session began even when the loop
    // dies too early to say anything itself — which is exactly the case this file was added for.
    writeSync(fd, `\n--- ${now.toISOString()} ${what}\n`);
    return { fd, file };
  } catch (err) {
    // Degrade to no file rather than refusing to start the loop. Said out loud, because silence here is
    // the original bug wearing a different hat.
    console.error(`could not open the auto-pilot log in ${dir}:`, (err as Error).message);
    return undefined;
  }
}

// Synchronous writes, deliberately. A buffered stream loses whatever it is holding when the process
// exits, which is precisely the moment the last line matters most — the crash handlers below log
// fatal and then exit. At a handful of lines per interaction the cost of writeSync is nothing.
function fileDestination(fd: number): Writable {
  return new Writable({
    write(chunk: Buffer, _enc, cb) {
      try {
        // Loop: writeSync is allowed to write less than the whole buffer.
        for (let off = 0; off < chunk.length; ) off += writeSync(fd, chunk, off);
      } catch (err) {
        // Never rethrow into pino, and never log this failure through the logger that just failed.
        console.error('log write failed:', (err as Error).message);
      }
      cb();
    },
  });
}

// The subset of pino the subsystems use. Narrow on purpose: a fake in a test is five vi.fn()s, and
// nothing outside this module needs to know a logger comes from Fastify.
export interface Log {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  fatal(obj: object, msg?: string): void;
  child(bindings: Record<string, unknown>): Log;
}

// A crash outside the request lifecycle used to kill the process in silence. Node's own default is
// already to exit on both of these, so this only adds the record of WHY — it does not decide to
// keep running in a state the code did not expect.
export function installCrashHandlers(log: Log, exit: (code: number) => void = process.exit): void {
  process.on('unhandledRejection', (reason) => {
    log.fatal({ err: reason }, 'unhandled rejection — exiting');
    exit(1);
  });
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'uncaught exception — exiting');
    exit(1);
  });
}
