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

// `ok` is "can this project run anything right now", and there is now more than one way for it to be
// no. `kind` says WHICH, and it exists so nothing downstream has to parse the sentence to find out.
//
// A DISCRIMINATOR RATHER THAN A FOURTH GATE, and that is the whole design. A stale credential could
// have been its own check with its own call sites; it is folded in here instead, because `agentRefusal`
// below is deliberately ONE function and the last time this codebase had two of them they diverged with
// a real failure. Widening the status means every gate that already refuses a missing image refuses a
// dead credential too, automatically, on the day it is added and on every day after.
// `backend` is the third, and it answers a question the other two cannot: docker being up and the credential
// being current says the machine COULD run an agent, not that the thing an agent talks to is alive. Measured
// 2026-08-16: an OpenCode server was destroyed under a live URL, every dispatch died in 449ms with
// `fetch failed`, three attempts were spent in five seconds — and both lights stayed green, because nothing
// was refusing and nothing had asked.
export type SandboxStatus =
  | { ok: true; image: string }
  | {
      ok: false;
      reason: string;
      kind: 'docker' | 'credential' | 'backend';
      // WOULD BUILDING THE IMAGE FIX THIS? Only ever true for the one fault that a build addresses.
      // `kind: 'docker'` covers both a missing daemon and a missing image, and offering to build against
      // a daemon that is not running is a button that cannot work — the fault a user reads and the
      // remedy a user is offered have to be the same fault.
      buildable?: true;
    };

// `docker`, because "not requested" is a statement about the container layer: nothing asked for a box,
// so nothing probed for one. It is not a credential we looked at and disbelieved.
export const NOT_REQUESTED: SandboxStatus = { ok: false, reason: 'not requested', kind: 'docker' };

interface SandboxProbe {
  probe(): Promise<{ ok: true } | { ok: false; reason: string; missing?: 'daemon' | 'image' }>;
}

// Whether the box is holding the credential the host currently has. Injected as a bare thunk rather
// than imported, so this file stays a decision about a status and needs no daemon and no filesystem to
// test; `credential-freshness.ts` is the implementation and `main.ts` is where the two meet.
export type CredentialCheck = () => Promise<{ fresh: true } | { fresh: false; reason: string }>;

// WHETHER THE THING AN AGENT TALKS TO IS ANSWERING. Injected as a bare thunk for the same reason the
// credential check is: this file stays a decision about a status and needs no network to test.
//
// ASYMMETRIC BETWEEN THE BACKENDS, deliberately, and the asymmetry is the honest part. OpenCode is a
// long-lived server, so "are you there?" is one cheap request. Claude Code is a process spawned per turn:
// there is no equivalent question that does not cost a real spawn, so that backend answers `live` and keeps
// the credential check as its only forward-looking gate. A symmetric check here would either spend money on
// every probe or prove nothing — this status therefore means slightly more for one backend than the other,
// which is worth saying out loud rather than papering over.
export type BackendCheck = () => Promise<{ live: true } | { live: false; reason: string }>;

// A LIVE answer, because the startup one was wrong the moment anybody touched Docker.
//
// `route-context.ts` used to say the status "cannot change while the process runs, so a function would
// only invite callers to wonder whether it might". It can, and it did: an image removed from under a
// running server left `GET /api/sandbox` answering `ok: true` for the life of the process. Demonstrated
// rather than reasoned about — tag an alias, start a server on it, `docker rmi` the tag, ask again.
//
// That is not merely a stale label. The same value is what `agentRefusal` consults at the three gates
// (a dispatch, a chat turn, auto-pilot starting), so a stale `ok` lets a run through to fail at
// container creation as a raw Docker error — the exact confusion this module's opening comment says the
// probe exists to prevent. And a stale `false` is what would make a "build the image" button appear to
// do nothing.
//
// TTL rather than a probe per call: the two `docker` calls cost 30-40ms measured, which is affordable
// per request but not per call when three gates and a route ask within one interaction. One second is
// far shorter than the interval between a human action and its consequence, and far longer than a burst.
export const SANDBOX_TTL_MS = 1_000;

// The current status, re-probed when the cached one is older than the TTL.
export type LiveSandbox = () => Promise<SandboxStatus>;

// A LiveSandbox that never changes its mind. For tests, which are about something other than Docker, and
// for the `NOT_REQUESTED` default — both want the call shape without the daemon.
export function fixedSandbox(status: SandboxStatus): LiveSandbox {
  return async () => status;
}

export function liveSandbox(
  service: SandboxProbe,
  image: string,
  // ONE cache for both halves, under the one TTL, behind the one shared in-flight promise. A second
  // cache for the credential would be a second thing to expire, and the two would then disagree for up
  // to a second at a time — which is the whole class of bug the live status was introduced to end.
  opts: { ttlMs?: number; now?: () => number; credential?: CredentialCheck; backend?: BackendCheck } = {},
): LiveSandbox {
  const ttl = opts.ttlMs ?? SANDBOX_TTL_MS;
  const now = opts.now ?? Date.now;
  let cached: { at: number; status: SandboxStatus } | undefined;
  // The in-flight probe is shared, so a burst of callers makes ONE pair of docker calls rather than one
  // each. Without this the three gates in a single dispatch would each spawn their own.
  let inFlight: Promise<SandboxStatus> | undefined;
  return async () => {
    if (cached && now() - cached.at < ttl) return cached.status;
    if (inFlight) return await inFlight;
    inFlight = probeSandbox(service, image, opts.credential, opts.backend)
      .then((status) => {
        cached = { at: now(), status };
        return status;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return await inFlight;
  };
}

// Injected rather than constructed, so this stays a pure decision and the tests need no daemon.
export async function probeSandbox(
  service: SandboxProbe,
  image: string,
  credential?: CredentialCheck,
  backend?: BackendCheck,
): Promise<SandboxStatus> {
  const res = await service.probe();
  // ORDER IS THE BEHAVIOUR, and only the docker answer decides whether the second question is even
  // asked. A missing daemon or a missing image is the more fundamental fault — the credential check
  // cannot run without docker anyway, and if it could, "rebuild the agent boxes" is useless advice to
  // someone whose image was never built. The first message is the one that helps, so it is the one
  // that survives; the credential fault is still there and is reported the moment docker is.
  if (!res.ok) {
    return {
      ok: false,
      reason: res.reason,
      kind: 'docker',
      ...(res.missing === 'image' ? { buildable: true as const } : {}),
    };
  }
  const cred = await credential?.();
  if (cred && !cred.fresh) return { ok: false, reason: cred.reason, kind: 'credential' };
  // LAST, and the order is the same argument again. A dead credential and an unanswering server are true
  // together far more often than either is true alone — an expired sign-in is WHY a server would be refusing
  // — and "fix your sign-in" is the sentence that helps. Asking anyway would also spend a request per probe
  // on a server that cannot work until the credential is fixed.
  const live = await backend?.();
  if (live && !live.live) return { ok: false, reason: live.reason, kind: 'backend' };
  return { ok: true, image };
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
    // BRANCHED ON THE CAUSE, because the tail was written when there was only one. "there is none
    // available here" is true of a missing daemon or an unbuilt image and FALSE of a stale credential —
    // there the container exists, is running, and is the very thing holding the dead sign-in. The
    // sentence reaches the user verbatim in the light's balloon, so a clause that contradicts the one
    // before it sends them to build an image they already have.
    if (status.kind === 'credential') return `Agents are disabled: ${status.reason}.`;
    return `Agents are disabled: ${status.reason}. VibeBoard runs every agent inside a container, and there is none available here.`;
  }
  return null;
}
