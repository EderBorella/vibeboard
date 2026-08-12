import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { AUTOPILOT_STATE_FILE, CONFIG_DIR } from '../src/core/layout.js';
import { COMMAND_TIMEOUT_MS } from '../src/server/commands.js';
import {
  commitAll,
  ensureBranch,
  PREFLIGHT_MESSAGE,
  PROBE_TIMEOUT_MS,
  startSession,
  WORK_TIMEOUT_MS,
} from '../src/server/git-work.js';
import { tempDir } from './helpers.js';

const exec = promisify(execFile);

const git = (cwd: string, args: string[]): Promise<{ stdout: string }> => exec('git', args, { cwd });

// A real repository, with everything the machine could contribute set LOCALLY: an identity, signing off
// (a machine that signs every commit would fail this whole file for a reason unrelated to the code), and
// an empty hooks directory — a contributor with a global `core.hooksPath`, or an `init.templateDir` that
// installs hooks, would otherwise be running their own gate inside these fixtures.
async function repo(): Promise<string> {
  const dir = await tempDir();
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'test@example.invalid']);
  await git(dir, ['config', 'user.name', 'VibeBoard Test']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  // Empty, and untracked because git does not track empty directories — so it changes nothing the
  // clean-tree assertions depend on.
  await mkdir(join(dir, '.nohooks'), { recursive: true });
  await git(dir, ['config', 'core.hooksPath', '.nohooks']);
  return dir;
}

