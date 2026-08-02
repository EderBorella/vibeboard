import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { opencodePidFile, reapOrphanServer } from '../src/server/opencode-server.js';
import { tempDir } from './helpers.js';

// The shutdown handlers in main.ts cover catchable signals. SIGKILL, an OOM kill and a crashed host
// are not among them, and each leaves `opencode serve` alive for as long as the machine is up. The
// pid file is what covers those, and its dangerous edge is pid reuse.

// EPERM means the process exists and is somebody else's. Treating it as "gone" would make this
// helper report pid 1 as dead, and any test built on it would pass for the wrong reason.
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

// Real time and a generous margin: SIGTERM delivery and process teardown are the kernel's business,
// and a faked clock observes neither.
async function waitGone(pid: number): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

const spawned: number[] = [];
afterEach(() => {
  for (const pid of spawned.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  delete process.env.VIBEBOARD_OPENCODE_PID_FILE;
});

// `exec -a` sets argv[0], which is what /proc/<pid>/cmdline reports — so this looks like the real
// thing to the reaper without needing opencode installed.
function fakeProcess(argv0: string): number {
  const child = spawn('bash', ['-c', `exec -a "${argv0}" sleep 30`], { stdio: 'ignore' });
  const pid = child.pid as number;
  spawned.push(pid);
  return pid;
}

describe('reapOrphanServer', () => {
  it('kills a recorded server that is still running', async () => {
    process.env.VIBEBOARD_OPENCODE_PID_FILE = join(await tempDir(), 'opencode.pid');
    const pid = fakeProcess('opencode serve');
    await new Promise((r) => setTimeout(r, 300)); // let bash exec into it
    writeFileSync(opencodePidFile(), `${pid}\n`, 'utf8');

    reapOrphanServer();

    expect(await waitGone(pid)).toBe(true);
  });

  // The one that matters. Pids are reused, so the number in the file may belong to something else
  // entirely by the time we read it — and killing a stranger's process because it inherited a pid
  // is far worse than the orphan being cleaned up.
  it('leaves a process alone when its command line is not opencode', async () => {
    process.env.VIBEBOARD_OPENCODE_PID_FILE = join(await tempDir(), 'opencode.pid');
    const pid = fakeProcess('some-unrelated-daemon');
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(opencodePidFile(), `${pid}\n`, 'utf8');

    reapOrphanServer();
    await new Promise((r) => setTimeout(r, 300));

    expect(alive(pid)).toBe(true);
  });

  it('does nothing when there is no record, and nothing for a pid that is gone', async () => {
    process.env.VIBEBOARD_OPENCODE_PID_FILE = join(await tempDir(), 'opencode.pid');
    expect(() => reapOrphanServer()).not.toThrow();
    writeFileSync(opencodePidFile(), '999999999\n', 'utf8');
    expect(() => reapOrphanServer()).not.toThrow();
  });

  it('refuses to signal pid 1 or a file that is not a number', async () => {
    // `kill(1)` from a container's pid namespace is a real way to take down the whole app.
    process.env.VIBEBOARD_OPENCODE_PID_FILE = join(await tempDir(), 'opencode.pid');
    for (const contents of ['1', '0', '-1', 'not-a-pid', '']) {
      writeFileSync(opencodePidFile(), contents, 'utf8');
      expect(() => reapOrphanServer(), contents).not.toThrow();
    }
    expect(alive(1)).toBe(true);
  });
});
