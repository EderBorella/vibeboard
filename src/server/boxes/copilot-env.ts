import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  type Stats,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// Isolate the copilot from the user's PERSONAL agent config. The copilot should run with
// only VibeBoard's own context + the project's own files — not the user's global
// ~/.claude/CLAUDE.md, ~/.config/opencode/AGENTS.md, plugins, or hooks (which make it act
// like the user's dev agent, e.g. "ask for a branch", and bloat the prompt/cost).
//
// Mechanism: point each CLI at a clean config home that VibeBoard owns.
//  - Claude: CLAUDE_CONFIG_DIR → a dir with ONLY a symlink to the real credentials.
//  - OpenCode: XDG_CONFIG_HOME → an empty dir (auth/db live in XDG_DATA_HOME, untouched).

// Both CLIs write their config in here, which under the profile is why the admin token had to be denied
// BY NAME rather than `~/.vibeboard/` as a whole. In a box the question does not arise: none of
// `~/.vibeboard/` is among the mounts (docs/security/containment.md).
function copilotHome(): string {
  return process.env.VIBEBOARD_COPILOT_HOME ?? join(homedir(), '.vibeboard', 'copilot');
}

// The credential mirror lives OUTSIDE `~/.vibeboard/`, and the line above is the entire reason.
//
// The mirror is the one thing here that is mounted into a box. Putting it under `~/.vibeboard/` — where
// it was first written — would have made "none of `~/.vibeboard/` is among the mounts" false, and the
// admin token next door would then have been kept out by the mount set naming one leaf of that tree
// rather than by nothing in it being named at all. The first is a rule someone can get wrong later; the
// second cannot be got wrong. A different tree costs nothing and keeps the stronger sentence true.
//
// `XDG_CACHE_HOME` because that is what it is: a copy that can be deleted at any time and is rebuilt
// from `~/.claude` on the next `ensure()`. It is also the seam the tests use.
function credentialHome(): string {
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'vibeboard', 'creds');
}

export function isolationEnabled(): boolean {
  return process.env.VIBEBOARD_COPILOT_ISOLATE !== '0';
}

// Clean Claude config dir. Only the credentials are shared in (via symlink, so token
// refresh writes through); no CLAUDE.md, plugins, or hooks come along.
//
// Points at the user's REAL file, not at the mirror below. This home is used only where the CLI runs
// on the HOST — unboxed, which since docker became mandatory means tests — and there a refresh
// writing through the link is the behaviour we want and the mirror would silently swallow it.
export function claudeConfigDir(): string {
  const dir = join(copilotHome(), 'claude');
  mkdirSync(dir, { recursive: true });
  linkCredentials(dir, claudeCredentialFile());
  return dir;
}

// PER-PROJECT STATE, and why containment forces it.
//
// Both backends key their sessions by something that stops being unique inside a box, and they do it
// for unrelated reasons — which is the main argument for believing the conclusion.
//
//  - Claude stores sessions under a directory named after the WORKING DIRECTORY. On the host that is
//    the real project path, so projects separate by themselves. In a box the working directory is
//    always `/work`, so every project on the machine would land in one `-work` bucket of one shared
//    config home, and resuming a session in project A could pick up project B's.
//  - OpenCode keeps its sessions in a SQLite database in its data directory. The user's own is 265MB
//    and is also the one their personal `opencode` uses; bind-mounting it into every box would put
//    several containers and the user on one file as concurrent writers.
//
// So each project gets its own, named by a digest of its path for the same reason a box is.
function projectStateDir(projectRoot: string): string {
  const digest = createHash('sha256').update(projectRoot).digest('hex').slice(0, 12);
  return join(copilotHome(), 'projects', digest);
}

// Claude's config home for one project — and the ONLY thing its box mounts as /state.
//
// A SUBDIRECTORY of the project's state root, not the root itself. Mounting the shared root gave a
// Claude box a readable copy of OpenCode's `auth.json`, which is the exact thing S2 exists to
// prevent: the two backends' credentials must never meet. Found in review 2026-08-09; the reverse
// direction was already safe only by accident (Claude's credential is a symlink to a host path an
// OpenCode box does not mount, so it dangles rather than resolving).
//
// The credentials symlink is the load-bearing part: it points at the credential by ABSOLUTE path, and
// the box mounts that same absolute path, so the link resolves identically inside and out. What it
// points AT is the mirror, not the user's own file — see `mirrorClaudeCredential` for the measurement
// that forced that.
export function claudeStateDir(projectRoot: string): string {
  const dir = join(projectStateDir(projectRoot), 'claude');
  mkdirSync(dir, { recursive: true });
  // Before the link, so the link never points at a path that does not exist yet.
  mirrorClaudeCredential();
  linkCredentials(dir, boxCredentialPath());
  return dir;
}

