import { readFileSync } from 'node:fs';
import { claudeCredentialFile } from './copilot-env.js';

// Whether the Claude sign-in this machine holds is still alive, or a corpse every agent turn will die
// against.
//
// THE FAILURE THIS EXISTS FOR, measured on a live machine 2026-08-16. The credential in use carried
// `expiresAt` 12:35:50Z; two runs dispatched at 12:32:46 and 12:32:50 each died with "Failed to
// authenticate: OAuth session expired and could not be refreshed". Signing in again on the host moved
// `expiresAt` to 21:24:55Z and the same runs worked. Nothing on screen said any of that: auto-pilot
// spent all three of a card's attempts on it and then reported the CARD as stalled — an infrastructure
// fault misreported as a content fault. That is why this is a status the light can go offline on rather
// than a log line.
//
// WHAT THIS REPLACED, AND WHY THAT MUST NOT COME BACK. Until this rewrite the check compared INODES: it
// stat'd the credential on the host, stat'd the same path inside the running box, and called the box
// stale when the two differed. That was a real measurement when it was written — the box bind-mounted
// the user's `~/.claude/.credentials.json` as a FILE, a file mount is pinned to the inode it was created
// against, and Claude Code refreshes by atomic replace, so a refreshed host really did leave the box
// reading a deleted inode (host 5280206 vs box 5303483, link count 1 vs 0).
//
// The mount then changed. `boxCredentialPath()` became a mirror under `~/.cache/vibeboard/creds/claude/`
// mounted as a DIRECTORY, precisely so a replace could be followed — and from that moment the two sides
// of the comparison were THE SAME FILE reached two ways. Measured before deleting it: host mirror inode
// 5508492, inside the box inode 5508492. Equal by construction, on every machine, forever. The check
// could not fire, and every test still passed because each one injected a fake host inode and a fake
// docker and made the two numbers differ artificially — nothing ever touched the real paths. A gate that
// cannot answer no is not a gate, so it is gone rather than kept beside this. Do not reintroduce it: if
// the mount ever goes back to being a file, the fix is the mount, not a comparison of a file with
// itself.
//
// And it watched the wrong property in any case. An inode answers "is the box looking at the same file";
// it cannot answer "is the token in that file still alive", which is what killed the runs above.

export type CredentialFreshness = { fresh: true } | { fresh: false; reason: string };

const FRESH: CredentialFreshness = { fresh: true };

// How long before nominal expiry a credential is already treated as dead.
//
// FIVE MINUTES, AND BOTH DIRECTIONS OF THE ERROR ARE CHEAP TO STATE. The measurement above is the floor:
// the runs failed 3m04s and 3m00s BEFORE the stated `expiresAt`, so a margin under about three minutes
// would have watched that failure happen and called the credential fine. The ceiling is the opposite
// mistake — a margin so wide that we refuse a machine whose CLI would have renewed the token by itself,
// which is an outage we caused. Five minutes clears the measured gap with a little over it for clock
// skew between this host and the token issuer, and for the seconds between the gate answering and the
// agent's first API call. Against a token whose life is around eight hours (issued 13:24, expiring
// 21:24 on the machine this was written on) it closes off the last ~1% of that life, and only for
// dispatches that begin inside it.
const EXPIRY_MARGIN_MS = 5 * 60_000;

// The whole sentence a person reads, twice, because the action is not the same one.
//
// A live refresh token means the sign-in itself is intact and one host-side `claude` renews it. A dead
// one means no automatic renewal can save it and they must authenticate from scratch — same command,
// different expectation of what it will ask them for. Telling somebody to "refresh" a thing that cannot
// be refreshed is how a person concludes the message is wrong and stops reading it.
//
// Neither of these says to rebuild the agent boxes. That was the old advice, it belonged to the old
// inode fault, and it is useless here: a rebuilt box mirrors the same expired credential.
const REASON_EXPIRED = [
  'the Claude sign-in on this machine has expired, so every agent turn would fail to authenticate.',
  'Run "claude" in a terminal on the host to refresh it',
].join(' ');

const REASON_SIGN_IN_AGAIN = [
  'the Claude sign-in on this machine has expired and its refresh token has expired too, so nothing can',
  'renew it automatically. Run "claude" in a terminal on the host and sign in again',
].join(' ');

// The credential file as text, or undefined when it cannot be had.
//
// A try/catch and not `throwIfNoEntry`, which `readFileSync` has no equivalent of — and it would not
// help if it did. Missing, unreadable, a directory, a dangling symlink: every one of them is a thing we
// have not observed, every one of them answers `fresh` below, so separating them would only be
// separating answers that are identical.
function readCredential(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

// The two epoch-ms fields, or undefined if this is not a file we understand.
//
// Reads nothing else. The tokens are in the object this walks through and are never bound to a name,
// never returned and never logged; the only values that leave here are two numbers.
function oauthExpiry(text: string): { expiresAt: number; refreshTokenExpiresAt?: number } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const oauth = (parsed as { claudeAiOauth?: unknown } | null)?.claudeAiOauth;
  if (typeof oauth !== 'object' || oauth === null) return undefined;
  const { expiresAt, refreshTokenExpiresAt } = oauth as Record<string, unknown>;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return undefined;
  const refresh =
    typeof refreshTokenExpiresAt === 'number' && Number.isFinite(refreshTokenExpiresAt)
      ? refreshTokenExpiresAt
      : undefined;
  return { expiresAt, refreshTokenExpiresAt: refresh };
}

