import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { BoxService } from './box-service.js';
import { dockerBin, WORK_DIR } from './containers.js';
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
let boxes: BoxService | undefined;
// The `docker logs -f` follower for the boxed server, so it can be replaced on restart and stopped
// on shutdown rather than outliving the thing it is reading.
let logs: ChildProcess | undefined;
// Which project `urlPromise` belongs to — see `opencodeBaseUrl`.
let urlProject: string | undefined;
// The project the managed server serves. A FUNCTION, like `halted`: the server is a process-wide
// singleton and the open project changes under it.
let projectRoot: () => string = () => process.cwd();
// Whether the open project is halted. A FUNCTION, set by the composition root: this module is a
// process-wide singleton and the answer changes while it runs.
let halted: () => boolean = () => false;

// The box the managed server runs INSIDE. Unlike Claude, this backend is not a command to wrap: it is
// a long-lived server, so containment here is lifecycle and port discovery rather than an exec prefix.
//
// There is no companion `attachSandbox`: confinement here IS the box. A `SandboxStatus` was pushed in
// alongside it until 2026-08-14, but nothing had read it since the boxed spawn replaced the unboxed
// one, so it described a guarantee this module no longer made. `agentRefusal` in sandbox.ts is the
// gate that reads the status, and it is called before any agent starts.
export function attachBoxes(next: BoxService | undefined): void {
  boxes = next;
}

// The project directory AS THE SERVER SEES IT. Boxed, that is always `/work` — the host path does
// not exist inside the container, and its failure mode is the trap worth naming: creating a session
// with a host path returns 200, and the MESSAGE then fails with an anonymous "Unexpected server
// error. Check server logs for details." It names neither the directory nor the cause, so it reads as
// an opencode bug rather than a path that means nothing on the other side of a mount.
export function opencodeDirectory(cwd: string): string {
  return boxes ? WORK_DIR : cwd;
}