// A hook of our own, for the two tests that are about what a project's own gate does to a commit.
async function hook(dir: string, script: string): Promise<void> {
  const hooks = join(dir, '.myhooks');
  await mkdir(hooks, { recursive: true });
  await writeFile(join(hooks, 'pre-commit'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  await git(dir, ['config', 'core.hooksPath', '.myhooks']);
}

// An outer repository with a real submodule at `sub/`. `protocol.file.allow` because git refuses the
// file transport for submodules by default (CVE-2022-39253), and this is a local path.
async function withSubmodule(): Promise<{ outer: string; sub: string }> {
  const inner = await committed(await repo(), 'inner.txt');
  const outer = await committed(await repo());
  await git(outer, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', inner, 'sub']);
  await git(outer, ['commit', '-q', '-m', 'add the submodule']);
  return { outer, sub: join(outer, 'sub') };
}

async function committed(dir: string, name = 'seed.txt'): Promise<string> {
  await writeFile(join(dir, name), 'seed\n');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'seed']);
  return dir;
}

const branch = async (dir: string): Promise<string> =>
  (await git(dir, ['branch', '--show-current'])).stdout.trim();

const count = async (dir: string): Promise<number> =>
  Number((await git(dir, ['rev-list', '--count', 'HEAD'])).stdout.trim());

const message = async (dir: string): Promise<string> =>
  (await git(dir, ['log', '-1', '--pretty=%B'])).stdout.trimEnd();

const tracked = async (dir: string): Promise<string[]> =>
  (await git(dir, ['ls-files'])).stdout.trim().split('\n').filter(Boolean).sort();

// What the last COMMIT holds, which is a different question from what the index holds: `ls-files` lists staged
// paths too, so a colleague's staged-but-uncommitted file reads as "tracked" and an assertion about a commit
// built on it answers about the wrong thing.
const committedFiles = async (dir: string): Promise<string[]> =>
  (await git(dir, ['ls-tree', '-r', '--name-only', 'HEAD'])).stdout.trim().split('\n').filter(Boolean).sort();

// Numbers rather than behaviour, deliberately: the honest test is a hook that really takes 13 seconds,
// and that would double the suite's runtime to hold one constant. This is the constant nobody could see —
// the ten-second bound applied to `git commit` as well as to the probes, so auto-pilot could not have
// committed in THIS repository, whose own pre-commit hook runs three typechecks and the whole suite.
describe('the two timeouts', () => {
  it('bounds a commit by what a project’s own tooling may take, not by what a probe should take', () => {
    expect(WORK_TIMEOUT_MS).toBe(COMMAND_TIMEOUT_MS);
    expect(WORK_TIMEOUT_MS).toBeGreaterThanOrEqual(600_000);
    expect(PROBE_TIMEOUT_MS).toBeLessThan(WORK_TIMEOUT_MS);
  });
});

describe('putting the run on its own branch', () => {
  it('creates the branch and checks it out', async () => {
    const dir = await committed(await repo());
    expect(await ensureBranch(dir, 'autopilot/run-1')).toEqual({
      ok: true,
      branch: 'autopilot/run-1',
      created: true,
    });
    expect(await branch(dir)).toBe('autopilot/run-1');
  });

  it('is a no-op when it is already the current branch', async () => {
    const dir = await committed(await repo());
    await ensureBranch(dir, 'autopilot/run-1');
    expect(await ensureBranch(dir, 'autopilot/run-1')).toEqual({
      ok: true,
      branch: 'autopilot/run-1',
      created: false,
    });
  });

  it('checks out a branch that already exists rather than failing to create it', async () => {
    const dir = await committed(await repo());
    await git(dir, ['branch', 'autopilot/run-1']);
    expect(await ensureBranch(dir, 'autopilot/run-1')).toMatchObject({ ok: true, created: false });
    expect(await branch(dir)).toBe('autopilot/run-1');
  });

  // The whole point of the guard: a switch carries whatever is in the tree with it, and the very next
  // thing the loop does is commit everything. Someone's half-finished edit would land in the run's
  // history under a message saying an agent did it.
  it('refuses to switch while the tree is dirty, and says what to do', async () => {
    const dir = await committed(await repo());
    await writeFile(join(dir, 'mine.txt'), 'work in progress\n');
    const result = await ensureBranch(dir, 'autopilot/run-1');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/uncommitted/i);
    expect(await branch(dir)).toBe('main');
  });

  it('refuses the same way when the branch already exists', async () => {
    const dir = await committed(await repo());
    await git(dir, ['branch', 'autopilot/run-1']);
    await writeFile(join(dir, 'mine.txt'), 'work in progress\n');
    expect((await ensureBranch(dir, 'autopilot/run-1')).ok).toBe(false);
    expect(await branch(dir)).toBe('main');
  });

  // Straight after `git init`, before any commit exists. This is the ordinary first dispatch on a new
  // project, and `HEAD` does not resolve yet — every command here has to cope with that.
  it('works on a repository with no commits yet', async () => {
    const dir = await repo();
    expect(await ensureBranch(dir, 'autopilot/run-1')).toMatchObject({ ok: true, created: true });
    expect(await branch(dir)).toBe('autopilot/run-1');
  });

  // The line that lets the loop run at all, and nothing held it: an agent always leaves the tree dirty,
  // so if being already on the branch did not short-circuit, every tick after the first would be refused
  // by the guard above. That is also why auto-pilot uses one branch per SESSION rather than per run.
  it('allows a dirty tree when it is already the run’s own branch', async () => {
    const dir = await committed(await repo());
    await ensureBranch(dir, 'autopilot/run-1');
    await writeFile(join(dir, 'agent-wrote-this.txt'), 'work\n');
    expect(await ensureBranch(dir, 'autopilot/run-1')).toEqual({
      ok: true,
      branch: 'autopilot/run-1',
      created: false,
    });
  });

  it('refuses a branch with no name instead of reading it as "already there"', async () => {
    // On a detached HEAD `git branch --show-current` prints nothing, so comparing the current branch as
    // a plain string made an empty name look like a no-op success — after which every commit the loop
    // made would be unreachable, the exact inverse of what this module is for.
    const dir = await committed(await repo());
    await git(dir, ['checkout', '-q', '--detach']);
    const result = await ensureBranch(dir, '');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/no name/i);
  });

  it('reports a name git rejects rather than leaving HEAD somewhere unexpected', async () => {
    const dir = await committed(await repo());
    const result = await ensureBranch(dir, 'has a space');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/not a valid branch name/i);
    expect(await branch(dir)).toBe('main');
  });

  // `execFile` validates its arguments synchronously and THROWS on a NUL byte, inside the promise
  // executor — so this used to reject rather than refuse, breaking the module's one contract. A card's
  // frontmatter can carry one: a YAML double-quoted scalar accepts `\0`.
  it('refuses a name containing a NUL byte instead of throwing', async () => {
    const dir = await committed(await repo());
    const result = await ensureBranch(dir, 'autopilot/\u0000run');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/null bytes/i);
  });

  it('refuses when there is no repository, rather than throwing', async () => {
    const dir = await tempDir();
    const result = await ensureBranch(dir, 'autopilot/run-1');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/not a git repository/i);
  });

  // Two different faults that used to produce the same sentence. Blaming the project when git is not
  // installed sends the reader to the one place the fault is not.
  it('names git, not the project, when git cannot be run at all', async () => {
    const dir = await committed(await repo());
    const result = await ensureBranch(dir, 'autopilot/run-1', { env: { PATH: '/nonexistent' } });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^git could not be run/);
    expect(result.ok === false && result.reason).not.toMatch(/not a git repository/i);
  });

  it('refuses when the project is itself a submodule of another repository', async () => {
    // It passes the repository-root test — `--show-toplevel` inside a submodule is the submodule — but
    // committing here leaves the superproject pointing at a commit it never recorded, so reverting the
    // run would not undo it.
    const { outer, sub } = await withSubmodule();
    const result = await ensureBranch(sub, 'autopilot/run-1');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/submodule/);
    expect(result.ok === false && result.reason).toContain(outer);
  });

  // A project inside a larger repository is an ordinary thing to adopt, and `scaffold.ts` deliberately does
  // not give one its own `.git` — that would shadow the parent. Refusing it here meant a working board
  // auto-pilot would always refuse (ruled 2026-08-06).
  it('works when the project is a subdirectory of a repository', async () => {
    const outer = await committed(await repo());
    const inner = join(outer, 'packages', 'thing');
    await mkdir(inner, { recursive: true });
    expect(await ensureBranch(inner, 'autopilot/run-1')).toMatchObject({ ok: true, created: true });
  });

  // What replaces the refusal: every command is scoped to the project directory, so somebody else's edit
  // elsewhere in the repository is not this project's dirty tree — and is therefore not something a run
  // would commit.
  it('ignores changes outside the project when deciding the tree is dirty', async () => {
    const outer = await committed(await repo());
    const inner = join(outer, 'packages', 'thing');
    await mkdir(inner, { recursive: true });
    await writeFile(join(inner, 'kept.txt'), 'the project\n');
    await git(inner, ['add', '-A']);
    await git(inner, ['commit', '-q', '-m', 'the project']);

    // Someone editing the monorepo outside this project.
    await writeFile(join(outer, 'theirs.txt'), 'not ours\n');
    expect(await ensureBranch(inner, 'autopilot/run-1')).toMatchObject({ ok: true });
  });

  // THE FIRST HAND-RUN'S FINDING (2026-08-06), and it stopped auto-pilot starting on any project at all.
  // `POST /autopilot/start` writes the state file to record `running` and the service's process group
  // before spawning the loop — so the loop's own `ensureBranch` always found a dirty tree, and the reason
  // it gave named a file the user had been told to commit by hand moments earlier.
  it('switches when the only uncommitted file is auto-pilot’s own state', async () => {
    const dir = await committed(await repo());
    await mkdir(join(dir, '.vibeboard'), { recursive: true });
    await writeFile(join(dir, AUTOPILOT_STATE_FILE), '{"state":"running"}\n');
    expect(await ensureBranch(dir, 'autopilot/run-1')).toMatchObject({ ok: true, created: true });
    expect(await branch(dir)).toBe('autopilot/run-1');
  });

  // THE TWO NEW CAPABILITIES TOGETHER, which is the combination nothing exercised: a subdirectory project AND
  // the state-file exclusion. The pathspec resolves against the git CWD, so this is what would break if it were
  // ever anchored with `:/` or written toplevel-relative — and it would break silently, in the topology that is
  // hardest to notice.
  it('switches in a subdirectory project when only its own state file is dirty', async () => {
    const outer = await committed(await repo());
    const inner = join(outer, 'packages', 'thing');
    await mkdir(join(inner, '.vibeboard'), { recursive: true });
    await writeFile(join(inner, 'kept.txt'), 'the project\n');
    await git(inner, ['add', '-A']);
    await git(inner, ['commit', '-q', '-m', 'the project']);

    await writeFile(join(inner, AUTOPILOT_STATE_FILE), '{"state":"running"}\n');
    expect(await ensureBranch(inner, 'autopilot/run-1')).toMatchObject({ ok: true, created: true });
  });

  // The other direction, and the reason the exclusion is safe: git collapses an untracked directory to a
  // single entry and reports that entry whenever anything inside it is NOT excluded. So a freshly
  // scaffolded project — whose whole `.vibeboard/` is untracked, state file included — still refuses, and
  // the by-hand first commit is still required.
  it('still refuses a freshly scaffolded project, whose whole cockpit is untracked', async () => {
    const dir = await committed(await repo());
    await mkdir(join(dir, '.vibeboard', 'boards'), { recursive: true });
    await writeFile(join(dir, '.vibeboard', 'config.yaml'), 'name: thing\n');
    await writeFile(join(dir, AUTOPILOT_STATE_FILE), '{"state":"running"}\n');
    expect(await ensureBranch(dir, 'autopilot/run-1')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('.vibeboard'),
    });
    expect(await branch(dir)).toBe('main');
  });
});

