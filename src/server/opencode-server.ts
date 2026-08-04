import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isolationEnabled, opencodeConfigHome } from './copilot-env.js';
import type { Log } from './logging.js';
import { NOT_REQUESTED, type SandboxStatus, wrapCommand } from './sandbox.js';

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
let sandbox: SandboxStatus = NOT_REQUESTED;
// Whether the open project is halted. A FUNCTION, set by the composition root: this module is a
// process-wide singleton and the answer changes while it runs.
let halted: () => boolean = () => false;

// Set by buildApp, alongside the logger and for the same reason: this server is a process-wide
// singleton started lazily, long after the app was built.
//
// One confinement covers every run in every project it serves, and the chat with it — the profile
// is globs over `**/.vibeboard/**`, not paths, so switching projects needs no restart. That is the
// simplification AppArmor bought over the per-project ruleset the design originally called for.
export function attachSandbox(status: SandboxStatus): void {
  sandbox = status;
}

// The lazy respawn is what makes a halt real. Decision 12: while halted "nothing dispatches, NOTHING
// RESPAWNS LAZILY, and the chat says plainly that the project is halted" — without this the Restart
// button would be decorative, since the next chat message would quietly bring `opencode serve` back.
export function attachHaltGate(gate: () => boolean): void {
  halted = gate;
}

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

// Where the managed server's pid is recorded, outside any project. The shutdown handlers in main.ts
// cover the signals a process can catch; SIGKILL, an OOM kill and a crashed host are not among them,
// and each one leaves `opencode serve` running for as long as the machine is up. Two were found
// alive on the development machine, the older of them seven days old.
export function opencodePidFile(): string {
  return process.env.VIBEBOARD_OPENCODE_PID_FILE ?? join(homedir(), '.vibeboard', 'opencode.pid');
}

// Kill a server left behind by a previous VibeBoard, before starting one of our own.
//
// The command-line check is not optional. Pids are reused, so by the time we read this file the
// number may belong to something else entirely, and killing a stranger's process because it
// inherited a pid would be far worse than the orphan we are cleaning up. Anything unreadable — no
// /proc, no permission, no such process — is left alone.
export function reapOrphanServer(): void {
  const file = opencodePidFile();
  try {
    const pid = Number(readFileSync(file, 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 1) return;
    // NUL-separated argv. `opencode` has to appear in it for this to be the process we recorded.
    if (!readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('opencode')) return;
    process.kill(pid, 'SIGTERM');
    log?.warn({ pid }, 'killed an opencode server left running by a previous VibeBoard');
  } catch {
    /* no record, already gone, or nothing we can safely identify */
  }
  try {
    unlinkSync(file);
  } catch {
    /* nothing recorded */
  }
}

function recordPid(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    const file = opencodePidFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${pid}\n`, 'utf8');
  } catch {
    /* the reaper is a safety net, not a dependency — failing to record must not fail the start */
  }
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
  reapOrphanServer();
  // Confined here, at the one place the managed server is created. A server VibeBoard did not spawn
  // was never wrapped, which is exactly why VIBEBOARD_OPENCODE_URL refuses auto-pilot below.
  const spawned = wrapCommand(opencodeBin(), args, sandbox);
  const proc = spawn(spawned.bin, spawned.args, { env });
  child = proc;
  recordPid(proc.pid);

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
      // Only if THIS process is still the one we are tracking. The handler closes over module
      // state, and exit arrives a tick after the kill — so a restart, which stops the old server
      // and registers the new one synchronously, had its new registration wiped by the old
      // server's exit. The next turn then spawned a third server, on a different OS-assigned port,
      // with nothing recording its pid: an orphan surviving shutdown, which is the exact leak
      // 976d710 was written to fix.
      if (child === proc) {
        child = undefined;
        urlPromise = undefined;
      }
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

// The server VibeBoard was told to attach to, if any. Read per call rather than captured: the
// take-over action clears it at runtime, and a captured value would keep refusing afterwards.
export function attachedOpencodeUrl(): string | undefined {
  return process.env.VIBEBOARD_OPENCODE_URL || undefined;
}

export function opencodeBaseUrl(): Promise<string> {
  const attach = attachedOpencodeUrl();
  if (attach) return Promise.resolve(attach.replace(/\/$/, ''));
  // Before the spawn, and after the attach check: a server somebody else started is not ours to refuse.
  //
  // The halt check is NOT conditional on there being no managed server yet. It was, on the reasoning
  // that the emergency stop had killed any live one — true only when this process performed the halt.
  // Open a project whose state file already says `halted` while a server spawned for the previous
  // project is still alive and `urlPromise` is set, so the gate was skipped and `GET /api/models`
  // would talk to that server on behalf of a halted project.
  if (halted()) {
    return Promise.reject(
      new Error('This project is halted, so VibeBoard will not start an OpenCode server for it.'),
    );
  }
  if (!urlPromise) urlPromise = startServer();
  return urlPromise;
}

// Stop the managed server and start a fresh one, confined by whatever is in force now. Its everyday
// justification is a hung or stale server; it also covers one started before the profile was
// installed, which would otherwise keep serving unconfined until the app restarted.
export async function restartOpencodeServer(): Promise<string> {
  stopOpencodeServer();
  urlPromise = startServer();
  return urlPromise;
}

// Stop attaching to somebody else's server and manage one of our own. An explicit user action,
// never something auto-pilot does silently: that variable was set deliberately, most likely for
// debugging, and a loop quietly overriding it would be the same class of surprise this whole slice
// exists to remove.
export async function takeOverOpencodeServer(): Promise<string> {
  delete process.env.VIBEBOARD_OPENCODE_URL;
  return restartOpencodeServer();
}

export function stopOpencodeServer(): void {
  if (child) {
    child.kill('SIGTERM');
    child = undefined;
    urlPromise = undefined;
    // Cleared here rather than on the child's exit event: this runs from a signal handler and from
    // `process.once('exit')`, where nothing asynchronous gets a turn.
    try {
      unlinkSync(opencodePidFile());
    } catch {
      /* never recorded, or already reaped */
    }
  }
}
