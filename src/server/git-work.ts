import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';

// The only module that writes history, and step 10 of the tick is why it exists: committing before
// every dispatch is what makes an aborted, timed-out or plainly wrong run one command from gone.
//
// `execFile`, never a shell. The arguments here are ours, and a commit message is a line of prose that
// would otherwise be a command line — a card titled `; rm -rf ~` is a card, not an instruction. That is
// the opposite decision from `commands.ts`, deliberately: a project's gate command IS a line a person
// typed and has to reach a shell, and it earns that by coming from a file agents cannot write.
//
// Nothing here throws. The caller is a loop, and an exception would end the run instead of the step.

// A git invocation should be immediate. Ten seconds is long enough for a large `add -A` on a slow disk
// and short enough that a hung one is not something the loop waits on for ever.
const GIT_TIMEOUT_MS = 10_000;

// Plenty for `status --porcelain` on a large tree, and a bound rather than an unbounded buffer.
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

interface GitResult {
  ok: boolean;
  stdout: string;
  // What to tell the caller when it failed. Git's own message where there is one — a spawn failure
  // (no git on PATH) reports nothing on either stream, so the error's own text is the fallback.
  problem?: string;
}

function git(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
      (err, stdout, stderr) => {
        if (!err) return resolve({ ok: true, stdout });
        resolve({ ok: false, stdout, problem: stderr.trim() || err.message });
      },
    );
  });
}

export interface BranchOk {
  ok: true;
  branch: string;
  created: boolean;
}
export interface Refused {
  ok: false;
  reason: string;
}
export type BranchResult = BranchOk | Refused;

// The project root must BE the repository root. `git add -A` stages the whole repository whatever
// directory it runs from, so a project sitting inside someone else's checkout would have their
// unrelated work swept into a run's commit — and then "revert the run" reverts their work too.
//
// A monorepo package is therefore refused rather than handled. That is the honest answer for now: the
// refusal names the repository it found, so the reader can see what happened.
async function atRepoRoot(root: string): Promise<Refused | undefined> {
  const top = await git(root, ['rev-parse', '--show-toplevel']);
  if (!top.ok) {
    return { ok: false, reason: `${root} is not a git repository (${top.problem}).` };
  }
  const [found, asked] = await Promise.all([canonical(top.stdout.trim()), canonical(root)]);
  if (found === asked) return undefined;
  return {
    ok: false,
    reason: `This project is inside the git repository at ${found} rather than being its root, and auto-pilot commits the whole repository before every dispatch. Give the project its own repository first.`,
  };
}

// Symlinks, because a temp directory is one on some platforms and `--show-toplevel` answers with the
// resolved path while the caller holds the path it was given.
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

// `--show-current` rather than `rev-parse --abbrev-ref HEAD`, which fails on an unborn branch: straight
// after `git init` there is no commit, and that is the ordinary state of a project's first dispatch.
async function currentBranch(root: string): Promise<string> {
  const result = await git(root, ['branch', '--show-current']);
  return result.ok ? result.stdout.trim() : '';
}

async function isDirty(root: string): Promise<boolean> {
  const result = await git(root, ['status', '--porcelain']);
  return result.ok && result.stdout.trim() !== '';
}

async function branchExists(root: string, name: string): Promise<boolean> {
  return (await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])).ok;
}

export async function ensureBranch(root: string, name: string): Promise<BranchResult> {
  const notRoot = await atRepoRoot(root);
  if (notRoot) return notRoot;

  // Already there: nothing to switch, so nothing to refuse. A dirty tree is fine here — the loop is
  // meant to commit it, and it is the run's own branch it would be committing onto.
  if ((await currentBranch(root)) === name) return { ok: true, branch: name, created: false };

  // Refused for CREATE as well as checkout, and creating is the dangerous one: `checkout -b` keeps the
  // working tree exactly as it is, so an uncommitted human edit silently becomes the first thing the
  // run commits, under a message saying an agent wrote it. Git itself refuses the other direction when
  // a checkout would clobber, but it happily carries work onto a new branch.
  //
  // Consequence worth knowing: a freshly scaffolded project has untracked `.vibeboard/` files, so this
  // refuses until they are committed. The refusal says so; C4's pre-flight is where that becomes part
  // of getting a project ready rather than something the loop trips over.
  if (await isDirty(root)) {
    return {
      ok: false,
      reason: `The working tree has uncommitted changes, so auto-pilot will not switch to ${name}: creating a branch carries those changes onto it, and the next thing the loop does is commit everything. Commit or stash them first.`,
    };
  }

  const exists = await branchExists(root, name);
  const switched = exists ? await git(root, ['checkout', name]) : await git(root, ['checkout', '-b', name]);
  if (!switched.ok) {
    return { ok: false, reason: `Could not check out ${name}: ${switched.problem}` };
  }
  return { ok: true, branch: name, created: !exists };
}

export interface CommitResult {
  committed: boolean;
  // Present ONLY when the commit failed. A clean tree is `{committed: false}` with no reason, and the
  // caller has to be able to tell the two apart: nothing to commit is ordinary, whereas a failure means
  // the revert guarantee this step exists for is not holding and the loop should stop rather than
  // dispatch into a tree it cannot undo.
  reason?: string;
}

export async function commitAll(root: string, message: string): Promise<CommitResult> {
  const notRoot = await atRepoRoot(root);
  if (notRoot) return { committed: false, reason: notRoot.reason };

  const staged = await git(root, ['add', '-A']);
  if (!staged.ok) return { committed: false, reason: `Could not stage the tree: ${staged.problem}` };

  // Asked BEFORE committing rather than by interpreting a failure afterwards: `git commit` on a clean
  // tree exits non-zero with a message that reads exactly like a real failure, and a caller that stopped
  // the run on it would stop every time there was nothing to save.
  //
  // `--cached` because everything is staged by now; `--quiet --exit-code` answers in the exit status.
  const changes = await git(root, ['diff', '--cached', '--quiet', '--exit-code']);
  if (changes.ok) return { committed: false };

  // `-m` and never `--allow-empty`. One commit per tick on an unchanged tree would bury the ones that
  // matter, and then "which commit was this run?" has no answer.
  const done = await git(root, ['commit', '-q', '-m', message]);
  if (!done.ok) return { committed: false, reason: `Could not commit: ${done.problem}` };
  return { committed: true };
}