// OpenCode's state for one project — and the only thing its box mounts as /state. Holds BOTH of the
// homes it needs, so one mount covers them: `data/` is XDG_DATA_HOME (auth and the session db),
// `config/` is XDG_CONFIG_HOME (the permission config, and nothing of the user's own).
export function opencodeStateDir(projectRoot: string): string {
  const root = join(projectStateDir(projectRoot), 'opencode');
  const data = join(root, 'data', 'opencode');
  mkdirSync(data, { recursive: true });
  // A SYMLINK TO THE SHARED MIRROR, not a copy — changed 2026-09-01, and the link is the same mechanism
  // `claudeStateDir` uses for the same reason.
  //
  // It was a copy made ONCE per project, which meant a host re-login never reached a project that
  // already had one. `mirrorOpencodeCredential` carries the reasoning. The link is written before the
  // mirror is asked for so the path exists to point at, and it is ABSOLUTE — the box mounts that same
  // absolute path, so the link resolves identically inside and out.
  const seeded = join(data, 'auth.json');
  adoptLegacyOpencodeCopy(seeded);
  mirrorOpencodeCredential();
  linkTo(seeded, opencodeBoxCredentialPath());
  writeOpencodeConfig(join(root, 'config'));
  return root;
}

// EVERY PROJECT ON DISK ALREADY HAS ONE OF THE OLD COPIES, and one of them may be the newest credential
// on the machine — a box that refreshed inside it wrote here, and nothing carried that anywhere. The
// link below would replace the file, so this runs first and gives the host its chance to take it.
//
// The same three conditions as `reconcileCredential`: strictly newer, parses, and the host already has
// one. A regular file only — a symlink is this migration having already happened, and following it
// would compare the mirror with itself.
function adoptLegacyOpencodeCopy(seeded: string): void {
  const legacy = lstatSync(seeded, { throwIfNoEntry: false });
  if (!legacy?.isFile()) return;
  const host = opencodeAuthFile();
  const on = statSync(host, { throwIfNoEntry: false });
  if (!on?.isFile() || legacy.mtimeMs <= on.mtimeMs) return;
  if (!parsesAsCredential(seeded)) return;
  restoreCredential(seeded, host);
}

// AN EXISTING LINK IS REPOINTED, NOT LEFT ALONE, and that is the whole reason this is not three lines.
// `symlinkSync` fails with EEXIST rather than replacing, so the first version of this simply swallowed
// it — correct while the target never changed. The target changed when the box stopped mounting
// `~/.claude`, and every config home written before that carries a link to a path a box no longer
// mounts: it would dangle inside the container, silently, on machines that had run VibeBoard before
// and nowhere else.
function linkCredentials(dir: string, target: string): void {
  linkTo(join(dir, '.credentials.json'), target);
}

// The same, given the link's own path — OpenCode's credential is `auth.json`, not `.credentials.json`.
function linkTo(link: string, target: string): void {
  if (!existsSync(target)) return;
  try {
    const current = lstatSync(link, { throwIfNoEntry: false });
    if (current) {
      if (current.isSymbolicLink() && readlinkSync(link) === target) return;
      unlinkSync(link);
    }
    symlinkSync(target, link);
  } catch {
    /* auth will fail loudly if this matters */
  }
}

// The user's real Claude credential, on the host. The one the CLI itself refreshes.
export function claudeCredentialFile(): string {
  return join(homedir(), '.claude', '.credentials.json');
}

