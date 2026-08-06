import { execFile } from 'node:child_process';
import { COMMAND_TIMEOUT_MS } from './commands.js';

// The only module that writes history, and step 10 of the tick is why it exists: committing before
// every dispatch is what makes an aborted, timed-out or plainly wrong run one command from gone.
//
// `execFile`, never a shell. The arguments here are ours, and a commit message is a line of prose that
// would otherwise be a command line — a card titled `; rm -rf ~` is a card, not an instruction. That is
// the opposite decision from `commands.ts`, deliberately: a project's gate command IS a line a person
// typed and has to reach a shell, and it earns that by coming from a file agents cannot write.
//
// Nothing here throws. The caller is a loop, and an exception would end the run instead of the step.
// `execFile` validates its arguments SYNCHRONOUSLY and throws on a NUL byte, inside the promise
// executor where a rejection is indistinguishable from a bug — so the call is wrapped, and a name or
// message carrying `\0` (which a YAML double-quoted scalar can) comes back as a refusal.
//
// ONE BRANCH PER SESSION, not per run. The dirty-tree refusal below makes that the only workable
// reading: every agent leaves the tree dirty, so a per-run branch name would be refused on every tick
// after the first. `ensureBranch` is called once when auto-pilot starts; `commitAll` runs per tick.

// How long a read-only probe may take. These are `rev-parse`, `status`, `branch` — immediate on any
// tree, so a slow one means something is wrong rather than something is big.
export const PROBE_TIMEOUT_MS = 10_000;

// And how long the two commands that do work may take. `commit` RUNS THE PROJECT'S HOOKS, which is a
// project's own gate and legitimately minutes: this repository's own pre-commit hook runs three
// typechecks and the whole test suite, measured at over 13 seconds, so the probe timeout above would
// have killed every commit auto-pilot ever tried to make here. Same number as a verification gate
// (`commands.ts`) because it is the same question — how long a project's own tooling may take.
//
// KNOWN LIMIT: `execFile` signals the direct child only, so a hook killed this way can leave its own
// children running. `commands.ts` solves that with a process group, which needs `spawn` rather than
// `execFile`. Not built here because the timeout is now long enough that reaching it means something is
// genuinely stuck; the trigger to build it is the first hook seen to outlive its kill.
export const WORK_TIMEOUT_MS = COMMAND_TIMEOUT_MS;

// Plenty for `status --porcelain` on a large tree, and a bound rather than an unbounded buffer.
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

// How much of a dirty tree to quote back at the reader. Enough to recognise the files, short enough to
// stay a sentence.
const QUOTED_LINES = 5;

interface GitOptions {
  // Overridden by the caller only to narrow the environment, and by the tests to prove what happens
  // when `git` is not on PATH at all — a failure that must name git rather than blame the repository.
  env?: NodeJS.ProcessEnv;
  // For the two commands that run hooks. Tests set it small to prove the timeout is reported as one.
  timeoutMs?: number;
}

interface GitResult {
  ok: boolean;
  stdout: string;
  // What to tell the caller when it failed. Git's own message where there is one.
  problem?: string;
  // `git` could not be started at all. Kept apart from every other failure because the reason has to
  // name the missing program: reporting "not a git repository" when git is not installed sends the
  // reader to look at their project, which is the one place the fault is not.
  missing?: boolean;
}