describe('committing before every dispatch', () => {
  it('commits every change, tracked and untracked alike', async () => {
    const dir = await committed(await repo());
    await writeFile(join(dir, 'seed.txt'), 'changed\n');
    await writeFile(join(dir, 'new.txt'), 'new\n');
    expect(await commitAll(dir, 'autopilot: before E-001')).toEqual({ committed: true });
    expect(await tracked(dir)).toEqual(['new.txt', 'seed.txt']);
    expect(await count(dir)).toBe(2);
  });

  it('commits when the board folder is GITIGNORED, which is how projects ship', async () => {
    // The bug this pins, observed on a real project (2026-08-11): `git add` is the one command that
    // treats an `:(exclude)` inside an ignored directory as an explicit request for an ignored path,
    // and FAILS — exit 1, "The following paths are ignored by one of your .gitignore files". So every
    // commit-before-dispatch failed and auto-pilot stopped on its first tick. Scaffolding started
    // ignoring that folder the day before, which is what exposed it.
    const dir = await repo();
    await writeFile(join(dir, '.gitignore'), `${CONFIG_DIR}/\n`, 'utf8');
    await mkdir(join(dir, CONFIG_DIR), { recursive: true });
    await writeFile(join(dir, AUTOPILOT_STATE_FILE), '{"state":"running"}\n', 'utf8');
    await committed(dir);
    await writeFile(join(dir, 'app.ts'), 'export const x = 1;\n', 'utf8');

    expect(await commitAll(dir, 'autopilot: before E-001')).toEqual({ committed: true });
    expect(await tracked(dir)).toContain('app.ts');
    // And the ignored folder stayed out, which is the whole reason it is ignored.
    expect((await tracked(dir)).some((f) => f.startsWith(CONFIG_DIR))).toBe(false);
  });

  it('still keeps the state file out of a project that TRACKS the board folder', async () => {
    // The other half, and why the exclusion cannot simply be deleted: a project with no `.gitignore`
    // — every project scaffolded before 2026-08-10 — would otherwise commit the loop's own state file,
    // which holds a process group id meaningless on another machine. That was the 2026-08-06 bug.
    const dir = await repo();
    await mkdir(join(dir, CONFIG_DIR), { recursive: true });
    await writeFile(join(dir, `${CONFIG_DIR}/config.yaml`), 'name: T\n', 'utf8');
    await committed(dir);
    await writeFile(join(dir, AUTOPILOT_STATE_FILE), '{"state":"running"}\n', 'utf8');
    await writeFile(join(dir, 'app.ts'), 'export const x = 1;\n', 'utf8');

    expect(await commitAll(dir, 'autopilot: before E-001')).toEqual({ committed: true });
    const files = await tracked(dir);
    expect(files).toContain('app.ts');
    expect(files).not.toContain(AUTOPILOT_STATE_FILE);
  });

  it('uses the message verbatim', async () => {
    const dir = await committed(await repo());
    await writeFile(join(dir, 'new.txt'), 'new\n');
    // The whole string, not a substring: a message assembled with the wrong separator is invisible to
    // `toContain` and this is the line a person reads in a log.
    await commitAll(dir, 'autopilot: E-001 implement (iteration 4)');
    expect(await message(dir)).toBe('autopilot: E-001 implement (iteration 4)');
  });

  // A commit per tick on an unchanged tree would fill the history with nothing, and then "which commit
  // was this run?" has no answer.
  it('makes no commit at all when the tree is clean', async () => {
    const dir = await committed(await repo());
    const before = await count(dir);
    const result = await commitAll(dir, 'autopilot: nothing to see');
    expect(result).toEqual({ committed: false });
    expect(result.reason).toBeUndefined(); // nothing to commit is not a failure
    expect(await count(dir)).toBe(before);
  });

  it('creates the root commit on a repository with no commits yet', async () => {
    const dir = await repo();
    await writeFile(join(dir, 'new.txt'), 'new\n');
    expect(await commitAll(dir, 'autopilot: first')).toEqual({ committed: true });
    expect(await count(dir)).toBe(1);
    expect(await message(dir)).toBe('autopilot: first');
  });

  it('leaves ignored files alone', async () => {
    // This repository's own plans live in an ignored directory, and a run must not publish them.
    const dir = await repo();
    await writeFile(join(dir, '.gitignore'), 'secret/\n');
    await mkdir(join(dir, 'secret'), { recursive: true });
    await writeFile(join(dir, 'secret', 'notes.md'), 'local only\n');
    await writeFile(join(dir, 'kept.txt'), 'kept\n');
    expect(await commitAll(dir, 'autopilot: first')).toEqual({ committed: true });
    expect(await tracked(dir)).toEqual(['.gitignore', 'kept.txt']);
  });

  it('reports a failure with its reason instead of throwing', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'new.txt'), 'new\n');
    const result = await commitAll(dir, 'autopilot: nowhere');
    expect(result.committed).toBe(false);
    // Distinguishable from a clean tree, which is the point: a failure means the revert guarantee this
    // step exists for is not holding, and the loop must stop rather than dispatch.
    expect(result.reason).toMatch(/not a git repository/i);
  });

  // THE SCOPING, which is what replaced the repo-root refusal. A run commits everything under its own
  // project directory and nothing outside it: an agent is expected to touch only what its card is about, and
  // an unrelated edit elsewhere in the repository must not end up in a run's commit either way.
  it('commits what is inside the project and leaves what is outside alone', async () => {
    const outer = await committed(await repo());
    const inner = join(outer, 'packages', 'thing');
    await mkdir(inner, { recursive: true });
    await writeFile(join(inner, 'ours.txt'), 'the project\n');
    await writeFile(join(outer, 'theirs.txt'), 'somebody else\n');

    expect(await commitAll(inner, 'autopilot: E-001')).toEqual({ committed: true });
    // Ours is in; theirs is still sitting there uncommitted.
    expect(await tracked(outer)).toEqual(['packages/thing/ours.txt', 'seed.txt']);
    expect((await git(outer, ['status', '--porcelain'])).stdout).toContain('theirs.txt');
  });

  // THE PATHSPEC ON `git commit` ITSELF, which nothing held: every test staged only project files, so the
  // commit's own scoping was unexercised and removing it changed no result. Somebody else's work staged
  // elsewhere in the monorepo must stay staged rather than being swept into a run's commit under an agent's
  // message. Found in review (2026-08-06).
  it('leaves work somebody else staged outside the project out of the run’s commit', async () => {
    const outer = await committed(await repo());
    const inner = join(outer, 'packages', 'thing');
    await mkdir(inner, { recursive: true });
    await writeFile(join(inner, 'ours.txt'), 'the project\n');

    // Staged, not merely dirty: `git commit` with no pathspec commits the INDEX, so this is the case where
    // the scoping is the only thing standing between a colleague's work and an agent's commit.
    await writeFile(join(outer, 'theirs.txt'), 'somebody else\n');
    await git(outer, ['add', 'theirs.txt']);

    expect(await commitAll(inner, 'autopilot: E-001')).toEqual({ committed: true });
    // The COMMIT, not the index: theirs.txt is staged, so `ls-files` would list it either way.
    expect(await committedFiles(outer)).toEqual(['packages/thing/ours.txt', 'seed.txt']);
    // Still staged, still theirs, still uncommitted.
    expect((await git(outer, ['diff', '--cached', '--name-only'])).stdout.trim()).toBe('theirs.txt');
  });

  it('reports nothing to commit when the only changes are outside the project', async () => {
    const outer = await committed(await repo());
    const inner = join(outer, 'packages', 'thing');
    await mkdir(inner, { recursive: true });
    await writeFile(join(inner, 'ours.txt'), 'the project\n');
    await commitAll(inner, 'autopilot: first');

    await writeFile(join(outer, 'theirs.txt'), 'somebody else\n');
    const before = await count(outer);
    expect(await commitAll(inner, 'autopilot: E-002')).toEqual({ committed: false });
    expect(await count(outer)).toBe(before);
  });

  // Machine state, not work. It is rewritten every tick and it holds a process group id that means
  // nothing on another machine, so committing it would put one machine's pids in another's checkout —
  // and reverting a run would restore a stale process group.
  it('never commits auto-pilot’s own state file', async () => {
    const dir = await committed(await repo());
    await mkdir(join(dir, '.vibeboard'), { recursive: true });
    await writeFile(join(dir, AUTOPILOT_STATE_FILE), '{"state":"running","servicePgid":1234}\n');
    await writeFile(join(dir, 'work.txt'), 'what the agent did\n');

    expect(await commitAll(dir, 'autopilot: E-001')).toEqual({ committed: true });
    expect(await tracked(dir)).toEqual(['seed.txt', 'work.txt']);
  });

  // And the state file alone is ORDINARY — "there was nothing to save". Without the exclusion on `status`
  // as well, this path staged nothing, found no staged diff, and then reported "the tree has changes git
  // will not record": the submodule sentence, delivered on every quiet tick.
  it('reports nothing to commit — with no reason — when only its own state changed', async () => {
    const dir = await committed(await repo());
    await mkdir(join(dir, '.vibeboard'), { recursive: true });
    await writeFile(join(dir, AUTOPILOT_STATE_FILE), '{"state":"running"}\n');
    const before = await count(dir);

    const result = await commitAll(dir, 'autopilot: E-002');
    expect(result).toEqual({ committed: false });
    expect(result.reason).toBeUndefined();
    expect(await count(dir)).toBe(before);
  });

  // REAL MERGE, real conflict. `PROJECT_ONLY` makes every commit a PARTIAL commit and git refuses one during a
  // merge, so before this the loop stopped on every tick quoting "cannot do a partial commit during a merge" —
  // a phrase about a git mode nobody chose. Stopping is right; the sentence is the fix.
  it('refuses to commit during a merge, and says that is what is happening', async () => {
    const dir = await committed(await repo());
    await git(dir, ['checkout', '-q', '-b', 'theirs']);
    await writeFile(join(dir, 'seed.txt'), 'theirs\n');
    await git(dir, ['commit', '-qam', 'theirs']);
    await git(dir, ['checkout', '-q', 'main']);
    await writeFile(join(dir, 'seed.txt'), 'ours\n');
    await git(dir, ['commit', '-qam', 'ours']);
    // Conflicts, so the merge stops and MERGE_HEAD is left behind.
    await git(dir, ['merge', 'theirs']).catch(() => undefined);
    await writeFile(join(dir, 'seed.txt'), 'resolved\n');
    await git(dir, ['add', '-A']);

    const before = await count(dir);
    const result = await commitAll(dir, 'autopilot: before E-001');
    expect(result.committed).toBe(false);
    expect(result.reason).toMatch(/middle of a merge/i);
    // NOT git's own words about a mode nobody chose.
    expect(result.reason).not.toMatch(/partial commit/i);
    expect(await count(dir)).toBe(before);
  });

  // THE FOURTH PATHSPEC — the one on `diff --cached` — and the case that makes it load-bearing. A review
  // planted its removal and the whole suite stayed green, because `add -A` carries the same pathspec so nothing
  // it could see gets staged BY US. But a colleague can stage something outside the project themselves: then an
  // unscoped `diff --cached` sees their file, concludes this project has changes, and runs a `commit` whose own
  // pathspec matches nothing — which exits non-zero and is reported as "Could not commit" on a project where
  // there was simply nothing to do.
  it('reports nothing to commit when the only STAGED change is outside the project', async () => {
    const outer = await committed(await repo());
    const inner = join(outer, 'packages', 'thing');
    await mkdir(inner, { recursive: true });
    await writeFile(join(inner, 'ours.txt'), 'the project\n');
    await commitAll(inner, 'autopilot: first');

    await writeFile(join(outer, 'theirs.txt'), 'somebody else\n');
    await git(outer, ['add', 'theirs.txt']);

    const before = await count(outer);
    const result = await commitAll(inner, 'autopilot: E-002');
    // Nothing to commit is ordinary and carries NO reason; a reason here would stop the loop.
    expect(result).toEqual({ committed: false });
    expect(result.reason).toBeUndefined();
    expect(await count(outer)).toBe(before);
  });

  it('refuses a message containing a NUL byte instead of throwing', async () => {
    const dir = await committed(await repo());
    await writeFile(join(dir, 'new.txt'), 'new\n');
    const result = await commitAll(dir, 'autopilot: E-001 \u0000 lands');
    expect(result.committed).toBe(false);
    expect(result.reason).toMatch(/null bytes/i);
  });

  // "Nothing staged" is not "nothing changed". `add -A` records a submodule's POINTER, which has not
  // moved, so a visibly dirty tree stages to nothing — and the old code answered exactly as it does for a
  // clean tree. Then `ensureBranch` refuses the dirty tree for ever and nothing can clear it.
  it('says so when the tree holds changes git will not record', async () => {
    const { outer, sub } = await withSubmodule();
    await writeFile(join(sub, 'inner.txt'), 'the agent edited this\n');
    const result = await commitAll(outer, 'autopilot: E-001');
    expect(result.committed).toBe(false);
    expect(result.reason).toMatch(/will not record/);
    expect(result.reason).toContain('sub');
  });
});

