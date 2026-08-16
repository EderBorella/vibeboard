import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { openTestProject, tempDir, wsClient } from './helpers.js';

// CLOSING THE APP MUST STOP THE AGENT IT STARTED.
//
// THE LEAK THIS EXISTS FOR, counted on a real machine 2026-08-16: 54 orphaned shim processes, in 27
// pairs, the oldest running for a day and eighteen hours, and two more every time the copilot tests
// ran. `app.close()` shut the HTTP server and nothing else, so a turn still in flight was abandoned —
// and because a turn is spawned into its OWN process group (which is what makes the group-kill on
// cancel work), losing its parent only reparents it to init. It then runs forever.
//
// This is not test hygiene. `main.ts` had the same gap: its signal handler cancelled runs, the
// auto-pilot loop, the OpenCode server and the boxes, and never the chat's turn. In production that
// pair survives only by accident, because the agent it wraps dies with the container.
//
// THE ASSERTION IS THE OPERATING SYSTEM'S, not the suite's. Nothing this shim prints could prove it
// exited — a process that is never going to exit prints exactly what a healthy one prints. So the shim
// records its pid and the test asks the kernel, which is the only party that actually knows.

const here = dirname(fileURLToPath(import.meta.url));
const SLOW = join(here, 'fixtures', 'slow-claude.mjs');

beforeAll(() => {
  chmodSync(SLOW, 0o755);
});

const alive = (pid: number): boolean => {
  try {
    // Signal 0 checks for the process's existence and permission to signal it, and sends nothing.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// The pid the shim wrote, waited for rather than read once: the spawn and the file write race the
// assertion, and a `0` read from a half-written file is a pid this test would then never find.
async function shimPid(file: string): Promise<number> {
  for (let i = 0; i < 200; i++) {
    if (existsSync(file)) {
      const first = readFileSync(file, 'utf8').split('\n')[0]?.trim();
      if (first) return Number(first);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('the shim never reported a pid');
}

describe('an app closed while a chat turn is running', () => {
  it('takes the agent process down with it', async () => {
    const saved = process.env.VIBEBOARD_CLAUDE_BIN;
    const pidFile = join(await tempDir(), 'shim.pid');
    process.env.VIBEBOARD_CLAUDE_BIN = SLOW;
    process.env.VIBEBOARD_SHIM_PID = pidFile;
    writeFileSync(pidFile, '', 'utf8');
    try {
      const { app } = await openTestProject({ name: 'Shutdown' });
      const address = await app.listen({ port: 0, host: '127.0.0.1' });
      const c = wsClient(address);
      await c.open;

      // A turn that announces itself and then holds, exactly like a long real one. The shim never
      // exits on its own; only a cancel ends it, which is the whole point.
      c.send({ type: 'copilot:send', text: 'the long turn' });
      const pid = await shimPid(pidFile);

      // The premise, asserted rather than assumed. Without this the test would pass just as happily
      // against a shim that had already died for some unrelated reason, and would then be pinning
      // nothing at all.
      expect(alive(pid), 'the agent must actually be running before the app is closed').toBe(true);

      await app.close();

      // Polled, not asserted once: a signal is delivered asynchronously and the process has to be
      // reaped before it stops existing. Two seconds is far longer than that takes and far shorter
      // than the leak, which is unbounded.
      for (let i = 0; i < 80 && alive(pid); i++) await new Promise((r) => setTimeout(r, 25));
      expect(alive(pid), `agent ${pid} outlived the app that started it`).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.VIBEBOARD_CLAUDE_BIN;
      else process.env.VIBEBOARD_CLAUDE_BIN = saved;
      delete process.env.VIBEBOARD_SHIM_PID;
    }
  }, 30_000);
});