function git(
  cwd: string,
  args: string[],
  opts: GitOptions & { timeoutMs: number } = { timeoutMs: PROBE_TIMEOUT_MS },
): Promise<GitResult> {
  return new Promise((resolve) => {
    const settle = (result: GitResult): void => resolve(result);
    try {
      execFile(
        'git',
        args,
        {
          cwd,
          timeout: opts.timeoutMs,
          maxBuffer: MAX_OUTPUT_BYTES,
          ...(opts.env ? { env: opts.env } : {}),
        },
        (err, stdout, stderr) => {
          if (!err) return settle({ ok: true, stdout });
          // A timeout arrives as a signalled kill with no message of its own, so git's silence would
          // otherwise be reported as an ordinary failure. `git commit` waiting on a hook — or on a
          // passphrase prompt that will never be answered — is the case worth naming.
          if (err.killed) {
            return settle({
              ok: false,
              stdout,
              problem: `git ${args[0]} did not finish within ${Math.round(opts.timeoutMs / 1000)}s and was stopped. A hook may be running, or waiting for input that never comes.`,
            });
          }
          const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
          settle({
            ok: false,
            stdout,
            problem: missing
              ? 'git could not be run: it is not installed, or not on PATH.'
              : stderr.trim() || err.message,
            ...(missing ? { missing: true } : {}),
          });
        },
      );
    } catch (err) {
      // Synchronous argument validation — a NUL byte in a branch name or a commit message.
      settle({ ok: false, stdout: '', problem: `git ${args[0]} could not be run: ${String(err)}` });
    }
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

// Whether this project can be committed at all.
//
// IT NEED NOT BE THE REPOSITORY ROOT (ruled 2026-08-06). An earlier version refused a project that was
// not the toplevel, on the grounds that `git add -A` stages the whole repository whatever directory it
// runs from — true of `add -A` with no pathspec, and the reason every command below is scoped to the
// project directory instead. A monorepo package is an ordinary thing to adopt, and `scaffold.ts`
// deliberately does not give one its own `.git` (that would shadow the parent), so refusing it here
// meant a working board auto-pilot would always refuse.
//
// What the scoping does NOT do is stop an agent editing something outside the project, and that is
// deliberate rather than overlooked: an agent is expected to touch only the files its card is about, and
// if one does otherwise the answer is the prompt, not a git flag. The revert guarantee is therefore
// "everything under this project directory", stated rather than implied.
//
// A SUBMODULE IS STILL REFUSED, and it is a different case: committing inside one leaves the
// superproject pointing at a commit it never recorded, so undoing the run inside the submodule does not
// undo it outside. No pathspec fixes that.
async function committableRoot(root: string, opts: GitOptions = {}): Promise<Refused | undefined> {
  const top = await git(root, ['rev-parse', '--show-toplevel'], { ...opts, timeoutMs: PROBE_TIMEOUT_MS });
  if (!top.ok) {
    // The fallback is not decoration: `problem` is optional on the type because a success carries none,
    // and a refusal whose reason is the word `undefined` is the dead end this design refuses to ship.
    const problem = top.problem ?? 'git failed without saying why.';
    return {
      ok: false,
      reason: top.missing ? problem : `${root} is not a git repository (${problem}).`,
    };
  }
  const superproject = await git(root, ['rev-parse', '--show-superproject-working-tree'], {
    ...opts,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  const parent = superproject.ok ? superproject.stdout.trim() : '';
  if (parent !== '') {
    return {
      ok: false,
      reason: `This project is a git submodule of ${parent}. Committing here would leave that repository permanently modified, so reverting a run would not undo it. Give the project its own repository first.`,
    };
  }
  return undefined;
}

// `--show-current` rather than `rev-parse --abbrev-ref HEAD`, which fails on an unborn branch: straight
// after `git init` there is no commit, and that is the ordinary state of a project's first dispatch.
//
// It prints NOTHING on a detached HEAD, which is why the answer is three-valued rather than a string: a
// detached HEAD compared as `'' === name` would make an empty branch name look like "already there" and
// return success having done nothing at all, after which every commit the loop made would be
// unreachable — the exact inverse of the guarantee this module exists for.
async function currentBranch(root: string, opts: GitOptions): Promise<string | undefined> {
  const result = await git(root, ['branch', '--show-current'], { ...opts, timeoutMs: PROBE_TIMEOUT_MS });
  if (!result.ok) return undefined;
  const name = result.stdout.trim();
  return name === '' ? undefined : name;
}

// SCOPED TO THIS PROJECT with a `.` pathspec, and every other command here is scoped the same way. Without
// it, a project inside a larger repository would report someone else's edits as its own dirty tree — and
// then commit them.
async function porcelain(root: string, opts: GitOptions): Promise<string> {
  const result = await git(root, ['status', '--porcelain', '--', '.'], {
    ...opts,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  return result.ok ? result.stdout.trim() : '';
}

async function branchExists(root: string, name: string, opts: GitOptions): Promise<boolean> {
  return (
    await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], {
      ...opts,
      timeoutMs: PROBE_TIMEOUT_MS,
    })
  ).ok;
}

const quote = (porcelain: string): string => {
  const lines = porcelain.split('\n');
  const shown = lines.slice(0, QUOTED_LINES).join('; ');
  return lines.length > QUOTED_LINES ? `${shown} (and ${lines.length - QUOTED_LINES} more)` : shown;
};

export async function ensureBranch(root: string, name: string, opts: GitOptions = {}): Promise<BranchResult> {
  // Before anything touches the repository. A name git would reject reaches `checkout` as an option or
  // a pathspec, and an EMPTY name would compare equal to a detached HEAD under the old reading.
  if (name.trim() === '') {
    return { ok: false, reason: 'Auto-pilot was asked to use a branch with no name.' };
  }
  const notCommittable = await committableRoot(root, opts);
  if (notCommittable) return notCommittable;

  // Already there: nothing to switch, so nothing to refuse. A dirty tree is FINE here and this is the
  // line that lets the loop run at all — every agent leaves the tree dirty, and it is the run's own
  // branch those changes would be committed onto.
  if ((await currentBranch(root, opts)) === name) return { ok: true, branch: name, created: false };

  // Refused for CREATE as well as checkout, and creating is the dangerous one: `checkout -b` keeps the
  // working tree exactly as it is, so an uncommitted human edit silently becomes the first thing the
  // run commits, under a message saying an agent wrote it. Git itself refuses the other direction when
  // a checkout would clobber, but it happily carries work onto a new branch.
  //
  // Consequence worth knowing: a freshly scaffolded project has untracked `.vibeboard/` files, so this
  // refuses until they are committed. The refusal says so; C4's pre-flight is where that becomes part
  // of getting a project ready rather than something the loop trips over.
  const dirty = await porcelain(root, opts);
  if (dirty !== '') {
    return {
      ok: false,
      reason: `The working tree has uncommitted changes, so auto-pilot will not switch to ${name}: creating a branch carries those changes onto it, and the next thing the loop does is commit everything. Commit or stash them first (${quote(dirty)}).`,
    };
  }

  const exists = await branchExists(root, name, opts);
  const switched = exists
    ? await git(root, ['checkout', name], { ...opts, timeoutMs: PROBE_TIMEOUT_MS })
    : await git(root, ['checkout', '-b', name], { ...opts, timeoutMs: PROBE_TIMEOUT_MS });
  if (!switched.ok) {
    return { ok: false, reason: `Could not check out ${name}: ${switched.problem}` };
  }
  return { ok: true, branch: name, created: !exists };
}

export interface CommitResult {
  committed: boolean;
  // Present ONLY when the commit failed, or when the tree holds changes git could not record. A clean
  // tree is `{committed: false}` with no reason, and the caller has to be able to tell those apart:
  // nothing to commit is ordinary, whereas either of the others means the revert guarantee this step
  // exists for is not holding and the loop should stop rather than dispatch into a tree it cannot undo.
  reason?: string;
}

// `branch` is what `ensureBranch` returned. Passing it is how a caller says "I checked": this module
// writes history, and a caller that IGNORED an `ensureBranch` refusal would otherwise commit a person's
// uncommitted work to their own branch under a message saying an agent did it. Optional, because the
// check cannot be invented here — there is no way to tell the run's branch from any other one — but the
// loop always has it, and the refusal names both branches so a mismatch is readable.
export async function commitAll(
  root: string,
  message: string,
  opts: GitOptions & { branch?: string } = {},
): Promise<CommitResult> {
  const notCommittable = await committableRoot(root, opts);
  if (notCommittable) return { committed: false, reason: notCommittable.reason };

  if (opts.branch !== undefined) {
    const here = await currentBranch(root, opts);
    if (here !== opts.branch) {
      return {
        committed: false,
        reason: `Auto-pilot is on branch ${here ?? '(a detached HEAD)'} rather than ${opts.branch}, so it will not commit: the tree may hold work that is not its own.`,
      };
    }
  }

  const work = { ...opts, timeoutMs: opts.timeoutMs ?? WORK_TIMEOUT_MS };
  const staged = await git(root, ['add', '-A', '--', '.'], work);
  if (!staged.ok) return { committed: false, reason: `Could not stage the tree: ${staged.problem}` };

  // Asked BEFORE committing rather than by interpreting a failure afterwards: `git commit` on a clean
  // tree exits non-zero with a message that reads exactly like a real failure, and a caller that stopped
  // the run on it would stop every time there was nothing to save.
  //
  // `--cached` because everything is staged by now; `--quiet --exit-code` answers in the exit status.
  const changes = await git(root, ['diff', '--cached', '--quiet', '--exit-code', '--', '.'], {
    ...opts,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  if (changes.ok) {
    // Nothing staged is not the same as nothing changed. `add -A` cannot stage a nested submodule's own
    // uncommitted edits — it records only the pointer, which has not moved — so a tree that is visibly
    // dirty can stage to nothing. Reported, because "there was nothing to save" and "your work cannot
    // be recorded" must not arrive as the same answer.
    //
    // NOT detected here, and worth saying so rather than implying otherwise: a project whose
    // `.gitignore` covers its own work has no revert guarantee either, and `status --porcelain` cannot
    // see it (ignored files are not listed). That needs a policy, not a probe.
    const left = await porcelain(root, opts);
    if (left !== '') {
      return {
        committed: false,
        reason: `The tree has changes git will not record, so this run could not be made revertable: ${quote(left)}. A nested submodule's own edits are the usual cause — commit them inside it first.`,
      };
    }
    return { committed: false };
  }

  // `-m` and never `--allow-empty`. One commit per tick on an unchanged tree would bury the ones that
  // matter, and then "which commit was this run?" has no answer. The guard that actually holds that is
  // the `diff --cached` check above — proved by planting, where `--allow-empty` alone changes nothing.
  // `-- .` on the commit as well: with a pathspec, `git commit` records only what matches it, so anything
  // staged outside this project by someone else stays staged rather than being swept into a run's commit.
  const done = await git(root, ['commit', '-q', '-m', message, '--', '.'], work);
  if (!done.ok) return { committed: false, reason: `Could not commit: ${done.problem}` };
  return { committed: true };
}
