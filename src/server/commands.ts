import { type ChildProcess, spawn } from 'node:child_process';
import { type CommandResult, tail } from '../core/verify.js';

// Running one command a project declared as its own gate.
//
// Three decisions, all deliberate:
//
// 1. THROUGH A SHELL, because a gate is written by a person as a line they would type
//    (`npm test -- --run`), not as an argv array. That is only defensible because of where the command
//    comes from: `foundation/CODE-QUALITY.md` and `foundation/TESTING.md`, which the AppArmor profile
//    denies every agent write access to (`tools/apparmor/vibeboard-agent`). A command read from a card,
//    a report or a run's output would be an agent choosing what this process executes — never do that.
//
// 2. IT NEVER THROWS. The caller is a loop, and an exception here would end the run rather than the
//    verification. A command that cannot start is a failure carrying the reason.
//
// 3. IT ALWAYS ENDS, and it ends the whole GROUP. A gate that hangs must report explicit failure —
//    the spec cites Copilot's documented infinite loop, caused by a timeout reported ambiguously — and
//    `/bin/sh -c "npm test"` has the test runner as a GRANDCHILD, so killing the shell alone leaves it
//    running and spending. That is the orphan class decision 13 was written for.

export const COMMAND_TIMEOUT_MS = 600_000;

// Four times what is kept, so the tail is a tail of the output rather than of the last chunk that
// happened to arrive. Bounded as it streams, because a runaway `while true; do echo` would otherwise be
// held whole in memory on its way to being thrown away.
const MAX_HELD = 16_000;

export function runCommand(
  command: string,
  opts: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  const timeoutMs = opts.timeoutMs ?? COMMAND_TIMEOUT_MS;
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let child: ChildProcess;
    try {
      child = spawn('/bin/sh', ['-c', command], {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        // Its own process group, so the timeout can take the grandchildren with it.
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      // A cwd that does not exist throws here on some platforms and emits 'error' on others, so both
      // paths end the same way: a failure with the reason in the output.
      resolve({ command, code: -1, output: String(err), timedOut: false });
      return;
    }
    // ONE buffer for both streams, so interleaving is preserved: a stack trace split across two fields
    // is a stack trace nobody can read.
    const capture = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      if (output.length > MAX_HELD) output = output.slice(-MAX_HELD);
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        // Negative pid: the group. A pid of 0 or 1 would be our own group or init, and `detached: true`
        // means the child IS the leader — but the guard costs nothing and the mistake is unrecoverable.
        if (child.pid !== undefined && child.pid > 1) process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already gone, which is the ending we wanted anyway */
      }
    }, timeoutMs);
    // Unref'd so a pending timer cannot hold the process open after everything else has finished.
    timer.unref();

    const done = (code: number | null): void => {
      clearTimeout(timer);
      resolve({ command, code, output: tail(output), timedOut });
    };
    child.on('error', (err) => {
      output += String(err);
      done(-1);
    });
    child.on('close', (code) => done(code));
  });
}