export function attachProjectRoot(next: () => string): void {
  projectRoot = next;
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

// The container port `opencode serve` binds inside its box. FIXED, where the host-side spawn used
// port 0 and read the assignment back from the "listening on" line. Publishing needs a port known
// before the container exists, so the OS cannot be the one to choose it — but the HOST port still is:
// `-p 127.0.0.1::4096` lets docker pick, and a fixed host port would collide the moment two projects
// were open.
export const OPENCODE_CONTAINER_PORT = 4096;

// How long to wait for `opencode serve` to answer inside a fresh box. Generous: this covers a cold
// container start as well as the server's own boot.
const BOX_READY_TIMEOUT_MS = 60_000;

// Poll until it answers ANYTHING, rather than parsing a banner. There is no child process to read
// stdout from — the server is the container's main process — and "answers HTTP" is the property that
// actually matters. A 401 or a 404 is a perfectly good sign of life.
async function waitForServer(url: string, deadline: number): Promise<void> {
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      await fetch(`${url}/app`, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(
    `opencode serve did not answer on ${url} within ${BOX_READY_TIMEOUT_MS}ms` +
      (lastErr instanceof Error ? `: ${lastErr.message}` : ''),
  );
}

// The managed server, INSIDE its project's box.
//
// Nothing here wraps a command, which is the difference from the Claude backend and the reason
// `wrapCommand` was not enough on its own: this backend is a long-lived server VibeBoard talks to
// over HTTP, so containment is a container whose main process it is, plus the port discovery that
// comes with that.
async function startServerInBox(service: BoxService): Promise<string> {
  const root = projectRoot();
  reapOrphanServer(); // a host-side server from before containment, or from an attached-URL session
  const handle = await service.ensure(root, 'opencode', OPENCODE_CONTAINER_PORT, [
    'opencode',
    'serve',
    '--port',
    String(OPENCODE_CONTAINER_PORT),
    // 0.0.0.0 INSIDE the box, not 127.0.0.1. The container's loopback is its own, so a server bound
    // there is unreachable from the host — including from VibeBoard. What keeps this off the network
    // is the published port, which docker binds to the host's 127.0.0.1 and nothing else.
    '--hostname',
    '0.0.0.0',
  ]);
  if (!handle.hostPort) {
    throw new Error('opencode box started but docker published no port for it');
  }
  const url = `http://127.0.0.1:${handle.hostPort}`;
  await waitForServer(url, Date.now() + BOX_READY_TIMEOUT_MS);
  followBoxLog(handle.name);
  log?.info({ url, box: handle.name }, 'opencode serve is up in its box');
  return url;
}

// Everything the server says, into VibeBoard's own log.
//
// This is not a nicety. Once the server is up, its output is the ONLY account of what the provider
// actually said: a turn that failed inside opencode used to leave "Streaming response failed" in the
// transcript and no explanation anywhere. Spawning the server as a child gave us its pipes for free;
// being the container's main process does not, so its output has to be followed deliberately or it
// goes to `docker logs` where nobody reading a VibeBoard log will ever find it.
//
// `--tail 0` because the interesting part is what happens from now on, and the startup banner has
// already served its purpose by the time this runs.
function followBoxLog(box: string): void {
  logs?.kill('SIGTERM');
  const proc = spawn(dockerBin(), ['logs', '-f', '--tail', '0', box]);
  logs = proc;
  // Same levels as the child-process version, and for the same reasons: stderr is where opencode
  // reports the failures worth reading, while stdout is per-request chatter that would bury the file.
  const forward = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
    const line = chunk.toString('utf8').replace(/\s+$/, '');
    if (!line) return;
    if (stream === 'stderr') log?.warn({ stream }, line);
    else log?.debug({ stream }, line);
  };
  proc.stdout?.on('data', forward('stdout'));
  proc.stderr?.on('data', forward('stderr'));
  // A follower that dies must not take anything with it — the server is still serving.
  proc.on('error', (err) => log?.warn({ err }, 'could not follow the opencode box log'));
  proc.on('exit', () => {
    if (logs === proc) logs = undefined;
  });
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
  // UNCONFINED, and only reachable when no BoxService was attached — which in practice means a test.
  // Production always has one, and `agentRefusal` refuses every agent when the sandbox is not ok, so
  // this path cannot be reached with agents enabled.
  const proc = spawn(opencodeBin(), args, { env });
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
  // KEYED BY PROJECT. The URL is a port on a container that belongs to ONE project, and this module
  // is a process-wide singleton that outlives any of them. Without this, opening project B and
  // sending a message reached project A's box — and since `?directory=` is now the constant `/work`,
  // the agent read and wrote project A while the board, the transcript and the run records all said
  // B. Before containment the same singleton was safe, because the directory carried the real host
  // path; making the directory constant is what made the server have to be per-project.
  const root = projectRoot();
  if (urlPromise && urlProject !== root) {
    stopOpencodeServer();
  }
  if (!urlPromise) {
    urlProject = root;
    urlPromise = trackFailure(boxes ? startServerInBox(boxes) : startServer());
  }
  return urlPromise;
}

// A rejected promise is still a promise, and `if (!urlPromise)` is happy to keep it forever — so one
// slow cold start (an image pull past the readiness timeout, a busy daemon) wedged the backend for
// the life of the process, with nothing in the UI to say a restart would clear it. The child-process
// path self-healed through its `exit` handler; the boxed one has no child to hear from.
function trackFailure(p: Promise<string>): Promise<string> {
  return p.catch((err) => {
    if (urlPromise === p) {
      urlPromise = undefined;
      urlProject = undefined;
    }
    throw err;
  });
}

// Stop the managed server and start a fresh one, confined by whatever is in force now. Its everyday
// justification is a hung or stale server; it also covers one started before the profile was
// installed, which would otherwise keep serving unconfined until the app restarted.
export async function restartOpencodeServer(): Promise<string> {
  stopOpencodeServer();
  // Boxed, a restart REMOVES the container rather than killing a child: the server is the container's
  // main process, so there is nothing else to kill, and a box whose main process exited cannot be
  // exec'd into or restarted into a working state.
  if (boxes) {
    await boxes.stop(projectRoot(), 'opencode').catch(() => undefined);
    urlProject = projectRoot();
    urlPromise = trackFailure(startServerInBox(boxes));
  } else {
    urlProject = projectRoot();
    urlPromise = trackFailure(startServer());
  }
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
  // Cleared FIRST and unconditionally. It used to be cleared only alongside killing a child process,
  // which was fine while every managed server was one — a boxed server is the container's own main
  // process, so there is no child, and the cached URL survived every stop. The next turn then went on
  // talking to a server that had been stopped, or to a box that had been removed.
  urlPromise = undefined;
  urlProject = undefined;
  logs?.kill('SIGTERM');
  logs = undefined;
  if (child) {
    child.kill('SIGTERM');
    child = undefined;
    // Cleared here rather than on the child's exit event: this runs from a signal handler and from
    // `process.once('exit')`, where nothing asynchronous gets a turn.
    try {
      unlinkSync(opencodePidFile());
    } catch {
      /* never recorded, or already reaped */
    }
  }
}