// A project's hooks are its own gate, and `git commit` runs them. Everything here is about that.
// Two failure paths that had no test, found by planting: a `git add` that fails, and a commit made from
// a branch the caller did not put us on.
describe('refusing to commit the wrong thing', () => {
  it('reports a staging failure with git’s own reason', async () => {
    // A nested checkout with nothing checked out: `add -A` refuses it, and the message is git's.
    const dir = await committed(await repo());
    await mkdir(join(dir, 'vendor'), { recursive: true });
    await git(join(dir, 'vendor'), ['init', '-q', '-b', 'main']);
    await git(dir, ['add', 'vendor']).catch(() => undefined);
    const result = await commitAll(dir, 'autopilot: E-001');
    expect(result.committed).toBe(false);
    // GIT'S OWN WORDS, not just our prefix. Asserting the prefix alone left the interpolation unheld, and
    // `committed: false` is no gate here either — with the staging refusal deleted, the later
    // unrecordable-changes guard answers `false` too. The reason is the only thing that tells them apart.
    expect(result.reason).toMatch(/Could not stage the tree/);
    expect(result.reason).toMatch(/does not have a commit checked out/);
  });

  it('refuses when it is not on the branch it was told to be on', async () => {
    // The caller ignored an `ensureBranch` refusal. Committing here would put a person's uncommitted work
    // on their own branch under a message saying an agent wrote it.
    const dir = await committed(await repo());
    await writeFile(join(dir, 'mine.txt'), 'work in progress\n');
    const result = await commitAll(dir, 'autopilot: E-001', { branch: 'autopilot/run-1' });
    expect(result.committed).toBe(false);
    // The WHOLE sentence. The two branch names alone left the half that says why unheld, and here the
    // sentence is the behaviour: a refusal a reader cannot act on is the dead end this design will not ship.
    expect(result.reason).toBe(
      'Auto-pilot is on branch main rather than autopilot/run-1, so it will not commit: the tree may hold work that is not its own.',
    );
    expect(await count(dir)).toBe(1);
  });

  it('says so plainly when there is no branch at all', async () => {
    // A detached HEAD. `currentBranch` answers `undefined` rather than `''` precisely so this case cannot
    // be confused with "no name given", and the sentence has to survive that — an interpolated `undefined`
    // is exactly the dead end the fallback exists to prevent.
    const dir = await committed(await repo());
    await git(dir, ['checkout', '-q', '--detach']);
    await writeFile(join(dir, 'mine.txt'), 'work in progress\n');
    const result = await commitAll(dir, 'autopilot: E-001', { branch: 'autopilot/run-1' });
    expect(result.committed).toBe(false);
    expect(result.reason).toContain('(a detached HEAD)');
    expect(result.reason).not.toContain('undefined');
  });

  it('treats an empty branch name as a check that was asked for, not one to skip', async () => {
    // `!== undefined` rather than truthiness: `branch: ''` is a caller that got an empty answer from
    // somewhere, and skipping the guard for it would be the fail-open reading.
    const dir = await committed(await repo());
    await writeFile(join(dir, 'mine.txt'), 'work in progress\n');
    const result = await commitAll(dir, 'autopilot: E-001', { branch: '' });
    expect(result.committed).toBe(false);
    expect(result.reason).toContain('rather than');
  });

  it('commits when it is', async () => {
    const dir = await committed(await repo());
    await ensureBranch(dir, 'autopilot/run-1');
    await writeFile(join(dir, 'new.txt'), 'new\n');
    expect(await commitAll(dir, 'autopilot: E-001', { branch: 'autopilot/run-1' })).toEqual({
      committed: true,
    });
  });
});

