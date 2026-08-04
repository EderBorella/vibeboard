import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  changedPaths,
  filesChangedSince,
  type GitPoint,
  gitPoint,
  parseStatus,
} from '../src/server/git-measure.js';
import { tempDir } from './helpers.js';

// S11: "files-changed becomes a new RunRecord field, measured from git around each dispatch". It is a
// diagnostic the checkup reads, so the load-bearing property is that it never invents a figure — a
// project with no repository has no answer, which is not the same as an answer of zero.

const run = promisify(execFile);

async function repo(): Promise<string> {
  const root = await tempDir();
  await run('git', ['init', '-q'], { cwd: root });
  // Local identity only: a test must not depend on, or touch, the machine's git config.
  await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await run('git', ['config', 'user.name', 'Test'], { cwd: root });
  await writeFile(join(root, 'seed.txt'), 'seed\n', 'utf8');
  await run('git', ['add', '-A'], { cwd: root });
  await run('git', ['commit', '-qm', 'seed'], { cwd: root });
  return root;
}

const point = (dirty: Record<string, string>, head?: string): GitPoint => ({
  dirty,
  ...(head ? { head } : {}),
});

describe('comparing two points in a working tree', () => {
  it('counts a file that appeared', () => {
    expect(changedPaths(point({}), point({ 'a.ts': ' M' }))).toEqual(['a.ts']);
  });

  // It was committed, reverted or removed. Either way it is not the same tree.
  it('counts a file that stopped being dirty', () => {
    expect(changedPaths(point({ 'a.ts': ' M' }), point({}))).toEqual(['a.ts']);
  });

  // Comparing paths alone would miss this: the file was already listed, and only its status moved.
  it('counts a file whose status changed', () => {
    expect(changedPaths(point({ 'a.ts': ' M' }), point({ 'a.ts': 'M ' }))).toEqual(['a.ts']);
  });

  it('counts an unchanged file not at all', () => {
    expect(changedPaths(point({ 'a.ts': ' M' }), point({ 'a.ts': ' M' }))).toEqual([]);
  });

  it('counts a path in both the commit and the working tree once', () => {
    expect(changedPaths(point({}), point({ 'a.ts': ' M' }), ['a.ts'])).toEqual(['a.ts']);
  });

  it('ignores the empty line a git diff ends with', () => {
    expect(changedPaths(point({}), point({}), ['a.ts', ''])).toEqual(['a.ts']);
  });

  // VibeBoard writes the run record, its transcript and the auto-pilot state file INSIDE the window it
  // is measuring, so without this every run counted the bookkeeping done about it — and a run that
  // changed nothing scored 1, which is the reading the checkup's "high cost, nothing changed" signal
  // depends on being able to see.
  it('counts none of the writes VibeBoard makes about the run', () => {
    const after = point({
      '.vibeboard/boards/engineering/doing/E-001/results/r.md': ' M',
      '.vibeboard/autopilot-state.json': ' M',
      'src/a.ts': ' M',
    });
    expect(changedPaths(point({}), after, ['.vibeboard/runs/r.jsonl'])).toEqual(['src/a.ts']);
  });

  // The directory itself, not only its contents: `?? .vibeboard/` is what a fresh project reports.
  it('counts the .vibeboard directory itself not at all', () => {
    expect(changedPaths(point({}), point({ '.vibeboard': '??' }))).toEqual([]);
  });
});

// Parsed from git's NUL format rather than its line format, and the rename shape is the reason.
describe('reading a status', () => {
  it('keeps the status pair with the path', () => {
    expect(parseStatus('?? a.ts\0 M b.ts\0')).toEqual({ 'a.ts': '??', 'b.ts': ' M' });
  });

  // Verified against git: `-z` emits the NEW name first, then the original, as two fields. Recording
  // the new name alone is what makes a rename agree with `git diff --name-only`; the field order is
  // asserted here so a wrong reading of it fails rather than silently keying on the original.
  it('records a rename under its new name, and does not read the old one as an entry', () => {
    expect(parseStatus('R  new name.txt\0old name.txt\0 M c.ts\0')).toEqual({
      'new name.txt': 'R ',
      'c.ts': ' M',
    });
  });

  it('reads a copy the same way', () => {
    expect(parseStatus('C  copy.txt\0source.txt\0')).toEqual({ 'copy.txt': 'C ' });
  });
});