// The user's real OpenCode credential, on the host — the file `opencodeStateDir` above seeds each box's
// copy from, and the ONLY thing that authenticates an OpenCode run.
//
// A function rather than a literal repeated at the seed and at the health check, because the two must be
// the same path or the check is watching a file nothing writes — the quietest possible failure, since a
// path that exists nowhere reads as "no credential" and a path that is never seeded reads as "fine", and
// neither says which it is. That the check can rely on this file alone is a fact about the MOUNT and not
// an assumption: `boxEnvFor('opencode')` in containers.ts passes the box two XDG directory variables and
// nothing else, and `execArgs` passes `-e` only for what that returns, so no provider key in this
// server's own environment can reach an agent. Inside a box, this file or nothing.
export function opencodeAuthFile(): string {
  return join(homedir(), '.local', 'share', 'opencode', 'auth.json');
}

// Where that credential is VISIBLE INSIDE a Claude box — the path the symlink in the config dir points
// at, and the path the mount makes mean the same thing on both sides of the boundary.
//
// Separate from `claudeCredentialFile()` because the two stopped being the same thing. Anything asking
// "what will the CLI in the box actually read" must use this one.
export function boxCredentialPath(): string {
  return join(credentialHome(), 'claude', '.credentials.json');
}

// The same, for OpenCode — and it is a SEPARATE LEAF of `credentialHome()`, never the tree itself.
//
// S2 says the two backends' credentials must never meet, and it is held here by what is mounted rather
// than by a rule: a Claude box mounts `<creds>/claude`, an OpenCode box mounts `<creds>/opencode`, and
// nothing mounts `<creds>`. Mounting the parent to save a line would put each backend's credential in
// the other's box, which is the one thing this whole file exists to prevent.
export function opencodeBoxCredentialPath(): string {
  return join(credentialHome(), 'opencode', 'auth.json');
}

// THE MEASUREMENT THAT FORCED A MIRROR, because the obvious arrangement — mount the user's credential
// file — is broken in a way that looks like an expired login.
//
// A Claude box used to bind-mount the FILE. Claude Code refreshes its OAuth token by atomic replace:
// write a new file, rename over the old. That makes a NEW INODE, and a bind-mounted file pins the
// inode it was created with — so the container went on reading the old, now-unlinked one forever.
// Measured 2026-08-15 on a live box: host inode 5280206, link count 1, mtime 20:35; the same path
// inside the box inode 5303483, link count 0, mtime a day earlier; and the box's own
// /proc/self/mountinfo naming the source `…/.claude/.credentials.json//deleted`. Every agent turn then
// died in 58ms with "Failed to authenticate: OAuth session expired and could not be refreshed",
// auto-pilot spent all three of a card's attempts on it, and reported the CARD as stalled.
//
// The box cannot repair this from inside either. Reproduced from first principles in a scratch
// container: a rename over a file-mount fails with EBUSY ("Resource busy"); the same rename inside a
// DIRECTORY mount succeeds; and the file-mount still reads the old bytes afterwards. So a mounted file
// can neither follow the host's refresh nor be refreshed from within.
//
// Mounting all of `~/.claude` was analysed and REJECTED rather than overlooked. It is 894MB and 805
// session transcripts, and read-write is disqualifying on its own: `settings.json` declares hooks that
// execute ON THE HOST the next time the user starts Claude Code — the escape `PROTECTED_PATHS` already
// denies for `.git/hooks`, reached by another door. Read-only still hands every agent in every project
// the full text of every session ever run on this machine, which is the opposite of what the top of
// this file exists to do.
//
// So: a directory VibeBoard owns, holding ONLY the credential, mounted as a DIRECTORY. A copy at rest
// has precedent a few functions up — `opencodeStateDir` copies the user's `auth.json` for a related
// reason.
//
// WHAT THIS DOES NOT FIX, stated so the next reader does not have to discover it the way the last one
// did:
//
//  - MIRRORING IS ONE-WAY, host → mirror, and the host is the source of truth. A refresh performed
//    INSIDE the box is overwritten by the next mirror and lost. That costs nothing today, because the
//    EBUSY measurement above says an in-box refresh is impossible — but a directory mount is writable
//    from inside, so the in-box CLI CAN write here now and the loss becomes reachable the moment it
//    does. The two-way version (newest mtime wins) is a separate step, deliberately not taken here.
//  - IF NOBODY EVER RUNS CLAUDE CODE ON THE HOST, nothing refreshes the token, and the mirror expires
//    exactly when the original does. Mirroring buys freshness; it does not create it.
//  - THIS IS A SECOND COPY OF A CREDENTIAL AT REST, at `~/.cache/vibeboard/creds/claude/`. What
//    protects it is 0700 on the directory and 0600 on the file, set with an explicit `chmodSync`
//    rather than left to the umask. It is deliberately not under `~/.vibeboard/` — see
//    `credentialHome` for why that tree stays wholly absent from every box.
//
// Answers with the mirror's path, or `undefined` when there is no credential to mount.
export function mirrorClaudeCredential(): string | undefined {
  return reconcileCredential(claudeCredentialFile(), boxCredentialPath());
}

