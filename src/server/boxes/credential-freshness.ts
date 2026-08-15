import { statSync } from 'node:fs';
import { spawnDocker } from './box-manager.js';
import { type BoxBackend, boxName, type DockerRun, inspectState } from './containers.js';
import { boxCredentialPath } from './copilot-env.js';

// Whether the Claude box is holding the credential the host currently has, or a corpse of one.
//
// THE FAILURE THIS EXISTS FOR, measured on a live machine 2026-08-15. A claude-code box bind-mounts a
// single FILE, `~/.claude/.credentials.json`. Claude Code refreshes its OAuth token by atomic replace —
// write a temporary file, rename it over the target — which produces a NEW INODE. A file bind-mount is
// pinned to the inode it was created against, so the box goes on reading the old one, now unlinked, for
// as long as it lives: the host had inode 5280206 with link count 1, and inside the box the same path
// was inode 5303483 with link count 0 (`/proc/self/mountinfo` showed the source as `...//deleted`).
//
// The cost was not a slow turn. Every agent turn died in 58ms with "Failed to authenticate: OAuth
// session expired and could not be refreshed", auto-pilot burned all three of a card's attempts on it,
// and then reported the CARD as stalled — an infrastructure fault misreported as a content fault, with
// nothing anywhere on screen saying otherwise. That is why this is a status the light can go offline
// on rather than a log line.
//
// WHY INODE NUMBERS AND NOT THE FILE. Comparing `stat -c '%i'` across the boundary is exact — it is the
// pinning itself, observed, not a proxy for it — costs one `docker exec`, and reads no credential
// content at all. Nothing here ever opens, logs or quotes the file; a number is the whole answer.

export type CredentialFreshness = { fresh: true } | { fresh: false; reason: string };

const FRESH: CredentialFreshness = { fresh: true };

// The host inode, or undefined when there is no such file. `throwIfNoEntry: false` rather than a
// try/catch, so a genuinely broken stat still throws where we would want to know about it.
function hostInodeOf(path: string): number | undefined {
  return statSync(path, { throwIfNoEntry: false })?.ino;
}

// EVERY UNCERTAIN ANSWER IS `fresh`, AND THAT DIRECTION IS THE DECISION.
//
// This is the one place in the sandbox gate that fails OPEN, which is the opposite of every other rule
// in sandbox.ts, so the reasoning belongs here and not spread across the callers. The rest of the gate
// answers "is the containment I promised actually present" — a wrong `yes` there runs an agent
// unconfined, so it must fail closed. This answers "is a working machine secretly broken", where a
// wrong `no` disables a machine that runs perfectly well, and the person has no way to overrule it.
//
// A missing box, a stopped box and a docker that will not answer are all states in which we have
// observed nothing. In two of them `ensure()` is about to build or start a box against the CURRENT
// credential anyway, so there is nothing stale to find; in the third we have no evidence of any kind
// and inventing some would be a refusal with a fabricated cause on it. The bug this module is about is
// loud once it happens — three attempts in 58ms each — and it is caught on the next probe, one second
// later, as soon as docker answers. Guessing buys nothing and costs a working project.
export async function credentialFreshness(opts: {
  docker: DockerRun;
  box: string;
  backend: BoxBackend;
  path: string;
  hostInode: (path: string) => number | undefined;
}): Promise<CredentialFreshness> {
  // The OpenCode box has no Claude credential mounted at all — that separation is S2, and asking it
  // about this path would answer about a file that is not there. Checked before anything is spawned,
  // so the opencode backend costs no docker call whatsoever.
  if (opts.backend !== 'claude-code') return FRESH;
  const host = opts.hostInode(opts.path);
  // No credential on the host is a different fault with a different fix — the CLI says so itself, at
  // the point of use. There is no inode to disagree with, so there is nothing for this to report.
  if (host === undefined) return FRESH;

  const found = await inspectState(opts.docker, opts.box);
  if (found.state !== 'running') return FRESH;

  const res = await opts.docker(['exec', opts.box, 'stat', '-c', '%i', opts.path]);
  if (res.code !== 0) return FRESH;
  const inside = Number.parseInt(res.stdout.trim(), 10);
  if (!Number.isFinite(inside)) return FRESH;
  if (inside === host) return FRESH;

  return {
    fresh: false,
    // Named as the thing the person does, in the same shape as the other refusals: what is wrong, and
    // the button that fixes it. "Rebuild" and not "restart" because the mount is fixed when the
    // container is CREATED — starting the same container again re-pins the same dead inode.
    reason: [
      'the agent box is holding a sign-in that has been replaced on this machine — the CLI refreshed its',
      'token into a new file and the box is still mounted onto the old one, so every turn fails to',
      'authenticate. Use "Rebuild the agent boxes" in Settings to pick up the current one',
    ].join(' '),
  };
}

// The check as the sandbox status wants it: no arguments, current project, current answer.
//
// The project root is a FUNCTION and not a value. `liveSandbox` is built once at startup, and the open
// project changes underneath it every time somebody switches — a captured root would go on probing a
// box belonging to a project nobody is looking at, and would answer for the wrong one.
export function claudeCredentialCheck(
  projectRoot: () => string | undefined,
  opts: {
    docker?: DockerRun;
    path?: string;
    hostInode?: (path: string) => number | undefined;
  } = {},
): () => Promise<CredentialFreshness> {
  return async () => {
    const root = projectRoot();
    // No project open means no box of ours is running for one, and nothing is about to dispatch.
    if (root === undefined) return FRESH;
    return await credentialFreshness({
      docker: opts.docker ?? spawnDocker,
      box: boxName(root, 'claude-code'),
      backend: 'claude-code',
      // Never a hardcoded `~/.claude/.credentials.json`: this is the path the mount makes mean the same
      // file on both sides, and it is `copilot-env.ts` that decides what that is.
      path: opts.path ?? boxCredentialPath(),
      hostInode: opts.hostInode ?? hostInodeOf,
    });
  };
}
