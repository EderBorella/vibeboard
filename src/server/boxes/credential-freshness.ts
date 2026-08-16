import { readFileSync } from 'node:fs';
import { claudeCredentialFile, opencodeAuthFile } from './copilot-env.js';

// Whether the sign-in this machine holds FOR THE BACKEND THE PROJECT IS SET TO is still alive, or a
// corpse every agent turn will die against.
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
//
// THE TWO BACKENDS CANNOT FAIL THE SAME WAY, AND THIS FILE MUST NOT PRETEND THEY CAN. Claude Code holds
// an OAuth token with `expiresAt` and `refreshTokenExpiresAt` in epoch ms, so "dead" is arithmetic
// against a clock and today's incident was exactly that. OpenCode holds API KEYS WITH NO EXPIRY FIELD
// OF ANY KIND — measured on this machine, `~/.local/share/opencode/auth.json` is a flat map of provider
// entries shaped `{"<provider>":{"type":"api","key":"…"}}` and carries no timestamp anywhere — so
// nothing in it can go stale and a key is only known to be bad when a provider rejects a call. The
// honest OpenCode status is therefore CONFIGURED or NOT CONFIGURED, never "expired". Writing an expiry
// check for it would produce a gate that cannot answer no, which is precisely the defect the inode
// comparison above was deleted for; do not add one, and do not reach for the network to make one
// possible either — a provider round trip on every sandbox probe buys a fact about a key we are not
// allowed to hold, at the cost of a gate that fails whenever the user's link does.

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

// The whole sentence a person reads, three times over, because the action is not the same one.
//
// A live refresh token means the sign-in itself is intact and one host-side `claude` renews it. A dead
// one means no automatic renewal can save it and they must authenticate from scratch — same command,
// different expectation of what it will ask them for. Telling somebody to "refresh" a thing that cannot
// be refreshed is how a person concludes the message is wrong and stops reading it.
//
// EVERY ONE OF THEM NAMES THE BACKEND, AND THEN NAMES THE OTHER ONE AS UNAFFECTED. The sentences used to
// open "the Claude sign-in on this machine has expired", which a person running both CLIs reads as "my
// machine's agents are down" — and the whole point of this check knowing about backends is that they are
// not: an expired Claude Code sign-in cannot touch a project set to OpenCode, and an OpenCode machine
// with no provider configured cannot touch a Claude Code one. A refusal that leaves the reader guessing
// which half of their setup died sends them to fix the wrong one, and these reach the user verbatim
// through `agentRefusal` and the light's balloon, where there is no second sentence to correct it.
//
// None of them says to rebuild the agent boxes. That was the old advice, it belonged to the old inode
// fault, and it is useless here: a rebuilt box mirrors the same expired credential.
//
// They end on the command and not on the reassurance, because `agentRefusal` renders them as
// `Agents are disabled: ${reason}.` — the last clause is the one a truncated balloon keeps.
const REASON_EXPIRED = [
  'the Claude Code sign-in on this machine has expired, so every agent turn would fail to authenticate.',
  'This project is set to the Claude Code backend; a project set to OpenCode is unaffected.',
  'Run "claude" in a terminal on the host to refresh it',
].join(' ');

const REASON_SIGN_IN_AGAIN = [
  'the Claude Code sign-in on this machine has expired and its refresh token has expired too, so nothing',
  'can renew it automatically. This project is set to the Claude Code backend; a project set to OpenCode',
  'is unaffected. Run "claude" in a terminal on the host and sign in again',
].join(' ');