// OpenCode's, and it is now the SAME shape as Claude's rather than a per-project copy.
//
// WHAT IT REPLACES, and why that was a bug pointing the other way. `opencodeStateDir` used to copy the
// host's `auth.json` into each project's state — `if (exists(real) && !exists(seeded))`, so ONCE and
// never again. A re-login on the host therefore never reached a project that already had a copy, which
// is stale-FORWARD and reachable with no box doing anything unusual at all. It also made "newest wins"
// unanswerable: N projects meant N divergent copies and no way to say which was authoritative.
//
// One mirror, and the per-project split stays for the session DATABASE, which is what forced it — the
// user's own is 265MB and several boxes writing one SQLite file is several writers on one file. A
// credential is not that.
export function mirrorOpencodeCredential(): string | undefined {
  return reconcileCredential(opencodeAuthFile(), opencodeBoxCredentialPath());
}

// TWO-WAY, WITH THE HOST AS THE SOURCE OF TRUTH — ruled 2026-09-01, and the mechanism was confirmed
// before it was built rather than assumed.
//
// An OAuth refresh is a headless POST of the refresh token to the provider: no browser, no user, and no
// host involvement. A box has the internet (docs/security/containment.md), so the CLI inside one can and
// will refresh — and a DIRECTORY mount is writable, so it succeeds at exactly the write a one-way mirror
// then discards. The cost is not merely lost freshness: if the provider rotates refresh tokens on use,
// the host is left holding a SPENT one and neither side can refresh again. That is the 58ms
// authentication failure recorded in `fault.ts`.
//
// THE DIRECTION IS DECIDED ONLY WHEN THE CONTENTS DIFFER, and never by mtime alone. `mirrored()` below
// explains why comparing timestamps for EQUALITY cannot work here; comparing them for ORDER is a
// different question and is only asked once the bytes have already said the two are not the same.
//
// THREE CONDITIONS ON CARRYING A CREDENTIAL BACK TO THE HOST, because that writes the user's own file:
//
//  - STRICTLY newer. Never on a tie — a tie is two files whose order we cannot actually establish.
//  - It must PARSE as a credential. A half-written or truncated file is exactly what a rename exists to
//    prevent us seeing, and belt-and-braces here costs one `JSON.parse` of a file under a kilobyte.
//  - The host file must already EXIST. Restoring one that does not would create a credential where the
//    user has none, which is not a refresh, and `~/.claude` is not ours to populate.
//
// No flapping: a carry-back rewrites the host, so on the next call the two are byte-identical and
// nothing happens. Same in the other direction.
function reconcileCredential(host: string, mirror: string): string | undefined {
  const from = statSync(host, { throwIfNoEntry: false });
  const to = statSync(mirror, { throwIfNoEntry: false });
  if (from?.isFile() && !mirrored(mirror, host, from)) {
    if (to?.isFile() && to.mtimeMs > from.mtimeMs && parsesAsCredential(mirror)) {
      restoreCredential(mirror, host);
    } else {
      copyCredential(host, mirror);
    }
  }
  return existsSync(mirror) ? mirror : undefined;
}

// Is this a credential at all, or a file caught mid-write? Both backends' files are JSON objects, and
// that is the whole of the claim — this is not validating a token, it is refusing to overwrite the
// user's working credential with something that is not one.
function parsesAsCredential(path: string): boolean {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return value !== null && typeof value === 'object' && Object.keys(value).length > 0;
  } catch {
    return false;
  }
}

