import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  attachedOpencodeUrl,
  attachSandbox,
  opencodeBaseUrl,
  restartOpencodeServer,
  stopOpencodeServer,
} from '../src/server/opencode-server.js';
import { NOT_REQUESTED, probeSandbox, SANDBOX_PROFILE, sandboxRefusal } from '../src/server/sandbox.js';

const here = dirname(fileURLToPath(import.meta.url));
const SHIM = join(here, 'fixtures', 'fake-opencode.mjs');

const live = await probeSandbox();
if (!live.ok) console.warn(`\n  ⚠ opencode sandbox test SKIPPED: ${live.reason}\n`);

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
  attachSandbox(NOT_REQUESTED);
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
  const dir = await mkdtemp(join(tmpdir(), 'vibeboard-oc-'));
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

describe('the managed server', () => {
  it('spawns unconfined when there is no sandbox', async () => {
    attachSandbox(NOT_REQUESTED);
    // NOT `toBe('unconfined')`: the fixture records 'unknown' on macOS, where /proc/self/attr does
    // not exist, and an `unconfined_u:…` label under SELinux. This test is deliberately not skipped
    // on those platforms, and what it means is "the profile did not apply".
    expect((await startWithShim()).confinement).not.toBe(`${SANDBOX_PROFILE} (enforce)`);
  });

  it.skipIf(!live.ok)('spawns inside the profile when there is one', async () => {
    attachSandbox(live);
    // The server, not just the turn: one `opencode serve` runs every turn for every project, so
    // this single process is where that whole backend is either confined or not.
    expect((await startWithShim()).confinement).toBe(`${SANDBOX_PROFILE} (enforce)`);
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

describe('the auto-pilot gate', () => {
  it('allows auto-pilot when sandboxed and managing its own server', () => {
    expect(sandboxRefusal({ ok: true, profile: SANDBOX_PROFILE }, undefined)).toBeNull();
  });

  it('refuses when there is no sandbox, and repeats the reason', () => {
    const reason = sandboxRefusal({ ok: false, reason: 'profile not loaded' }, undefined);
    // The reason travels: a refusal that says "no" without saying which condition failed leaves the
    // user with nothing to act on, and this string reaches the UI verbatim.
    expect(reason).toContain('profile not loaded');
  });

  it('refuses when attached to a server VibeBoard did not start, even with a sandbox', () => {
    // A loaded profile is not enough. We did not spawn that process, so nothing wrapped it.
    const reason = sandboxRefusal({ ok: true, profile: SANDBOX_PROFILE }, 'http://127.0.0.1:9999');
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
    expect(sandboxRefusal({ ok: true, profile: SANDBOX_PROFILE }, attachedOpencodeUrl())).toBeNull();
  });
});