describe('measuring a real repository', () => {
  it('counts nothing when nothing happened', async () => {
    const root = await repo();
    expect(await filesChangedSince(root, await gitPoint(root))).toBe(0);
  });

  it('counts files edited during the run', async () => {
    const root = await repo();
    const before = await gitPoint(root);
    await writeFile(join(root, 'one.ts'), 'x\n', 'utf8');
    await writeFile(join(root, 'two.ts'), 'y\n', 'utf8');
    expect(await filesChangedSince(root, before)).toBe(2);
  });

  // The case a working-tree-only measure gets wrong, and the most common one: auto-pilot commits
  // before every dispatch and agents commit their own work, so a productive run often leaves a clean
  // tree behind.
  it('still counts them once the agent has committed them', async () => {
    const root = await repo();
    const before = await gitPoint(root);
    await writeFile(join(root, 'one.ts'), 'x\n', 'utf8');
    await writeFile(join(root, 'two.ts'), 'y\n', 'utf8');
    await run('git', ['add', '-A'], { cwd: root });
    await run('git', ['commit', '-qm', 'work'], { cwd: root });
    expect(await filesChangedSince(root, before)).toBe(2);
  });

  it('counts a file in a new folder', async () => {
    const root = await repo();
    const before = await gitPoint(root);
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'x\n', 'utf8');
    expect(await filesChangedSince(root, before)).toBe(1);
  });

  // `git status --porcelain` without `-uall` reports an untracked DIRECTORY as one entry, so the run
  // that matters most — a scaffold, or an agent creating a module — was the one reported as smallest.
  it('counts every file in a new folder, not the folder', async () => {
    const root = await repo();
    const before = await gitPoint(root);
    await mkdir(join(root, 'src'), { recursive: true });
    for (const name of ['a.ts', 'b.ts', 'c.ts']) {
      await writeFile(join(root, 'src', name), 'x\n', 'utf8');
    }
    expect(await filesChangedSince(root, before)).toBe(3);
  });

  // The two sources disagreed about how to spell it: status quoted `"has space.txt"`, diff did not. A
  // file that was dirty when the run began and committed before it ended arrived under both spellings
  // and was counted as two files.
  it('counts a path containing a space once when it is committed mid-run', async () => {
    const root = await repo();
    await writeFile(join(root, 'has space.txt'), 'x\n', 'utf8');
    const before = await gitPoint(root);
    expect(before?.dirty).toHaveProperty('has space.txt');
    await run('git', ['add', '-A'], { cwd: root });
    await run('git', ['commit', '-qm', 'spaced'], { cwd: root });
    expect(await filesChangedSince(root, before)).toBe(1);
  });

  // The case the old comment claimed and got backwards: status keyed the pair as `old -> new` while
  // the commit diff named `new`, so one moved file counted twice.
  it('counts a rename once when it is committed mid-run', async () => {
    const root = await repo();
    await run('git', ['mv', 'seed.txt', 'moved.txt'], { cwd: root });
    const before = await gitPoint(root);
    expect(before?.dirty).toEqual({ 'moved.txt': 'R ' });
    await run('git', ['commit', '-qm', 'moved'], { cwd: root });
    expect(await filesChangedSince(root, before)).toBe(1);
  });

  // The only place a failure here produced a wrong number rather than no number. A starting commit git
  // cannot resolve stands in for the real cause — a diff too large for the buffer.
  it('answers nothing when the commits cannot be diffed', async () => {
    const root = await repo();
    const before: GitPoint = { head: '0'.repeat(40), dirty: {} };
    await writeFile(join(root, 'one.ts'), 'x\n', 'utf8');
    await run('git', ['add', '-A'], { cwd: root });
    await run('git', ['commit', '-qm', 'work'], { cwd: root });
    expect(await filesChangedSince(root, before)).toBeUndefined();
  });

  // Absence, not zero. A project without git has not changed no files; it has no answer, and the
  // record must say so rather than claim a productive run touched nothing.
  it('answers nothing at all for a folder that is not a repository', async () => {
    const root = await tempDir();
    expect(await gitPoint(root)).toBeUndefined();
    expect(await filesChangedSince(root, undefined)).toBeUndefined();
  });

  it('answers nothing when no starting point was taken', async () => {
    const root = await repo();
    expect(await filesChangedSince(root, undefined)).toBeUndefined();
  });

  // A greenfield project's first dispatch: a repository with no commits yet. `rev-parse HEAD` fails
  // there, and the measure has to survive it rather than treat the repository as absent.
  it('works in a repository with no commits yet', async () => {
    const root = await tempDir();
    await run('git', ['init', '-q'], { cwd: root });
    const before = await gitPoint(root);
    expect(before).toEqual({ dirty: {} });
    await writeFile(join(root, 'first.ts'), 'x\n', 'utf8');
    expect(await filesChangedSince(root, before)).toBe(1);
  });
});