// The carry-back. Deliberately NOT `copyCredential`, which chmods the containing directory to 0700: the
// target here is `~/.claude` or `~/.local/share/opencode`, the user's own, and tightening the mode of a
// directory we merely write into would be a side effect nobody asked for. The FILE's 0600 is kept,
// because that is the mode the credential already has and the temp file must not be looser.
function restoreCredential(mirror: string, host: string): void {
  const temp = `${host}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, readFileSync(mirror));
    chmodSync(temp, 0o600);
    renameSync(temp, host);
  } catch {
    rmSync(temp, { force: true });
    /* the host keeps what it had, which is the safe direction */
  }
}

// SIZE FIRST, THEN THE BYTES. Cheap enough for every `ensure()`, which is what it gets: two `stat`s
// reject the common case where a refresh changed the length, and otherwise two reads of a file that is
// under a kilobyte — nothing next to the `docker inspect` the same call is about to do.
//
// It compares CONTENT and not mtime, and that is a correction rather than a preference. The first
// version carried the source's mtime onto the mirror with `utimesSync` and compared the two, which
// looks exact and is not: `utimesSync` takes a `Date`, a `Date` holds only whole milliseconds, and a
// file's mtime has nanoseconds — so the copy's timestamp comes back ROUNDED UP to the next whole
// millisecond. Measured: 2000 out of 2000 round trips shifted by one. The comparison would therefore
// have failed for every real credential, the skip would never once have fired, and nothing would have
// said so — the mirror would simply have been rewritten before every agent turn. It was caught only
// because a test that pinned the skip happened to be run alongside another file, which moved the
// timing enough to expose it.
function mirrored(mirror: string, source: string, from: Stats): boolean {
  const to = statSync(mirror, { throwIfNoEntry: false });
  if (!to || to.size !== from.size) return false;
  return readFileSync(mirror).equals(readFileSync(source));
}

// Temp file in the SAME directory, then rename. Two reasons, and the second is the point of the whole
// change: a torn credential is worse than a stale one, and a rename is the one write a bind-mounted
// directory lets the other side of the mount see.
//
// Not `writeAtomic` from src/store/write-queue.ts, which does exactly this and is the helper this
// would otherwise duplicate: it is async, and everything on this path — `claudeStateDir`,
// `boxPathsForBackend`, the mount set itself — is synchronous and is asserted synchronously by tests
// that need no daemon. Making the mount set async to reuse eleven lines would be the tail wagging the
// dog.
function copyCredential(source: string, mirror: string): void {
  const dir = dirname(mirror);
  // `mkdirSync`'s mode applies only where it CREATES, so on its own it leaves a directory that already
  // existed at 0755 exactly as it found it — with a credential about to be put inside it. The
  // `chmodSync` below is what closes that, and test/copilot-env.test.ts plants a 0755 directory to
  // prove it.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // One writer: this whole path is synchronous, so the only way two temp names collide is two
  // PROCESSES, and the pid separates those.
  const temp = `${mirror}.${process.pid}.tmp`;
  try {
    chmodSync(dir, 0o700);
    // The mode is applied by `chmodSync` ALONE, and not also as a `writeFileSync` option, so that it is
    // reachable by a test: with both, removing the chmod changes nothing an assertion can see, and a
    // mode nothing can fail is a mode nobody is holding. What covers the moment between the create and
    // the chmod is the 0700 on the directory above — nothing else can traverse in to find the file.
    writeFileSync(temp, readFileSync(source));
    chmodSync(temp, 0o600);
    renameSync(temp, mirror);
  } catch {
    rmSync(temp, { force: true });
    /* auth will fail loudly if this matters */
  }
}

// Clean XDG_CONFIG_HOME for OpenCode — opencode looks in $XDG_CONFIG_HOME/opencode, which
// won't exist here, so no personal AGENTS.md/config/plugins load. Auth stays in the
// default XDG_DATA_HOME (~/.local/share/opencode).
export function opencodeConfigHome(): string {
  const dir = join(copilotHome(), 'opencode-xdg');
  writeOpencodeConfig(dir);
  return dir;
}

// Auto-approve tools. Headless there is no TTY/SSE to answer a permission prompt, so the default
// "ask" hangs on any file edit or command (e.g. creating a card). This is the serve-API equivalent
// of `run --auto`. Shared by the host-side home above and the per-project one inside a box.
function writeOpencodeConfig(xdgConfigHome: string): void {
  const cfgDir = join(xdgConfigHome, 'opencode');
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(
    join(cfgDir, 'opencode.json'),
    JSON.stringify({ $schema: 'https://opencode.ai/config.json', permission: 'allow' }, null, 2),
  );
}