// EVERY UNCERTAIN ANSWER IS `fresh`, AND THAT DIRECTION IS THE DECISION.
//
// This is the one place in the sandbox gate that fails OPEN, which is the opposite of every other rule
// in sandbox.ts, so the reasoning belongs here and not spread across the callers. The rest of the gate
// answers "is the containment I promised actually present" — a wrong `yes` there runs an agent
// unconfined, so it must fail closed. This answers "is a working machine secretly broken", where a
// wrong `no` disables a machine that runs perfectly well, and the person has no way to overrule it.
//
// No file, bytes that are not JSON, JSON with no `claudeAiOauth`, an `expiresAt` that is not a number:
// in all of them we have observed NOTHING. A credential we cannot read is not a credential we have found
// to be dead, and inventing the second from the first is a refusal with a fabricated cause on it. The
// fault this module is about is loud once it happens — three attempts, each failing in tens of
// milliseconds — and it is caught on the next probe a second later as soon as the file becomes readable.
// Guessing buys nothing and costs a working project.
export function credentialFreshness(opts: {
  path: string;
  read: (path: string) => string | undefined;
  now: () => number;
  marginMs?: number;
}): CredentialFreshness {
  const text = opts.read(opts.path);
  // NO TEST CAN FAIL ON THIS LINE, and that is recorded here rather than rediscovered: deleting it is an
  // equivalent mutant at runtime, because `JSON.parse(undefined)` parses the string "undefined", throws,
  // and lands in the same fail-open below. What holds it is the COMPILER — without it `text` is
  // `string | undefined` and `oauthExpiry` refuses it (verified: TS2345 on deletion). Keep it for the
  // type, not for the branch.
  if (text === undefined) return FRESH;
  const oauth = oauthExpiry(text);
  if (oauth === undefined) return FRESH;

  const now = opts.now();
  if (oauth.expiresAt - now > (opts.marginMs ?? EXPIRY_MARGIN_MS)) return FRESH;
  // The refresh token is judged against the bare clock and not the margin: the margin exists to catch a
  // token dying mid-run, and a refresh token that outlives this instant by a minute is one the CLI can
  // still spend. Only a refresh token already in the past changes what we ask the person to do.
  const renewable = oauth.refreshTokenExpiresAt === undefined || oauth.refreshTokenExpiresAt > now;
  return { fresh: false, reason: renewable ? REASON_EXPIRED : REASON_SIGN_IN_AGAIN };
}

// The check as the sandbox status wants it: no arguments, current clock, current answer.
//
// IT READS THE HOST CREDENTIAL, NOT THE MIRROR THE BOX SEES, AND THAT IS AN ANTI-DEADLOCK RULE RATHER
// THAN A CONVENIENCE. `mirrorClaudeCredential()` copies host → mirror inside `boxPathsForBackend`, which
// runs inside `BoxService.ensure()`, which runs before every agent turn — so the host file is what
// decides the NEXT run's fate, and the mirror is only ever a photograph of some earlier one. Gate on the
// mirror and a machine whose mirror is stale-and-expired while the host is valid refuses every dispatch;
// the only thing that would refresh that mirror is a dispatch; nothing could ever clear it. That is not
// hypothetical — it is the exact state of the machine this was written on (mirror expiring 12:35:50Z,
// host 21:24:55Z, eight hours apart). This codebase has already shipped one gate that could not break
// its own streak; it does not get a second.
//
// The project root is gone from the signature. It existed only to name a container to `docker exec`
// into, and nothing here consults a container any more: one host file, one clock, no daemon, no project.
//
// THE BACKEND STAYED, THOUGH, and it is the one dimension that still matters. This credential is Claude's
// alone — under S2 an OpenCode box never has it mounted and its runs authenticate from a different file
// entirely — so refusing an OpenCode project because a Claude token expired is a refusal for a reason
// that cannot affect it. That is precisely the "wrong no" this module's fail-open argument exists to
// avoid, and it would present to the user as the product declining to work with no visible cause: the
// same shape as the bug this rewrite is fixing, wearing the other face.
//
// APPROXIMATE, AND DELIBERATELY SO IN THE SAFE DIRECTION. What is consulted is the project's CONFIGURED
// backend, while a single turn can be overridden to the other one in the dock. So a project set to
// OpenCode whose user overrides one turn to Claude Code gets no warning and that turn dies at
// authentication — which is the fail-open direction, and the one this file takes everywhere else.
// Unknown backend — no project open, no config yet — is treated as Claude's, because that is the
// default and because a missing answer must not silence a real fault.
export function claudeCredentialCheck(
  opts: {
    path?: string;
    read?: (path: string) => string | undefined;
    now?: () => number;
    backend?: () => string | undefined;
  } = {},
): () => Promise<CredentialFreshness> {
  // Async because `CredentialCheck` in sandbox.ts is, and it is: the docker half of that gate spawns a
  // process. This half happens to be a sub-millisecond read of a file under a kilobyte, at most once per
  // sandbox TTL, so it stays synchronous internally and is testable with no clock and no filesystem.
  return async () => {
    // Asked before the file is opened, so an OpenCode project costs no read at all — and, more to the
    // point, cannot be refused by a credential it will never use.
    const backend = opts.backend?.();
    if (backend !== undefined && backend !== 'claude-code') return FRESH;
    return credentialFreshness({
      // The user's REAL credential — the one the CLI on the host refreshes — and never
      // `boxCredentialPath()`. See the paragraph above before changing this line.
      path: opts.path ?? claudeCredentialFile(),
      read: opts.read ?? readCredential,
      now: opts.now ?? Date.now,
    });
  };
}
