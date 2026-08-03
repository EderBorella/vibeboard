import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// How many files a run changed, measured from git around the dispatch (S11).
//
// The number is a DIAGNOSTIC — the checkup reads it alongside turns, duration and cost to spot a run
// that spent a lot and did little. So it must never fail a run, and it must never invent a figure:
// a project with no git repository has not "changed no files", it has no answer, and `undefined` is
// how that is said.

// What the working tree looked like at one moment: the commit it was on, and every path git considers
// dirty with the status it gave. `head` is absent in a repository with no commits yet, which is an
// ordinary state for a greenfield project on its first dispatch.
export interface GitPoint {
  head?: string;
  dirty: Record<string, string>;
}

async function git(root: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', args, { cwd: root, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch {
    // Not a repository, no git on PATH, or a repository we may not read. All three mean "no answer".
    return undefined;
  }
}

// `XY path` per line. The status pair matters as well as the path: a file that goes from modified to
// staged has changed since the point was taken, and comparing paths alone would miss it.
function parseStatus(stdout: string): Record<string, string> {
  const dirty: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    if (line.length < 4) continue;
    dirty[line.slice(3)] = line.slice(0, 2);
  }
  return dirty;
}

export async function gitPoint(root: string): Promise<GitPoint | undefined> {
  const status = await git(root, ['status', '--porcelain']);
  if (status === undefined) return undefined;
  const head = await git(root, ['rev-parse', 'HEAD']);
  return {
    ...(head?.trim() ? { head: head.trim() } : {}),
    dirty: parseStatus(status),
  };
}

// Every path that differs between the two points, plus everything committed in between.
//
// The commits matter as much as the working tree: auto-pilot commits before every dispatch (loop step
// 10) and agents commit their own work, so by the time a run settles its changes are often already in
// a commit and a working-tree-only measure would report 0 for the most productive runs.
//
// Pure, so the comparison is testable without a repository. A rename appears once, as the single
// `old -> new` entry git reports — counting it as two files would overstate the work.
export function changedPaths(before: GitPoint, after: GitPoint, committed: string[] = []): string[] {
  const paths = new Set<string>(committed.filter((p) => p !== ''));
  for (const [path, status] of Object.entries(after.dirty)) {
    if (before.dirty[path] !== status) paths.add(path);
  }
  // A path that WAS dirty and is not any more also changed — it was committed, reverted or removed.
  for (const path of Object.keys(before.dirty)) {
    if (after.dirty[path] === undefined) paths.add(path);
  }
  return [...paths];
}

// `undefined` when there is nothing to compare: no starting point was taken, or the repository has
// gone away since. Never 0 in those cases — absence and zero are different facts.
export async function filesChangedSince(
  root: string,
  before: GitPoint | undefined,
): Promise<number | undefined> {
  if (!before) return undefined;
  const after = await gitPoint(root);
  if (!after) return undefined;
  let committed: string[] = [];
  if (before.head && after.head && before.head !== after.head) {
    const diff = await git(root, ['diff', '--name-only', before.head, after.head]);
    committed = (diff ?? '').split('\n').map((p) => p.trim());
  }
  return changedPaths(before, after, committed).length;
}

// The two calls the runner makes, gathered so a test can pass its own pair and neither need git nor
// pay for it. The default is the real thing.
export interface GitMeasure {
  point: (root: string) => Promise<GitPoint | undefined>;
  changedSince: (root: string, before: GitPoint | undefined) => Promise<number | undefined>;
}

export const REAL_GIT: GitMeasure = { point: gitPoint, changedSince: filesChangedSince };
