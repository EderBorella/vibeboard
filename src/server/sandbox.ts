import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// The agent sandbox: an AppArmor profile that lets a run build the project and denies it everything
// that governs the project.
//
// Two decisions live here and are worth stating once.
//
// 1. The check is a PROBE, not a lookup. Whether a run is confined depends on three separate
//    things — the profile being loaded, the kernel having AppArmor on, and the transition being
//    permitted (kernel.apparmor_restrict_unprivileged_unconfined) — and no single file on disk
//    answers all three. So we transition and ask the kernel what confines us. A profile that
//    exists and a profile that applies are different facts, and only one of them is a control.
//
// 2. Confinement is BEST-EFFORT here and mandatory elsewhere. This module never refuses: where
//    there is no sandbox it hands back the plain command, so manual runs and the chat still work on
//    a Mac or an unprepared Linux box. Auto-pilot's own gate is `sandboxRefusal`, which fails
//    closed. Merging the two would mean choosing between an app whose main feature refuses to run
//    and a sandbox that is optional for the loop it exists to bound.

export const SANDBOX_PROFILE = 'vibeboard-agent';

export type SandboxStatus = { ok: true; profile: string } | { ok: false; reason: string };

export const NOT_REQUESTED: SandboxStatus = { ok: false, reason: 'not requested' };

// How to fix it, not just what is wrong: this reason reaches the user in the startup banner, in
// Settings and in auto-pilot's refusal, and a dead end in any of those is worse than the condition.
const NOT_LOADED = 'AppArmor profile not loaded — run `npm run sandbox:install`';

export async function probeSandbox(): Promise<SandboxStatus> {
  if (process.platform !== 'linux') {
    return { ok: false, reason: `AppArmor is Linux-only, and this is ${process.platform}` };
  }
  try {
    // `cat` rather than reading the file ourselves: the point is what confines a CHILD process
    // after the transition, which is the same thing an agent turn is.
    const { stdout } = await run('aa-exec', ['-p', SANDBOX_PROFILE, '--', 'cat', '/proc/self/attr/current'], {
      // This runs at module top level in main.ts, before anything is printed. A wedged aa-exec
      // without this hangs the server at startup with an empty terminal and no way to tell why.
      timeout: 5_000,
    });
    // The kernel answers `vibeboard-agent (enforce)`. A profile in complain mode reports
    // `(complain)` and logs instead of denying, which is not a control either.
    if (!stdout.startsWith(`${SANDBOX_PROFILE} (enforce)`)) {
      return { ok: false, reason: `${NOT_LOADED} (kernel reports: ${stdout.trim() || 'nothing'})` };
    }
    return { ok: true, profile: SANDBOX_PROFILE };
  } catch (err) {
    // aa-exec missing, profile absent, or the transition refused. All three mean the same thing to
    // a caller, and the message says which for whoever has to fix it.
    return {
      ok: false,
      reason: `${NOT_LOADED} (${err instanceof Error ? err.message.split('\n')[0] : String(err)})`,
    };
  }
}

export function wrapCommand(
  bin: string,
  args: string[],
  status: SandboxStatus,
): { bin: string; args: string[] } {
  if (!status.ok) return { bin, args };
  return { bin: 'aa-exec', args: ['-p', status.profile, '--', bin, ...args] };
}

// Whether auto-pilot may start, or why not. Fail-open guards are a trap, so this returns a reason
// for every condition it cannot verify — and each reason names the action that fixes it.
export function sandboxRefusal(status: SandboxStatus, attachedUrl: string | undefined): string | null {
  if (attachedUrl) {
    return [
      'Auto-pilot needs a sandboxed backend. This project is attached to an OpenCode server',
      'VibeBoard did not start (VIBEBOARD_OPENCODE_URL), so its filesystem access cannot be',
      'restricted. Use "Take over with a managed server" in Settings, or unset the variable',
      'and restart.',
    ].join(' ');
  }
  if (!status.ok) return `Auto-pilot needs a sandbox and there is none: ${status.reason}.`;
  return null;
}
