import { type ChildProcess, spawn } from 'node:child_process';
import { type CommandResult, tail } from '../core/verify.js';
import { GROUP_GRACE_MS, terminateGroup } from './process-group.js';

// Running one command a project declared as its own gate.
//
// Three decisions, all deliberate:
//
// 1. THROUGH A SHELL, because a gate is written by a person as a line they would type
//    (`npm test -- --run`), not as an argv array. What makes that acceptable is where the command comes
//    from: `foundation/CODE-QUALITY.md` and `foundation/TESTING.md`, which every agent box mounts
//    read-only along with the rest of `.vibeboard/`. A command read from a card, a
//    report or a run's output would be an agent choosing what this process executes — never do that.
//
//    Stated exactly, because the read-only mount is not the whole chain: pre-flight AUTHORS those
//    documents (decision 7), so the real sequence is agent-proposed text → explicit human approval → this
//    shell, unsandboxed, as the server user, inheriting the server's environment. The approval gate is
//    what carries the weight, and it is BUILT (C4): a document an agent rewrote sets `unreviewedGates`,
//    every dispatch is refused while it is non-empty, the loop refuses to run any foundation-declared
//    command at all, and only `POST /api/autopilot/gates-reviewed` clears it.
//
//    The environment is the part still open: `opts.env` exists so a caller can narrow it, nothing passes
//    it, and `RunOne` in verify.ts does not offer it — so a gate command inherits the server's whole
//    environment. Worth closing; do not read the approval gate as having closed it.
//
// 2. IT NEVER THROWS. The caller is a loop, and an exception here would end the run rather than the
//    verification. A command that cannot start is a failure carrying the reason.
//
// 3. IT ALWAYS ENDS, and it ends the whole GROUP. A gate that hangs must report explicit failure —
//    the spec cites Copilot's documented infinite loop, caused by a timeout reported ambiguously — and
//    `/bin/sh -c "npm test"` has the test runner as a GRANDCHILD, so killing the shell alone leaves it
//    running and spending. That is the orphan class decision 13 was written for.

export const COMMAND_TIMEOUT_MS = 600_000;

// Four times what `tail` keeps, so the tail is a tail of the output rather than of the last chunk that
// happened to arrive.
//
// UNGUARDED, deliberately, and this is the note rather than a test that pretends otherwise: because it
// is larger than `MAX_OUTPUT`, the final `tail` always dominates, so deleting this bound changes no
// observable result and no test can distinguish it. What it does is bound MEMORY while output streams —
// a runaway `while true; do echo` would otherwise be held whole on its way to being thrown away.
const MAX_HELD = 16_000;

// How long to let a pipe flush after the process has already exited. Long enough for output that is
// sitting unread, short enough that a command leaving a background child is not waited on.
const FLUSH_MS = 50;

// How long a timed-out command has to clean up after SIGTERM before SIGKILL — long enough for a test
// runner to remove its temp directories, short enough that a hung one is not waited on — is
// `GROUP_GRACE_MS`, which this module used to state again as its own 2000.
//
// Reconciled explicitly rather than merged blind: the two constants were written independently, for
// two audiences (a CLI agent flushing its report, a test runner cleaning up), and they turned out to be
// the same 2 seconds. So adopting the shared one changes no timing. If they had differed, the merge
// would have silently changed how long a hung `npm test` gets.

export function runCommand(
  command: string,
  opts: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  const timeoutMs = opts.timeoutMs ?? COMMAND_TIMEOUT_MS;
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let settled = false;
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
      // Belt and braces, and honestly unreached on Linux: a missing cwd and an unspawnable `/bin/sh`
      // both arrive as an 'error' EVENT, which the handler below turns into the same failure. Kept
      // because `spawn` is documented to throw on invalid options and the cost of being wrong here is a
      // rejected promise inside a loop, but it is NOT covered by a test — nothing observed it firing.
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
      // Nothing to time out once the command has ended. Without this guard a process that exited at
      // t-1ms could still be recorded as `timedOut`, and `commandFailed` treats that as a failure on its
      // own — a verdict contradicting the exit code it is carrying.
      if (settled) return;
      timedOut = true;
      // TERM first, KILL after a grace — decision 13's shape, and it is not ceremony here either: a test
      // runner killed outright leaves its temp directories behind, and this project has already lost four
      // weeks of runs to a filesystem whose inode table filled with exactly that kind of litter.
      //
      // `terminateGroup` rather than the copy of it that used to be here. `detached: true` makes the
      // child its own group leader, so its pid IS the pgid. What the shared one adds is the check this
      // copy never had: it samples the group's start time before the TERM and re-checks identity before
      // escalating, so a command that exits inside the grace period and has its pid reused cannot get a
      // stranger SIGKILLed. `settled` is passed in as a SECOND condition, not as the only one.
      if (child.pid !== undefined) terminateGroup(child.pid, GROUP_GRACE_MS, () => !settled);
    }, timeoutMs);
    // Unref'd so a pending timer cannot hold the process open after everything else has finished.
    timer.unref();

    const done = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Released explicitly. A background child the command left behind holds the read end open, and
      // without this the streams would sit there for as long as it lives.
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({ command, code, output: tail(output), timedOut });
    };
    child.on('error', (err) => {
      output += String(err);
      done(-1);
    });
    // `exit`, not only `close`. `close` waits for the process to end AND every inherited pipe to be
    // released — so a gate that exits 0 while leaving a background child (a server its smoke test
    // started, which is the designed use of `verify: smoke`) sat here until the timeout and came back
    // `{code: 0, timedOut: true}`: ten minutes of wall clock, an attempt burned, and a verdict saying it
    // was still running about a command that had exited immediately.
    //
    // The short grace before resolving is for the ordinary case: `exit` can arrive with output still
    // unread in the pipe, and `close` is what says there is none left. Whichever comes first wins, so a
    // command that closes its pipes cleanly is not delayed and one that does not is not waited on.
    child.on('exit', (code) => {
      setTimeout(() => done(code), FLUSH_MS).unref();
    });
    child.on('close', (code) => done(code));
  });
}
