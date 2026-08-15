import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  boxCredentialPath,
  claudeConfigDir,
  claudeStateDir,
  isolationEnabled,
  mirrorClaudeCredential,
  opencodeConfigHome,
} from '../src/server/boxes/copilot-env.js';
import { tempDir } from './helpers.js';

const savedIsolate = process.env.VIBEBOARD_COPILOT_ISOLATE;
const savedHome = process.env.VIBEBOARD_COPILOT_HOME;
const savedUserHome = process.env.HOME;

afterEach(() => {
  if (savedIsolate === undefined) delete process.env.VIBEBOARD_COPILOT_ISOLATE;
  else process.env.VIBEBOARD_COPILOT_ISOLATE = savedIsolate;
  if (savedHome === undefined) delete process.env.VIBEBOARD_COPILOT_HOME;
  else process.env.VIBEBOARD_COPILOT_HOME = savedHome;
  if (savedUserHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedUserHome;
});

describe('isolationEnabled', () => {
  it('defaults on, off only when explicitly "0"', () => {
    delete process.env.VIBEBOARD_COPILOT_ISOLATE;
    expect(isolationEnabled()).toBe(true);
    process.env.VIBEBOARD_COPILOT_ISOLATE = '0';
    expect(isolationEnabled()).toBe(false);
    process.env.VIBEBOARD_COPILOT_ISOLATE = '1';
    expect(isolationEnabled()).toBe(true);
  });
});

describe('config dirs', () => {
  it('creates the clean dirs under VIBEBOARD_COPILOT_HOME', async () => {
    const home = await tempDir();
    process.env.VIBEBOARD_COPILOT_HOME = home;
    const claude = claudeConfigDir();
    const oc = opencodeConfigHome();
    expect(claude).toBe(join(home, 'claude'));
    expect(oc).toBe(join(home, 'opencode-xdg'));
    expect(existsSync(claude)).toBe(true);
    expect(existsSync(oc)).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });
});

// THE CREDENTIAL MIRROR. What is under test is one measured failure: a bind-mounted FILE pins an inode,
// Claude Code refreshes its token by rename, and the box read the old, unlinked inode forever — every
// turn dying in 58ms as an expired session. The mirror exists so the thing mounted is a DIRECTORY, which
// a rename can be seen through, and so the copy inside it tracks the host's.
//
// `HOME` rather than a seam: `claudeCredentialFile()` reads `homedir()`, which on POSIX is `$HOME`. That
// keeps the real function under test instead of an injected stand-in, and keeps every path in this file
// inside the run's own temp root.
interface Staged {
  source: string;
  mirror: string;
  dir: string;
}

async function stage(content: string): Promise<Staged> {
  const home = await tempDir();
  const copilot = await tempDir();
  process.env.HOME = home;
  process.env.VIBEBOARD_COPILOT_HOME = copilot;
  const source = join(home, '.claude', '.credentials.json');
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, content, 'utf8');
  const mirror = boxCredentialPath();
  return { source, mirror, dir: dirname(mirror) };
}

// Same LENGTH as the old one, and a mtime a minute on. A refreshed OAuth token is very nearly the same
// size as the one it replaces, so a change detector that compared only size would pass every test that
// used a longer replacement and still miss the real thing.
function refresh(source: string, content: string): void {
  writeFileSync(source, content, 'utf8');
  const later = new Date(Date.now() + 60_000);
  utimesSync(source, later, later);
}

