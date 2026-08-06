import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { COMMAND_TIMEOUT_MS } from '../src/server/commands.js';
import { commitAll, ensureBranch, PROBE_TIMEOUT_MS, WORK_TIMEOUT_MS } from '../src/server/git-work.js';
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
