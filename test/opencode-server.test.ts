import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxManager } from '../src/server/boxes/box-manager.js';
import { BoxService } from '../src/server/boxes/box-service.js';
import type { DockerRun } from '../src/server/boxes/containers.js';
import {
  attachBoxes,
  attachedOpencodeUrl,
  attachOpencodeLogger,
  attachProjectRoot,
  opencodeBaseUrl,
  opencodeDirectory,
  restartOpencodeServer,
  stopOpencodeServer,
} from '../src/server/boxes/opencode-server.js';
import { agentRefusal } from '../src/server/boxes/sandbox.js';
import { testTmp } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const SHIM = join(here, 'fixtures', 'fake-opencode.mjs');

const LIVE_SANDBOX = { ok: true as const, image: 'vibeboard-agent:test' };

// A stand-in for `opencode serve` inside a box: a real HTTP server on a real port, so the readiness
// wait is exercised rather than stubbed out. `docker port` is made to answer with this port.
let stub: Server | undefined;
let stubPort = 0;
let stubHits = 0;

async function startStub(): Promise<void> {
  stubHits = 0;
  stub = createServer((_req, res) => {
    stubHits += 1;
    res.end('{}');
  });
  const server = stub;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the stub did not get a port');
  stubPort = address.port;
}

// A BoxService over a recording docker that answers as a healthy daemon would.
async function boxedStart(): Promise<{ calls: string[][]; port: string }> {
  await startStub();
  const calls: string[][] = [];
  const docker: DockerRun = async (args) => {
    calls.push(args);
    if (args[0] === 'inspect') return { code: 1, stdout: '', stderr: 'No such object' };
    if (args[0] === 'port') return { code: 0, stdout: `127.0.0.1:${stubPort}\n`, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  attachBoxes(new BoxService({ manager: new BoxManager({ docker, user: '1000:1000' }) }));
  attachProjectRoot(() => '/data/projects/demo');
  const url = await opencodeBaseUrl();
  return { calls, port: url };
}

// Saved and restored, not deleted. Nothing sets these today, so deleting is harmless right now —
// but the environment is shared with every other test file in the worker, and "harmless right now"
// is exactly how this repo previously got non-deterministic Stryker verdicts.
const ENV_KEYS = [
  'VIBEBOARD_OPENCODE_URL',
  'VIBEBOARD_OPENCODE_BIN',
  'VIBEBOARD_OPENCODE_PID_FILE',
  'VIBEBOARD_FAKE_OPENCODE_LOG',
] as const;
const saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  stopOpencodeServer();
  attachBoxes(undefined);
  delete process.env.VIBEBOARD_FAKE_DOCKER_LOGS;
  stub?.close();
  stub = undefined;
  for (const key of ENV_KEYS) {
    const was = saved.get(key);
    if (was === undefined) delete process.env[key];
    else process.env[key] = was;
  }
});

interface Spawned {
  pid: number;
  argv: string[];
  confinement: string;
}

// Every spawn the shim has recorded, in order. A count, not just the latest: a restart that leaves
// an extra server behind is invisible if you only ever read the last line.
let shimLog = '';
function spawns(): Spawned[] {
  return readFileSync(shimLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Spawned);
}

async function startWithShim(): Promise<Spawned> {
  const dir = await mkdtemp(join(testTmp(), 'vibeboard-oc-'));
  shimLog = join(dir, 'server.jsonl');
  process.env.VIBEBOARD_OPENCODE_BIN = SHIM;
  process.env.VIBEBOARD_OPENCODE_PID_FILE = join(dir, 'opencode.pid');
  process.env.VIBEBOARD_FAKE_OPENCODE_LOG = shimLog;
  await opencodeBaseUrl();
  return spawns().at(-1) as Spawned;
}

// EPERM means it exists and belongs to somebody else; treating that as "gone" would make every
// assertion below pass for the wrong reason.
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

