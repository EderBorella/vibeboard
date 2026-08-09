import { dockerBin, execArgs } from './containers.js';

// The agent sandbox: a Docker container per (project, backend), and the only place an agent runs.
//
// Three decisions live here and are worth stating once.
//
// 1. The check is a PROBE, not a lookup, and it happens BEFORE dispatch rather than being inferred
//    from a failure. `docker exec` into a stopped or missing container exits non-zero exactly as a
//    genuinely failing command does, so a broken sandbox and a broken agent are indistinguishable
//    after the fact. This was the same trap the AppArmor version had for a different reason, and the
//    answer is the same: ask first, and say what is wrong in terms of the thing that fixes it.
//
// 2. There is ONE path, and this module holds its gate. `agentRefusal` is called before any agent
//    starts — a dispatch, a chat turn, and auto-pilot — and it fails closed. An earlier version made
//    manual runs and the chat best-effort; that was reversed on 2026-08-02, because two enforcement
//    stories means the weaker one is what most people actually run.
//
// 3. DOCKER IS REQUIRED. Ruled 2026-08-09, replacing the AppArmor profile outright rather than
//    falling back to it. A fallback doubles the containment surface forever AND hands most users the
//    weaker guarantee, which is the 2026-08-02 mistake wearing different clothes. No docker, no
//    agents; the board, the explorer and Settings stay usable and the refusal names the fix.

export type SandboxStatus = { ok: true; image: string } | { ok: false; reason: string };

export const NOT_REQUESTED: SandboxStatus = { ok: false, reason: 'not requested' };

export interface SandboxProbe {
  probe(): Promise<{ ok: true } | { ok: false; reason: string }>;
}

// Injected rather than constructed, so this stays a pure decision and the tests need no daemon.
export async function probeSandbox(service: SandboxProbe, image: string): Promise<SandboxStatus> {
  const res = await service.probe();
  return res.ok ? { ok: true, image } : { ok: false, reason: res.reason };
}

// `aa-exec -p <profile> -- bin args` became `docker exec -w /work <box> bin args`.
//
// THE BOX IS REQUIRED WHEN THE STATUS IS OK, and its absence throws rather than quietly returning an
// unconfined command. A profile name was a constant; a box is a resource that something must have
// created first, so "confined" is no longer a property of the status alone. Returning `bin` unchanged
// here — the old behaviour for a missing sandbox — would run the agent on the host with nothing
// confining it, and every caller would see a perfectly ordinary command.
export function wrapCommand(
  bin: string,
  args: string[],
  status: SandboxStatus,
  box?: string,
  env: Record<string, string> = {},
): { bin: string; args: string[] } {
  if (!status.ok) return { bin, args };
  if (!box) {
    throw new Error('refusing to run an agent unconfined: the sandbox is available but no box was supplied');
  }
  return { bin: dockerBin(), args: execArgs(box, bin, args, env) };
}

// Whether an agent may run at all, or why not. ONE function, deliberately: there were two — this one
// and a `sandboxRefusal(status, attachedUrl)` for auto-pilot — and they diverged. The gate on dispatch
// called the one that could not see an attached OpenCode server, so with the sandbox available and
// VIBEBOARD_OPENCODE_URL set, a turn ran in a process VibeBoard never wrapped while the gate said yes.
//
// Fail-open guards are a trap, so every condition this cannot verify returns a reason, and every
// reason names the action that fixes it.
export function agentRefusal(status: SandboxStatus, attachedUrl: string | undefined): string | null {
  if (attachedUrl) {
    return [
      'Agents need a sandboxed backend. This project is attached to an OpenCode server VibeBoard',
      'did not start (VIBEBOARD_OPENCODE_URL), so it is not running in a container and its filesystem',
      'access cannot be restricted. Use "Take over with a managed server" in Settings, or unset the',
      'variable and restart.',
    ].join(' ');
  }
  if (!status.ok) {
    return `Agents are disabled: ${status.reason}. VibeBoard runs every agent inside a container, and there is none available here.`;
  }
  return null;
}