describe('a project’s own pre-commit hook', () => {
  it('reports the hook’s refusal as the reason', async () => {
    const dir = await committed(await repo());
    await hook(dir, 'echo "the gate says no" 1>&2; exit 1');
    await writeFile(join(dir, 'new.txt'), 'new\n');
    const result = await commitAll(dir, 'autopilot: E-001');
    expect(result.committed).toBe(false);
    expect(result.reason).toContain('the gate says no');
  });

  // The blocker this timeout was raised for. THIS repository's own pre-commit hook runs three typechecks
  // and the whole test suite — over 13 seconds — so a ten-second bound killed every commit auto-pilot
  // would ever have made here, every tick, with a reason that named neither the hook nor the timeout.
  it('is reported as a timeout, naming a hook, rather than as an ordinary failure', async () => {
    const dir = await committed(await repo());
    await hook(dir, 'sleep 30');
    await writeFile(join(dir, 'new.txt'), 'new\n');
    const result = await commitAll(dir, 'autopilot: E-001', { timeoutMs: 500 });
    expect(result.committed).toBe(false);
    expect(result.reason).toMatch(/did not finish within/);
    expect(result.reason).toMatch(/hook/);
  });

  it('and a hook that passes commits as usual', async () => {
    // Not decoration: without this the two tests above would pass just as well against a `commitAll`
    // that refused every project with a hook at all.
    const dir = await committed(await repo());
    await hook(dir, 'exit 0');
    await writeFile(join(dir, 'new.txt'), 'new\n');
    expect(await commitAll(dir, 'autopilot: E-001')).toEqual({ committed: true });
  });
});