async function waitGone(pid: number): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe('the managed server, in its box', () => {
  // This backend is the reason a command wrapper was not enough. Claude Code is one process per turn,
  // so wrapping the command covers it; `opencode serve` is a long-lived server VibeBoard talks to over
  // HTTP, so containment here means the server IS the container's main process — plus the port
  // discovery that comes with that. These assert the argv that arranges it.

  it('runs `opencode serve` as the box itself, on a FIXED container port bound to 0.0.0.0', async () => {
    const { calls, port } = await boxedStart();
    const run = calls.find((c) => c[0] === 'run' && c.includes('--name'));
    expect(run).toBeDefined();
    const joined = (run ?? []).join(' ');
    // 0.0.0.0 INSIDE the box: the container's loopback is its own, so a server bound there cannot be
    // reached from the host at all — including by VibeBoard.
    expect(joined).toContain('opencode serve --port 4096 --hostname 0.0.0.0');
    // And published to the HOST's loopback only, never every interface: this server auto-approves
    // every tool call it is asked to make.
    expect(joined).toContain('-p 127.0.0.1::4096');
    expect(joined).not.toMatch(/-p 0\.0\.0\.0/);
    // The host port is docker's choice, read back — a fixed one would collide across projects.
    expect(port).toContain(`:${stubPort}`);
  });

  it('waits for the server to actually answer before handing out its URL', async () => {
    // The old spawn parsed a "listening on" line off stdout. There is no child process to read now,
    // so readiness is "answers HTTP" — and a URL handed out before that turns the first turn into an
    // ECONNREFUSED that reads like the backend being broken.
    const { port } = await boxedStart();
    expect(stubHits).toBeGreaterThan(0);
    expect(port).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });

  it('follows the box’s log into VibeBoard’s own, at the levels the child version used', async () => {
    // The regression this prevents: spawning the server as a CHILD gave us its pipes for free, and a
    // box does not. Without a deliberate follower, everything the provider says goes to `docker logs`
    // — where nobody reading a VibeBoard log will find it — and a failed turn is once again
    // "Streaming response failed" with no explanation anywhere.
    const dir = await mkdtemp(join(testTmp(), 'vibeboard-oclog-'));
    const file = join(dir, 'box.log');
    writeFileSync(file, 'provider error: no credentials for anthropic\n');
    process.env.VIBEBOARD_FAKE_DOCKER_LOGS = file;
    const lines: Record<string, unknown>[] = [];
    attachOpencodeLogger({
      warn: (obj: unknown, msg?: string) => lines.push({ level: 'warn', msg, ...(obj as object) }),
      debug: (obj: unknown, msg?: string) => lines.push({ level: 'debug', msg, ...(obj as object) }),
      info: () => {},
      error: () => {},
      child: () => undefined,
    } as never);

    await boxedStart();
    await vi.waitFor(() => expect(lines.some((l) => String(l.msg).includes('provider error'))).toBe(true));
    // stdout is per-request chatter and would bury the file at info; stderr is what is worth reading.
    // `docker logs` merges them onto stdout unless asked otherwise, so this arrives at debug.
    expect(lines.find((l) => String(l.msg).includes('provider error'))?.level).toBe('debug');
  });

  it('translates the project directory to the path the box sees', async () => {
    // Measured in the POC: creating a session with the HOST path returns 200 and the message then
    // fails with an anonymous "Unexpected server error. Check server logs for details." — it names
    // neither the directory nor the cause, so it reads as an opencode bug rather than a path that
    // means nothing on the other side of a mount.
    await boxedStart();
    expect(opencodeDirectory('/data/projects/demo')).toBe('/work');
  });

  it('leaves the directory alone when there is no box', async () => {
    attachBoxes(undefined);
    expect(opencodeDirectory('/data/projects/demo')).toBe('/data/projects/demo');
  });
});

describe('restarting', () => {
  it('replaces the server and leaves nothing behind', async () => {
    const first = await startWithShim();
    await restartOpencodeServer();

    // Exactly two servers have ever existed. Before the exit handler was scoped to its own process,
    // the dying first server cleared the module state the restart had just written — so the NEXT
    // call spawned a third, on a different port, with nothing recording its pid.
    const all = spawns();
    expect(all).toHaveLength(2);
    expect(all[1].pid).not.toBe(first.pid);
    expect(await waitGone(first.pid)).toBe(true);

    // And the survivor is the one we are tracking: another call must not spawn again.
    await opencodeBaseUrl();
    expect(spawns()).toHaveLength(2);
    expect(alive(all[1].pid)).toBe(true);
  });

  it('leaves no server alive after it is stopped', async () => {
    await startWithShim();
    await restartOpencodeServer();
    const last = spawns().at(-1) as Spawned;
    stopOpencodeServer();
    // The orphan this whole guard exists to prevent: a server outliving the app that started it.
    expect(await waitGone(last.pid)).toBe(true);
  });
});

describe('the agent gate', () => {
  it('allows an agent when sandboxed and managing its own server', () => {
    expect(agentRefusal(LIVE_SANDBOX, undefined)).toBeNull();
  });

  it('refuses when there is no sandbox, and repeats the reason', () => {
    const reason = agentRefusal({ ok: false, reason: 'profile not loaded' }, undefined);
    // The reason travels: a refusal that says "no" without saying which condition failed leaves the
    // user with nothing to act on, and this string reaches the UI verbatim.
    expect(reason).toContain('profile not loaded');
  });

  it('refuses when attached to a server VibeBoard did not start, even with a sandbox', () => {
    // A loaded profile is not enough. We did not spawn that process, so nothing wrapped it.
    const reason = agentRefusal(LIVE_SANDBOX, 'http://127.0.0.1:9999');
    expect(reason).toContain('VIBEBOARD_OPENCODE_URL');
    expect(reason).toContain('Take over with a managed server');
  });
});

describe('attachedOpencodeUrl', () => {
  it('reads the variable per call, so a take-over stops the refusal', () => {
    process.env.VIBEBOARD_OPENCODE_URL = 'http://127.0.0.1:9999';
    expect(attachedOpencodeUrl()).toBe('http://127.0.0.1:9999');
    delete process.env.VIBEBOARD_OPENCODE_URL;
    // Captured once at import, this would still be refusing after the user took over.
    expect(attachedOpencodeUrl()).toBeUndefined();
  });

  it('treats an empty variable as unset', () => {
    // `VIBEBOARD_OPENCODE_URL=` in a .env is a user turning it OFF, not attaching to "".
    process.env.VIBEBOARD_OPENCODE_URL = '';
    expect(attachedOpencodeUrl()).toBeUndefined();
    expect(agentRefusal(LIVE_SANDBOX, attachedOpencodeUrl())).toBeNull();
  });
});
