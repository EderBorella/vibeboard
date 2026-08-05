import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { commitAll, ensureBranch } from '../src/server/git-work.js';
import { tempDir } from './helpers.js';

const exec = promisify(execFile);

const git = (cwd: string, args: string[]): Promise<{ stdout: string }> => exec('git', args, { cwd });

// A real repository, with its identity set LOCALLY so nothing here depends on the machine's git config
// — and signing off, because a machine that signs every commit would fail every test in this file for a
// reason that has nothing to do with the code.
async function repo(): Promise<string> {
  const dir = await tempDir();
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'test@example.invalid']);
  await git(dir, ['config', 'user.name', 'VibeBoard Test']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
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

  it('refuses when there is no repository, rather than throwing', async () => {
    const dir = await tempDir();
    const result = await ensureBranch(dir, 'autopilot/run-1');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/not a git repository/i);
  });

  // `git add -A` stages the whole repository, not the directory it is run from. Committing from a
  // subdirectory of someone else's repository would sweep their unrelated work into a run's commit.
  it('refuses when the project is a subdirectory of a repository rather than its root', async () => {
    const outer = await committed(await repo());
    const inner = join(outer, 'packages', 'thing');
    await mkdir(inner, { recursive: true });
    const result = await ensureBranch(inner, 'autopilot/run-1');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain(outer);
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
});