// STARTING A SESSION: commit whatever is lying about, then get onto the session's own branch.
//
// The ruling behind it (2026-08-11): a dirty tree must not be a blocker. It had been one, and the refusal was
// reached by the ordinary case rather than an unusual one — a freshly scaffolded project has untracked files,
// and every session leaves its last agent's work uncommitted by construction. In the real project that
// blocked Start, the dirty entries were two stray agent reports from the day before.
describe('starting a session', () => {
  it('commits what was already there and then switches, in that order', async () => {
    const dir = await committed(await repo());
    await writeFile(join(dir, 'mine.txt'), 'work in progress\n');

    expect(await startSession(dir, 'autopilot/2026-08-12')).toMatchObject({ ok: true, created: true });
    expect(await branch(dir)).toBe('autopilot/2026-08-12');
    expect(await committedFiles(dir)).toEqual(['mine.txt', 'seed.txt']);
  });

  // THE ORDER IS THE BEHAVIOUR, and this is the assertion that pins it: the pre-flight commit belongs to the
  // branch the person was on. Committed after the switch instead, their own uncommitted work would live only
  // on an auto-pilot branch — delete that branch and it is gone.
  it('leaves that commit on the branch you were already on, not on the session’s', async () => {
    const dir = await committed(await repo());
    await writeFile(join(dir, 'mine.txt'), 'work in progress\n');
    await startSession(dir, 'autopilot/2026-08-12');

    // `main` has it too, which can only be true if the commit was made before the branch was created.
    expect((await git(dir, ['log', '--oneline', 'main'])).stdout).toContain(PREFLIGHT_MESSAGE);
    expect((await git(dir, ['rev-parse', 'main'])).stdout.trim()).toBe(
      (await git(dir, ['rev-parse', 'autopilot/2026-08-12'])).stdout.trim(),
    );
  });

  // The exact shape that blocked the real project: files an agent left at the project root, untracked, and
  // not covered by `.gitignore` because they are not under `.vibeboard/`.
  it('sweeps an untracked file at the project root, which is what blocked a real Start', async () => {
    const dir = await committed(await repo());
    await writeFile(join(dir, '20260811-211852-exer.report.md'), '---\noutcome: success\n---\n');

    expect(await startSession(dir, 'autopilot/2026-08-12')).toMatchObject({ ok: true });
    expect(await committedFiles(dir)).toContain('20260811-211852-exer.report.md');
  });

  it('records nothing when the tree is already clean', async () => {
    const dir = await committed(await repo());
    const before = await count(dir);
    expect(await startSession(dir, 'autopilot/2026-08-12')).toMatchObject({ ok: true });
    // No `--allow-empty` anywhere: a clean tree costs nothing and leaves no commit saying it did.
    expect(await count(dir)).toBe(before);
    expect(await message(dir)).toBe('seed');
  });

  // Already on the branch — a second session the same day. It still commits, and that is the point rather
  // than a side effect: `ensureBranch` allows a dirty tree in that case, so without the sweep the previous
  // session's leftovers would be swept up by the next card's commit, under that card's message.
  it('still commits when it is already on the session’s branch', async () => {
    const dir = await committed(await repo());
    await startSession(dir, 'autopilot/2026-08-12');
    await writeFile(join(dir, 'left-behind.txt'), 'yesterday’s agent\n');

    expect(await startSession(dir, 'autopilot/2026-08-12')).toMatchObject({ ok: true, created: false });
    expect(await message(dir)).toBe(PREFLIGHT_MESSAGE);
    expect(await committedFiles(dir)).toContain('left-behind.txt');
  });

  // A tree that cannot be committed is a session with no revert guarantee, which is the promise that makes
  // running unattended safe. It stops, and it names the real obstacle.
  //
  // ALREADY ON THE BRANCH, and a failing hook rather than a submodule, because those two details are the only
  // way this assertion is about the new guard at all. Planting showed why: with the guard deleted, the
  // submodule version still failed — `ensureBranch` refuses a submodule too, and a dirty tree, so both of the
  // obvious fixtures are held by the OLD code and the sentence merely happened to match. Already on the
  // branch, `ensureBranch` is a no-op that allows any tree, so nothing else can catch this.
  it('does not begin a session whose tree it could not commit', async () => {
    const dir = await committed(await repo());
    await startSession(dir, 'autopilot/2026-08-12');
    await hook(dir, 'echo "the gate says no" 1>&2; exit 1');
    await writeFile(join(dir, 'mine.txt'), 'work in progress\n');

    const result = await startSession(dir, 'autopilot/2026-08-12');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('the gate says no');
    expect(result.ok === false && result.reason).toMatch(/could not commit what was already in the tree/i);
  });

  // The other obstacle, which `ensureBranch` also refuses. Kept because the SENTENCE is what a person acts
  // on, and it must name the submodule rather than the dirty tree that is merely a consequence of it.
  it('names a submodule as the obstacle, not the tree it left dirty', async () => {
    const { outer, sub } = await withSubmodule();
    await writeFile(join(sub, 'inside.txt'), 'edited inside the submodule\n');

    const result = await startSession(sub, 'autopilot/2026-08-12');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/submodule/i);
    // Still where it was: no branch was created, in either repository.
    expect(await branch(sub)).toBe('main');
    expect(await branch(outer)).toBe('main');
  });

  it('works on a repository with no commits yet, which is a project’s first session', async () => {
    const dir = await repo();
    await writeFile(join(dir, 'README.md'), '# New\n');
    expect(await startSession(dir, 'autopilot/2026-08-12')).toMatchObject({ ok: true, created: true });
    expect(await committedFiles(dir)).toEqual(['README.md']);
  });
});
