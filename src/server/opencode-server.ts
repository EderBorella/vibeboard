import { type ChildProcess, spawn } from 'node:child_process';
import { isolationEnabled, opencodeConfigHome } from './copilot-env.js';
import type { Log } from './logging.js';

// A single managed `opencode serve` process, started lazily and reused for every turn.
// We talk to it over HTTP (see opencode-client) — `opencode run` per turn hangs at init on
// some setups, whereas the persistent server is fast and reliable. Set VIBEBOARD_OPENCODE_URL
// to attach to a server you run yourself instead of spawning one.

function opencodeBin(): string {
  return process.env.VIBEBOARD_OPENCODE_BIN ?? 'opencode';
}

let child: ChildProcess | undefined;
let urlPromise: Promise<string> | undefined;
let log: Log | undefined;

// Set by buildApp, for the same reason as ProjectSession.attachLogger: this is a process-wide
// singleton started on first use, and everything it has to say happens with no request in flight.
// Named attach*, NOT use*: Biome's useHookAtTopLevel treats any use* function as a React hook.
export function attachOpencodeLogger(next: Log): void {
  log = next;
}

// The client half of this backend (opencode-client) has no wiring of its own and files its lines
// under the same component — the spawned server and the turns it runs are one subsystem.
export function opencodeLog(): Log | undefined {
  return log;
}

// The startup buffer only has to hold enough for the exit diagnostic below, and the child then talks
// for the whole life of the app: before this cap it grew without limit. The HEAD is what is kept —
// the listening banner and a failure both come first, and it is the head the URL is matched in.
const STARTUP_CAP = 8192;

// Exported for its own test: the leak it prevents is invisible from outside (memory, not output),
// and a cap that silently stopped capping would look exactly like one that works.
export function capStartupLog(out: string, chunk: string): string {
  return out.length >= STARTUP_CAP ? out : (out + chunk).slice(0, STARTUP_CAP);
}

function startServer(): Promise<string> {
  // Default to port 0 (OS-assigned) so we never collide with a stray/previous serve; the
  // actual URL is parsed from opencode's "listening on ..." line below.
  const port = process.env.VIBEBOARD_OPENCODE_PORT ?? '0';
  const args = ['serve', '--port', String(port), '--hostname', '127.0.0.1'];
  // Isolate from the user's personal opencode config: a clean XDG_CONFIG_HOME means
  // opencode finds no ~/.config/opencode AGENTS.md/config/plugins. Auth + db stay in the
  // default XDG_DATA_HOME (~/.local/share/opencode), so login is preserved.
  const env = isolationEnabled() ? { ...process.env, XDG_CONFIG_HOME: opencodeConfigHome() } : process.env;
  const proc = spawn(opencodeBin(), args, { env });
  child = proc;

  return new Promise<string>((resolve, reject) => {
    let out = '';
    let settled = false;
    // Once the server is up its output is the only account of what the provider actually said, and
    // it used to go nowhere: a turn that failed inside opencode left `Streaming response failed` in
    // the transcript and no explanation anywhere. stderr is where those failures are reported, so it
    // is a warning — worth reading, though the server itself is still serving. stdout is the routine
    // per-request chatter, which at `info` (the default level) would bury every other line in the
    // file, so it stays at debug: available by raising VIBEBOARD_LOG_LEVEL, absent otherwise.
    const forward = (stream: 'stdout' | 'stderr', text: string): void => {
      const line = text.replace(/\s+$/, ''); // chunks arrive newline-terminated; don't log blanks
      if (!line) return;
      if (stream === 'stderr') log?.warn({ stream }, line);
      else log?.debug({ stream }, line);
    };
    const onData =
      (stream: 'stdout' | 'stderr') =>
      (c: Buffer): void => {
        const text = c.toString('utf8');
        if (settled) {
          forward(stream, text);
          return;
        }
        out = capStartupLog(out, text);
        const m = out.match(/listening on (http:\/\/\S+)/i);
        if (m) {
          settled = true;
          clearTimeout(timer);
          resolve(m[1].trim());
        }
      };
    proc.stdout?.on('data', onData('stdout'));
    proc.stderr?.on('data', onData('stderr'));
    proc.on('exit', (code) => {
      child = undefined;
      urlPromise = undefined;
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`opencode serve exited (${code}): ${out.slice(0, 300)}`));
      }
    });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('opencode serve did not report a listening URL in time'));
      }
    }, 20000);
  });
}

export function opencodeBaseUrl(): Promise<string> {
  const attach = process.env.VIBEBOARD_OPENCODE_URL;
  if (attach) return Promise.resolve(attach.replace(/\/$/, ''));
  if (!urlPromise) urlPromise = startServer();
  return urlPromise;
}

export function stopOpencodeServer(): void {
  if (child) {
    child.kill('SIGTERM');
    child = undefined;
    urlPromise = undefined;
  }
}
