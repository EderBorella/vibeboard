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
// 2. There is ONE path, and this module holds its gate. `agentRefusal` is called before any agent
//    starts — a dispatch, a chat turn, and auto-pilot when it lands — and it fails closed. An
//    earlier version made manual runs and the chat best-effort; that was reversed on 2026-08-02,
//    because two enforcement stories means the weaker one is what most people actually run.
//    `wrapCommand` itself never refuses: it is pure, and used by tests to build commands. The
//    refusal belongs at the entry points, where the caller can be told why.

export const SANDBOX_PROFILE = 'vibeboard-agent';

export type SandboxStatus = { ok: true; profile: string } | { ok: false; reason: string };

export const NOT_REQUESTED: SandboxStatus = { ok: false, reason: 'not requested' };

// How to fix it, not just what is wrong: this reason reaches the user in the startup banner, in
// Settings and in auto-pilot's refusal, and a dead end in any of those is worse than the condition.
const NOT_LOADED = 'AppArmor profile not loaded — run `npm run sandbox:install`';

export async function probeSandbox(): Promise<SandboxStatus> {
  return probeProfile(SANDBOX_PROFILE);
}

// Named rather than fixed, for one caller: the test suite confines its spawns with a profile that
// ships with the distribution (`unprivileged_userns`), so every test exercises the real gate and
// the real `aa-exec` path without anyone having to load ours, and without a bypass existing in the
// codebase for a gate to be bypassed through.
export async function probeProfile(profile: string): Promise<SandboxStatus> {
  if (process.platform !== 'linux') {
    return { ok: false, reason: `AppArmor is Linux-only, and this is ${process.platform}` };
  }
  try {
    // `cat` rather than reading the file ourselves: the point is what confines a CHILD process
    // after the transition, which is the same thing an agent turn is.
    const { stdout } = await run('aa-exec', ['-p', profile, '--', 'cat', '/proc/self/attr/current'], {
      // This runs at module top level in main.ts, before anything is printed. A wedged aa-exec
      // without this hangs the server at startup with an empty terminal and no way to tell why.
      timeout: 5_000,
    });
    // The kernel answers `vibeboard-agent (enforce)`. A profile in complain mode reports
    // `(complain)` and logs instead of denying, which is not a control either.
    if (!stdout.startsWith(`${profile} (enforce)`)) {
      return { ok: false, reason: `${NOT_LOADED} (kernel reports: ${stdout.trim() || 'nothing'})` };
    }
    return { ok: true, profile };
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

// Whether an agent may run at all, or why not. ONE function, deliberately: there were two — this
// one and an `sandboxRefusal(status, attachedUrl)` for auto-pilot — and they diverged. The gate on
// dispatch called the one that could not see an attached OpenCode server, so with the profile
// loaded and VIBEBOARD_OPENCODE_URL set, a turn ran in a process VibeBoard never wrapped while the
// gate said yes. Two functions answering one question is how that happens; there is now one.
//
// One path (ruled 2026-08-02, reversing an earlier best-effort tier): a dispatch, a chat turn and
// auto-pilot are all agents that auto-approve their own tool calls, and shipping two enforcement
// stories means the weaker one is what most people run. The board, the explorer and Settings are
// untouched — the app stays usable and says what to run.
//
// Fail-open guards are a trap, so every condition this cannot verify returns a reason, and every
// reason names the action that fixes it.
export function agentRefusal(status: SandboxStatus, attachedUrl: string | undefined): string | null {
  if (attachedUrl) {
    return [
      'Agents need a sandboxed backend. This project is attached to an OpenCode server VibeBoard',
      'did not start (VIBEBOARD_OPENCODE_URL), so its filesystem access cannot be restricted.',
      'Use "Take over with a managed server" in Settings, or unset the variable and restart.',
    ].join(' ');
  }
  if (!status.ok) {
    return `Agents are disabled: ${status.reason}. VibeBoard runs every agent inside an OS sandbox, and there is none here.`;
  }
  return null;
}
