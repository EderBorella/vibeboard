import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG_DIR } from '../core/layout.js';

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

// `XY path`, NUL-terminated. The status pair matters as well as the path: a file that goes from
// modified to staged has changed since the point was taken, and comparing paths alone would miss it.
//
// `-z` rather than lines, because the line format QUOTES a path containing a space (`?? "has
// space.txt"`) while `git diff --name-only` does not — so the same file arrived under two spellings
// and was counted twice. NUL-separated output is never quoted, on either side.
export function parseStatus(stdout: string): Record<string, string> {
  const dirty: Record<string, string> = {};
  const fields = stdout.split('\0');
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i];
    if (entry === undefined || entry.length < 4) continue;
    const status = entry.slice(0, 2);
    dirty[entry.slice(3)] = status;
    // A rename or copy spends a SECOND field on the original path — `R  new\0old\0`, verified against
    // git rather than assumed. Recording only the new name is what makes this agree with
    // `git diff --name-only`, which reports the new name alone: keying the pair as one `old -> new`
    // string made a committed rename two different keys and counted one file as two.
    if (status.includes('R') || status.includes('C')) i += 1;
  }
  return dirty;
}

export async function gitPoint(root: string): Promise<GitPoint | undefined> {
  // `-uall`, because the default collapses an untracked DIRECTORY to one entry (`?? src/`). A run
  // that scaffolds two hundred files scored 1 — the exact opposite of the signal this field exists
  // to carry, and in the direction that hides a busy run rather than an idle one.
  const status = await git(root, ['status', '--porcelain', '-z', '-uall']);
  if (status === undefined) return undefined;
  const head = await git(root, ['rev-parse', 'HEAD']);
  return {
    ...(head?.trim() ? { head: head.trim() } : {}),
    dirty: parseStatus(status),
  };
}

// VibeBoard's own writes are not the agent's work. The run record, its transcript and the auto-pilot
// state file all land under `.vibeboard/` BETWEEN the two points — the starting point is taken before
// the record is written (agent-runner.ts) — and nothing writes a `.gitignore`, so every measured run
// counted at least the bookkeeping VibeBoard did about it. With auto-pilot committing before each
// dispatch the tree starts clean, so a run that changed nothing scored 1 and the checkup's "high cost,
// nothing changed" signal could never fire.
//
// MATCHED AT ANY DEPTH, not only at the start, and that is the correction a review had to make (2026-08-06).
// Git prints paths relative to the REPOSITORY TOPLEVEL whatever directory it ran in, while these two clauses
// were written against a project-root-relative path — the same string only while a project IS the toplevel,
// which was guaranteed until the repo-root requirement was dropped. In a subdirectory project every path
// arrives as `packages/proj/.vibeboard/...`, so the exclusion matched nothing: EVERY run then counted the run
// record and the transcript VibeBoard wrote about it, `filesChanged` was never 0, and both things that read it
// went quiet — the empty-run refusal (which requires 0) and the checkup's "high cost, nothing changed" signal.
// Reproduced with a real monorepo before it was believed.
function isOwnBookkeeping(path: string): boolean {
  return (
    path === CONFIG_DIR ||
    path.startsWith(`${CONFIG_DIR}/`) ||
    path.endsWith(`/${CONFIG_DIR}`) ||
    path.includes(`/${CONFIG_DIR}/`)
  );
}

// Every path that differs between the two points, plus everything committed in between.
//
// The commits matter as much as the working tree: auto-pilot commits before every dispatch (loop step
// 10) and agents commit their own work, so by the time a run settles its changes are often already in
// a commit and a working-tree-only measure would report 0 for the most productive runs.
//
// Pure, so the comparison is testable without a repository. A rename appears once, under its new name
// on both sides — see parseStatus for why that is what makes the two sources agree.
//
// The exclusion is applied HERE, to the finished set, rather than at each of the three sources: one
// statement, and `GitPoint` stays a faithful record of what git actually said.
export function changedPaths(before: GitPoint, after: GitPoint, committed: string[] = []): string[] {
  const paths = new Set<string>(committed.filter((p) => p !== ''));
  for (const [path, status] of Object.entries(after.dirty)) {
    if (before.dirty[path] !== status) paths.add(path);
  }
  // A path that WAS dirty and is not any more also changed — it was committed, reverted or removed.
  for (const path of Object.keys(before.dirty)) {
    if (after.dirty[path] === undefined) paths.add(path);
  }
  return [...paths].filter((path) => !isOwnBookkeeping(path));
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
    const diff = await git(root, ['diff', '--name-only', '-z', before.head, after.head]);
    // The one place a failure here used to produce a WRONG number rather than no number: a diff too
    // large for the buffer, or a commit that has since gone away, left `committed` empty and the run
    // was reported as having changed only its working tree. No answer is the honest answer.
    if (diff === undefined) return undefined;
    committed = diff.split('\0');
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