// NOT "expired", AND THE WORD IS THE POINT — see the asymmetry paragraph at the top of this file. There
// is no expiry in an OpenCode credential to have passed, so the only true thing to say is that there is
// no provider to authenticate with at all.
const REASON_NO_OPENCODE_PROVIDER = [
  'this project is set to the OpenCode backend and no OpenCode provider is configured on this machine,',
  'so every agent turn would fail to authenticate. A project set to Claude Code is unaffected.',
  'Run "opencode auth login" in a terminal on the host to configure a provider',
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

// The OpenCode half: is there a provider to authenticate with at all. No clock, because there is nothing
// here a clock could judge — see the asymmetry paragraph at the top.
//
// ABSENCE IS AN OBSERVATION HERE, WHERE FOR CLAUDE IT IS NOT, and the difference is worth stating because
// it looks at first like the fail-open rule being applied inconsistently. A missing Claude credential
// tells us nothing about whether a token is alive; a missing OpenCode `auth.json` IS the answer, because
// it is the only thing a box can authenticate from. That is a fact about the mount rather than a
// hopeful reading: `boxEnvFor('opencode')` hands the container two XDG variables and nothing else, and
// `execArgs` passes `-e` for exactly what that returns, so a provider key exported in the user's shell
// or in this server's environment never crosses the boundary. An empty object is the same observation
// wearing different bytes — `opencode auth logout` leaves `{}` behind rather than removing the file.
//
// UNPARSEABLE FAILS OPEN, and that is the one place where it differs from missing. Bytes we cannot read
// are bytes we have not observed: the file could be mid-write by the very `opencode auth login` the
// refusal would tell somebody to run. The general form of the argument is the long paragraph below
// `oauthExpiry` — a wrong "no" disables a machine that works and the person cannot overrule it — and it
// is not restated here.
export function opencodeAuthPresence(opts: {
  path: string;
  read: (path: string) => string | undefined;
}): CredentialFreshness {
  const text = opts.read(opts.path);
  if (text === undefined) return { fresh: false, reason: REASON_NO_OPENCODE_PROVIDER };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return FRESH;
  }
  // `typeof null` is `'object'` and an array's is too, so both are excluded by hand rather than by the
  // type test — the same trap `oauthExpiry` above was rewritten for after a deleted guard threw a
  // TypeError inside `liveSandbox`, where a rejection is not a fail-open, it is no status at all.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return FRESH;
  // Keys only. The values are API keys, and nothing in this module may bind one to a name, compare one
  // or return one — the count of entries is the whole of what is read out of this file.
  if (Object.keys(parsed).length > 0) return FRESH;
  return { fresh: false, reason: REASON_NO_OPENCODE_PROVIDER };
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
// ONE CHECK, DISPATCHED ON THE BACKEND THE PROJECT IS SET TO, and the dispatch is the substance rather
// than a tidying. The two credentials are disjoint — under S2 an OpenCode box never has Claude's mounted
// and a Claude box never has OpenCode's — so the state of one says nothing whatever about a project
// running the other. Answering for the wrong one is the "wrong no" this module's fail-open argument
// exists to avoid, and it presents to the user as the product declining to work for a cause that cannot
// reach it: the same shape as the bug this rewrite is fixing, wearing the other face. It was reported
// exactly that way — a person who uses only one of the two CLIs had auto-pilot stopped by the other.
//
// A BACKEND WE DO NOT RECOGNISE ANSWERS FRESH, which is not the same as the unknown case below. `undefined`
// means nobody has said yet — no project open, no config read — and Claude Code is the documented default
// (`DEFAULT_BACKEND` in src/core/backends.ts), so checking Claude's is answering for the backend that
// would actually run. A string that is neither is a config we cannot interpret, and picking either check
// for it would be guessing at whose credential matters; there is no fault to miss by staying quiet,
// because a backend nothing can dispatch is already refused elsewhere.
//
// APPROXIMATE, AND DELIBERATELY SO IN THE SAFE DIRECTION. What is consulted is the project's CONFIGURED
// backend, while a single turn can be overridden to the other one in the dock. So a project set to
// OpenCode whose user overrides one turn to Claude Code gets no warning and that turn dies at
// authentication — which is the fail-open direction, and the one this file takes everywhere else.
export function credentialCheck(
  opts: {
    claudePath?: string;
    opencodePath?: string;
    read?: (path: string) => string | undefined;
    now?: () => number;
    backend?: () => string | undefined;
  } = {},
): () => Promise<CredentialFreshness> {
  // Async because `CredentialCheck` in sandbox.ts is, and it is: the docker half of that gate spawns a
  // process. This half happens to be a sub-millisecond read of a file under a kilobyte, at most once per
  // sandbox TTL, so it stays synchronous internally and is testable with no clock and no filesystem.
  return async () => {
    // Asked before any file is opened, so exactly one credential is ever read and a project is never
    // refused by one it will not use.
    const backend = opts.backend?.();
    const read = opts.read ?? readCredential;
    if (backend === 'opencode') {
      return opencodeAuthPresence({ path: opts.opencodePath ?? opencodeAuthFile(), read });
    }
    if (backend !== undefined && backend !== 'claude-code') return FRESH;
    return credentialFreshness({
      // The user's REAL credential — the one the CLI on the host refreshes — and never
      // `boxCredentialPath()`. See the anti-deadlock paragraph above before changing this line.
      path: opts.claudePath ?? claudeCredentialFile(),
      read,
      now: opts.now ?? Date.now,
    });
  };
}
