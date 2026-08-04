import { execFile, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { BOARDS_DIR } from '../src/core/layout.js';
import { scaffoldProject } from '../src/core/scaffold.js';
import { copilotHome } from '../src/server/copilot-env.js';
import { NOT_REQUESTED, probeSandbox, SANDBOX_PROFILE, wrapCommand } from '../src/server/sandbox.js';
import { sh, tempDir } from './helpers.js';

describe('wrapCommand', () => {
  it('leaves the command untouched when there is no sandbox', () => {
    expect(wrapCommand('claude', ['-p'], NOT_REQUESTED)).toEqual({ bin: 'claude', args: ['-p'] });
  });

  it('routes the command through the profile when there is one', () => {
    // Exact array, not `toContain`: the ORDER is the behaviour. `aa-exec -- claude -p
    // vibeboard-agent` would satisfy a containment check and confine nothing.
    expect(wrapCommand('claude', ['-p', '--verbose'], { ok: true, profile: SANDBOX_PROFILE })).toEqual({
      bin: 'aa-exec',
      args: ['-p', SANDBOX_PROFILE, '--', 'claude', '-p', '--verbose'],
    });
  });
});

// The tests that matter. Skipped rather than failed where the profile is not installed, because a
// contributor on a Mac must still be able to run the suite — but the suite must say so out loud
// rather than reporting a silent green.
const here = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
const live = await probeSandbox();
// Sampled before anything runs: the credential test asserts this suite does not bring the real
// token into existence, and it can only do that if it knows the answer from before.
const realTokenExisted = existsSync(join(homedir(), '.vibeboard', 'token'));
if (!live.ok) console.warn(`\n  ⚠ sandbox tests SKIPPED: ${live.reason}\n`);

describe.skipIf(!live.ok)('the profile denies what it claims to', () => {
  it('refuses a direct write to a card, and still allows one to the project', async () => {
    const root = await tempDir();
    const column = join(root, BOARDS_DIR, 'engineering', 'backlog');
    await mkdir(column, { recursive: true });
    const card = join(column, 'E-001.md');
    await writeFile(card, 'original', 'utf8');

    const denied = await sh(live, `printf pwned > '${card}'`);
    expect(denied.code).not.toBe(0);
    // The file is the assertion, not the exit code alone: a shell can fail for reasons that have
    // nothing to do with the policy.
    expect(await readFile(card, 'utf8')).toBe('original');

    // The other half. A sandbox that denies everything is not a sandbox, it is a broken spawn —
    // and every assertion above would pass just as well.
    const allowed = await sh(live, `printf ok > '${join(root, 'index.ts')}'`);
    expect(allowed.code).toBe(0);
    expect(await readFile(join(root, 'index.ts'), 'utf8')).toBe('ok');
  });

  it('refuses to write config, skills and foundation documents', async () => {
    const root = await tempDir();
    await mkdir(join(root, '.vibeboard', 'skills', 'implement'), { recursive: true });
    await mkdir(join(root, '.vibeboard', 'foundation'), { recursive: true });
    for (const path of [
      join(root, '.vibeboard', 'config.yaml'),
      join(root, '.vibeboard', 'skills', 'implement', 'SKILL.md'),
      join(root, '.vibeboard', 'foundation', 'CODE-QUALITY.md'),
      join(root, '.vibeboard', 'PROJECT-LOG.md'),
      join(root, '.vibeboard', 'INSTRUCTIONS.md'),
      join(root, '.vibeboard', 'VIBEBOARD.md'),
    ]) {
      expect((await sh(live, `printf pwned > '${path}'`)).code, path).not.toBe(0);
    }
  });

  it('refuses to move a governance folder out from under its own rules', async () => {
    // The bypass the container denies exist for. Both of these were allowed until review: the deny
    // named the contents, and moving the folder renamed every path out of the policy.
    const root = await tempDir();
    await mkdir(join(root, BOARDS_DIR), { recursive: true });
    expect((await sh(live, `mv '${join(root, BOARDS_DIR)}' '${join(root, 'stolen')}'`)).code).not.toBe(0);
    expect((await sh(live, `mv '${join(root, '.vibeboard')}' '${join(root, 'vb2')}'`)).code).not.toBe(0);
    // Still where it was, under the name the rules know.
    expect(existsSync(join(root, BOARDS_DIR))).toBe(true);
  });

  it('refuses to write a git hook or repoint hooksPath, and still allows a commit', async () => {
    // The repo is created UNCONFINED, because that is what happens: scaffoldProject runs `git init`
    // as VibeBoard, before any agent exists. Doing it inside the sandbox would test a sequence that
    // never occurs — and it fails there, since `git init` writes `.git/config`, which is denied.
    const root = await tempDir();
    await scaffoldProject(root, { name: 'G', mode: 'brownfield', today: '2026-08-02' });
    await run('git', ['config', 'user.email', 't@t'], { cwd: root });
    await run('git', ['config', 'user.name', 't'], { cwd: root });

    // A hook is code VibeBoard later runs as itself, outside the profile.
    expect((await sh(live, `printf x > '${join(root, '.git', 'hooks', 'pre-commit')}'`)).code).not.toBe(0);
    // And the other way to the same place. Denying only `hooks/` would leave this open.
    expect((await sh(live, `cd '${root}' && git config core.hooksPath /tmp/evil`)).code).not.toBe(0);

    // The half that matters just as much: a profile that also blocked committing would have broken
    // the feature it is protecting. Branch and second commit included — a first commit into an
    // empty repo touches fewer paths than everyday work does.
    const commit = await sh(
      live,
      `cd '${root}' && printf hi > a.md && git add -A && git commit -qm first && git checkout -q -b feat && printf more >> a.md && git commit -qam second`,
    );
    expect(commit.code, commit.stderr).toBe(0);
  });

  it('confines a GRANDCHILD, not just the shell it starts', async () => {
    // Every other denial here is attempted with a shell builtin — a redirect — so the confined
    // process is `sh` itself and nothing crosses an exec. This one writes with /usr/bin/tee, so it
    // only passes if confinement survives into a separately exec'd binary. That is what
    // `allow pix /** -> &vibeboard-agent` buys, and it is the difference between confining an
    // agent and confining the first process an agent starts: its bash tool execs everything.
    const root = await tempDir();
    const column = join(root, BOARDS_DIR, 'engineering', 'backlog');
    await mkdir(column, { recursive: true });
    const card = join(column, 'E-001.md');
    await writeFile(card, 'original', 'utf8');

    const denied = await sh(live, `echo pwned | /usr/bin/tee '${card}'`);
    expect(denied.code).not.toBe(0);
    expect(await readFile(card, 'utf8')).toBe('original');

    // And the grandchild says so itself, so a failure above cannot be mistaken for tee missing.
    const who = await sh(live, '/usr/bin/cat /proc/self/attr/current > /dev/null');
    expect(who.code).toBe(0);
  });

  it('refuses to move .git out from under its own rules', async () => {
    // The escape, end to end, exactly as it was reproduced in review: the hook deny was in place
    // and the CONTAINER was not, so renaming .git and symlinking it back put the hooks directory
    // at a path no rule matched — and VibeBoard's own commit then ran the agent's script,
    // unconfined, as the server.
    const root = await tempDir();
    await scaffoldProject(root, { name: 'E', mode: 'brownfield', today: '2026-08-02' });
    const stolen = join(await tempDir(), 'stolen-git');
    expect((await sh(live, `mv '${join(root, '.git')}' '${stolen}'`)).code).not.toBe(0);
    expect(existsSync(join(root, '.git', 'hooks'))).toBe(true);
  });

  it("refuses to write git's global config, which needs no rename at all", async () => {
    // `git config --global core.hooksPath /tmp/evil` made every later commit VibeBoard performs,
    // in ANY repository, run the agent's script. Probed on a path matching the deny, never the
    // real file — a test that writes ~/.gitconfig to prove it cannot is a test that broke your git.
    const probe = join(homedir(), '.gitconfig');
    expect((await sh(live, `printf '[core]\n' >> '${probe}'`)).code).not.toBe(0);
    expect((await sh(live, `printf x > '${join(homedir(), '.config', 'git', 'config')}'`)).code).not.toBe(0);
  });

  it('refuses to file a suggestion by writing the file', async () => {
    // The endpoint stamps the run and the card from the credential; the file path would skip that,
    // and would also let a run mark its own finding dismissed.
    const root = await tempDir();
    await mkdir(join(root, '.vibeboard', 'suggestions'), { recursive: true });
    expect(
      (await sh(live, `printf 'state: dismissed' > '${join(root, '.vibeboard', 'suggestions', 's1.md')}'`))
        .code,
    ).not.toBe(0);
  });

  // Slice D added two authority files under `.vibeboard/` and neither was denied until review. Both
  // are live probes rather than policy assertions, because the compiled-policy check below cannot see
  // whether the kernel actually refuses.
  it('refuses to forge a project-run record, which would aim the reaper', async () => {
    // `markInterrupted` reaps the pgid/pgstart of every stale in-flight record, and both can be read
    // out of /proc for any group on the machine — so this file is a way to make the unconfined server
    // kill a process it never spawned.
    const root = await tempDir();
    await mkdir(join(root, '.vibeboard', 'project-runs'), { recursive: true });
    const forged = join(root, '.vibeboard', 'project-runs', '20260803-120000-aaaa.md');
    expect((await sh(live, `printf 'status: running' > '${forged}'`)).code).not.toBe(0);
  });

  it('refuses to write auto-pilot’s state, which would un-halt the project', async () => {
    // Every refusal in the server reads the halt back out of this file. An agent that can write it can
    // undo the emergency stop that was aimed at it, and zero the iteration counter with it.
    const root = await tempDir();
    await mkdir(join(root, '.vibeboard'), { recursive: true });
    const state = join(root, '.vibeboard', 'autopilot-state.json');
    expect((await sh(live, `printf '{"state":"idle"}' > '${state}'`)).code).not.toBe(0);
  });

  it('refuses to read the admin credential', async () => {
    // A PROBE file, never `~/.vibeboard/token` itself. The deny is `token*`, so this path is covered
    // by exactly the same rule — but an earlier version wrote to the real path, and on a machine
    // where VibeBoard had not started yet that CREATED the admin credential, with a value published
    // in this repository. `adminToken()` would then have read it and kept it.
    const probe = join(homedir(), '.vibeboard', `token-sandbox-probe-${process.pid}`);
    await mkdir(join(homedir(), '.vibeboard'), { recursive: true });
    // Written first: a deny and a missing file both fail, and only one of them is a control.
    await writeFile(probe, randomBytes(16).toString('hex'), 'utf8');
    try {
      expect((await sh(live, `cat '${probe}'`)).code).not.toBe(0);
      // And the real one is still whatever it was — this test does not bring it into existence.
      expect(existsSync(join(homedir(), '.vibeboard', 'token'))).toBe(realTokenExisted);
    } finally {
      await rm(probe, { force: true });
    }
  });

  it('still allows the CLIs their own isolated config home', async () => {
    // The deny above names the token, not the folder, because ~/.vibeboard/copilot is where both
    // backends keep their config. Widening it to the folder is the plausible-looking hardening
    // that silently breaks every run on both backends, so it is pinned here.
    const probe = join(copilotHome(), `.sandbox-probe-${process.pid}`);
    try {
      expect((await sh(live, `printf ok > '${probe}'`)).code).toBe(0);
    } finally {
      await rm(probe, { force: true });
    }
  });
});

// The profile as the KERNEL will read it, not as it looks in the file. This is the check that would
// have caught the original hole: `deny .../boards/** w` compiles to a pattern needing at least one
// character after the slash, so it said nothing about the directory itself — and
// `mv .vibeboard/boards /tmp/x && ln -s /tmp/x .vibeboard/boards` left every card writable under a
// path no rule matched. A glob cannot be reviewed by reading it.
const PROFILE = join(here, '..', 'tools', 'apparmor', 'vibeboard-agent');

function denyPatterns(): RegExp[] {
  // Both streams: `-D rule-exprs` writes the compiled expressions to STDERR, and reading only
  // stdout silently yields an empty list — every "is this denied?" assertion then answers no, which
  // is the failure mode this whole suite exists to avoid.
  const run = spawnSync('apparmor_parser', ['-Q', '--skip-cache', '-D', 'rule-exprs', PROFILE], {
    encoding: 'utf8',
  });
  const out = `${run.stdout}${run.stderr}`;
  expect(out, 'apparmor_parser produced no rule expressions').toContain('rule:');
  return out
    .split('\n')
    .filter((line) => line.startsWith('rule:') && line.includes(' deny '))
    .map((line) => line.slice('rule:'.length, line.indexOf(' deny ')).trim().split('  ->  ')[0])
    .map((expr) => new RegExp(`^${expr.replaceAll('\\x00', '\\0')}$`));
}

const parserPresent = (() => {
  try {
    return spawnSync('apparmor_parser', ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
})();

describe.skipIf(!parserPresent)('the compiled policy, not the globs', () => {
  const denied = (path: string): boolean => denyPatterns().some((re) => re.test(path));

  it.each([
    ['a card', '/w/proj/.vibeboard/boards/engineering/backlog/E-001.md'],
    ['the boards folder itself', '/w/proj/.vibeboard/boards'],
    ['the skills folder itself', '/w/proj/.vibeboard/skills'],
    ['the foundation folder itself', '/w/proj/.vibeboard/foundation'],
    ['the project cockpit folder itself', '/w/proj/.vibeboard'],
    ['the config', '/w/proj/.vibeboard/config.yaml'],
    ['the instructions injected into every turn', '/w/proj/.vibeboard/INSTRUCTIONS.md'],
    ['the card conventions both pointer files import', '/w/proj/.vibeboard/VIBEBOARD.md'],
    ['the diary', '/w/proj/.vibeboard/PROJECT-LOG.md'],
    ['a project run record', '/w/proj/.vibeboard/project-runs/20260803-120000-aaaa.md'],
    ['the project-runs folder itself', '/w/proj/.vibeboard/project-runs'],
    ['auto-pilot’s state', '/w/proj/.vibeboard/autopilot-state.json'],
    ['a suggestion', '/w/proj/.vibeboard/suggestions/s1.md'],
    ['the suggestions folder itself', '/w/proj/.vibeboard/suggestions'],
    ['a chat transcript', '/w/proj/.vibeboard/chat/c1.json'],
    ['a git hook', '/w/proj/.git/hooks/pre-commit'],
    ['the git config', '/w/proj/.git/config'],
    ['the .git folder itself, which was renameable', '/w/proj/.git'],
    ["a submodule's hooks", '/w/proj/.git/modules/sub/hooks/pre-commit'],
    ["a submodule's config", '/w/proj/.git/modules/sub/config'],
    ['the per-worktree config', '/w/proj/.git/config.worktree'],
    ["git's global config", '/home/someone/.gitconfig'],
    ["git's XDG config", '/home/someone/.config/git/config'],
    ['the admin token', '/home/someone/.vibeboard/token'],
    ['the folder holding the admin token', '/home/someone/.vibeboard'],
  ])('covers %s', (_what, path) => {
    expect(denied(path)).toBe(true);
  });

  it.each([
    ['project source', '/w/proj/src/index.ts'],
    ['a new top-level file', '/w/proj/package.json'],
    ['the run staging area', '/w/proj/.vibeboard/runs/r1.report.md'],
    ['the repository itself', '/w/proj/.git/objects/ab/cdef'],
    ['the git index', '/w/proj/.git/index'],
    ['a ref, so a commit can move a branch', '/w/proj/.git/refs/heads/main'],
    ["the CLIs' own config home", '/home/someone/.vibeboard/copilot/claude/settings.json'],
  ])('leaves %s alone', (_what, path) => {
    // The other half, and the one a careless hardening breaks: `runs/` is deliberately writable, and
    // the copilot home MUST be, or every run on both backends dies.
    expect(denied(path)).toBe(false);
  });
});