describe('the Claude credential mirror', () => {
  it('copies the host credential into a directory VibeBoard owns', async () => {
    const { mirror, dir } = await stage('{"token":"one"}');

    expect(mirrorClaudeCredential()).toBe(mirror);

    expect(dir).toBe(join(process.env.VIBEBOARD_COPILOT_HOME as string, 'creds', 'claude'));
    expect(readFileSync(mirror, 'utf8')).toBe('{"token":"one"}');
  });

  it('answers undefined when the host has no credential at all', async () => {
    const { source } = await stage('{"token":"one"}');
    rmSync(source, { force: true });

    // Nothing to mount, and — the part that matters for docker — nothing created for it to mount, since
    // a bind source that does not exist is CREATED by docker, root-owned, on the host.
    expect(mirrorClaudeCredential()).toBeUndefined();
    expect(existsSync(boxCredentialPath())).toBe(false);
  });

  it('FOLLOWS A CHANGED HOST CREDENTIAL, which is the bug this exists for', async () => {
    const { source, mirror } = await stage('{"token":"one"}');
    mirrorClaudeCredential();
    expect(readFileSync(mirror, 'utf8')).toBe('{"token":"one"}');

    refresh(source, '{"token":"two"}');

    expect(mirrorClaudeCredential()).toBe(mirror);
    expect(readFileSync(mirror, 'utf8')).toBe('{"token":"two"}');
  });

  it('skips the copy when nothing changed', async () => {
    // MARKED BY ITS TIMESTAMP, because the two obvious markers do not work. Comparing the inode passed
    // with the skip deleted: the rename frees the old inode and ext4 hands the very same number back to
    // the next file. Marking the CONTENT cannot work either, since content is what the skip compares.
    // An mtime the copy would certainly overwrite, on a file whose bytes are untouched, is what is left
    // — and it is exactly what an unchanged credential looks like after a `touch`.
    const { mirror } = await stage('{"token":"one"}');
    mirrorClaudeCredential();
    const marked = new Date(1_000_000_000_000);
    utimesSync(mirror, marked, marked);

    mirrorClaudeCredential();
    mirrorClaudeCredential();

    expect(statSync(mirror).mtimeMs).toBe(marked.getTime());
  });

  it('never writes the credential in place — the mirror is always a rename', async () => {
    // The race cannot be run: the copy is synchronous, so there is no moment for a reader to be
    // scheduled in. What is asserted instead is the MECHANISM, and a hard link is what makes it
    // observable — a witness linked to the old inode keeps the old bytes iff the new ones arrived by
    // rename. An in-place `writeFileSync(mirror, …)` would show through the witness, and a torn write
    // would be readable at the real path.
    const { source, mirror, dir } = await stage('{"token":"one"}');
    mirrorClaudeCredential();
    const witness = join(dir, 'witness');
    linkSync(mirror, witness);

    refresh(source, '{"token":"two"}');
    mirrorClaudeCredential();

    expect(readFileSync(witness, 'utf8')).toBe('{"token":"one"}');
    expect(readFileSync(mirror, 'utf8')).toBe('{"token":"two"}');
    // And nothing half-written is left lying beside it under a name of its own.
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('leaves the directory 0700 and the file 0600', async () => {
    const { mirror, dir } = await stage('{"token":"one"}');
    mirrorClaudeCredential();

    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(mirror).mode & 0o777).toBe(0o600);
  });

  it('TIGHTENS a directory that already exists too open', async () => {
    // The case the explicit `chmodSync` is actually for. `mkdirSync`'s mode applies only where it
    // creates, so a directory left at 0755 by an earlier version — or by anything else that made it
    // first — would stay world-readable with a credential in it forever.
    const { dir } = await stage('{"token":"one"}');
    mkdirSync(dir, { recursive: true, mode: 0o755 });

    mirrorClaudeCredential();

    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
});

describe('the credential symlink a box reads through', () => {
  it("points at the mirror, not at the user's own ~/.claude", async () => {
    // The link is absolute and the box mounts that same absolute path, so what it names has to be a path
    // the box actually has. `~/.claude` is not mounted at all any more, so a link there dangles inside.
    const { mirror } = await stage('{"token":"one"}');
    const state = claudeStateDir(await tempDir());

    const link = join(state, '.credentials.json');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(mirror);
  });

  it('REPOINTS a link left behind by the version that mounted ~/.claude', async () => {
    // `symlinkSync` fails with EEXIST rather than replacing, so a state directory written before the
    // mount moved keeps its old target — and dangles inside the box, silently, only on machines that
    // had run VibeBoard before.
    const { source, mirror } = await stage('{"token":"one"}');
    const project = await tempDir();
    // Planted where the real function will look, by asking the real function for the directory and then
    // putting the old target back — a hand-built path would test a directory nothing reads.
    const state = claudeStateDir(project);
    const link = join(state, '.credentials.json');
    rmSync(link, { force: true });
    symlinkSync(source, link);

    claudeStateDir(project);

    expect(readlinkSync(link)).toBe(mirror);
  });
});
