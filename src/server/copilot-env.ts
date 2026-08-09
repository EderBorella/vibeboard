import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Isolate the copilot from the user's PERSONAL agent config. The copilot should run with
// only VibeBoard's own context + the project's own files — not the user's global
// ~/.claude/CLAUDE.md, ~/.config/opencode/AGENTS.md, plugins, or hooks (which make it act
// like the user's dev agent, e.g. "ask for a branch", and bloat the prompt/cost).
//
// Mechanism: point each CLI at a clean config home that VibeBoard owns.
//  - Claude: CLAUDE_CONFIG_DIR → a dir with ONLY a symlink to the real credentials.
//  - OpenCode: XDG_CONFIG_HOME → an empty dir (auth/db live in XDG_DATA_HOME, untouched).

// Exported so the sandbox suite can assert this stays writable: the profile denies the admin token
// by name rather than denying `~/.vibeboard/`, because both CLIs write their config in here.
export function copilotHome(): string {
  return process.env.VIBEBOARD_COPILOT_HOME ?? join(homedir(), '.vibeboard', 'copilot');
}

export function isolationEnabled(): boolean {
  return process.env.VIBEBOARD_COPILOT_ISOLATE !== '0';
}

// Clean Claude config dir. Only the credentials are shared in (via symlink, so token
// refresh writes through); no CLAUDE.md, plugins, or hooks come along.
export function claudeConfigDir(): string {
  const dir = join(copilotHome(), 'claude');
  mkdirSync(dir, { recursive: true });
  linkCredentials(dir);
  return dir;
}

// PER-PROJECT STATE, and why containment forces it.
//
// Both backends key their sessions by something that stops being unique inside a box, and they do it
// for unrelated reasons — which is the main argument for believing the conclusion.
//
//  - Claude stores sessions under a directory named after the WORKING DIRECTORY. On the host that is
//    the real project path, so projects separate by themselves. In a box the working directory is
//    always `/work`, so every project on the machine would land in one `-work` bucket of one shared
//    config home, and resuming a session in project A could pick up project B's.
//  - OpenCode keeps its sessions in a SQLite database in its data directory. The user's own is 265MB
//    and is also the one their personal `opencode` uses; bind-mounting it into every box would put
//    several containers and the user on one file as concurrent writers.
//
// So each project gets its own, named by a digest of its path for the same reason a box is.
export function projectStateDir(projectRoot: string): string {
  const digest = createHash('sha256').update(projectRoot).digest('hex').slice(0, 12);
  return join(copilotHome(), 'projects', digest);
}

// Claude's config home for one project. The credentials symlink is the load-bearing part: it points at
// the user's real file by ABSOLUTE path, and the box mounts that same absolute path, so the link
// resolves identically inside and out. Token refresh writes through it, which is why it is a link and
// not a copy.
export function claudeStateDir(projectRoot: string): string {
  const dir = join(projectStateDir(projectRoot), 'claude');
  mkdirSync(dir, { recursive: true });
  linkCredentials(dir);
  return dir;
}

// OpenCode's data home for one project, seeded with the credential and nothing else. `auth.json` is a
// few KB; the session database is what we are deliberately NOT sharing, and it is created fresh here.
export function opencodeStateDir(projectRoot: string): string {
  const dir = join(projectStateDir(projectRoot), 'opencode-data');
  const inner = join(dir, 'opencode');
  mkdirSync(inner, { recursive: true });
  const real = join(homedir(), '.local', 'share', 'opencode', 'auth.json');
  const seeded = join(inner, 'auth.json');
  // Copied, not linked, and only once: this is the file that must NOT appear in a Claude box, and a
  // copy per project keeps the question "which credential can this box see" answerable by looking at
  // the mounts. Re-seeded if the user logs in again is not needed — opencode rewrites it in place.
  if (existsSync(real) && !existsSync(seeded)) {
    try {
      copyFileSync(real, seeded);
    } catch {
      /* auth will fail loudly if this matters */
    }
  }
  return dir;
}

function linkCredentials(dir: string): void {
  const real = join(homedir(), '.claude', '.credentials.json');
  const link = join(dir, '.credentials.json');
  if (!existsSync(real)) return;
  try {
    symlinkSync(real, link);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      /* auth will fail loudly if this matters */
    }
  }
}

// The user's real Claude credential. Mounted into a Claude box at this same path so the symlink above
// resolves, and mounted into nothing else — that is the entire mechanism keeping OpenCode away from it.
export function claudeCredentialFile(): string {
  return join(homedir(), '.claude', '.credentials.json');
}

// Clean XDG_CONFIG_HOME for OpenCode — opencode looks in $XDG_CONFIG_HOME/opencode, which
// won't exist here, so no personal AGENTS.md/config/plugins load. Auth stays in the
// default XDG_DATA_HOME (~/.local/share/opencode).
export function opencodeConfigHome(projectRoot?: string): string {
  // Per project when containerised, for no reason of its own — it simply has to live under the one
  // directory the box mounts, alongside the data dir that genuinely must be per project.
  const dir = projectRoot
    ? join(projectStateDir(projectRoot), 'opencode-xdg')
    : join(copilotHome(), 'opencode-xdg');
  const cfgDir = join(dir, 'opencode');
  mkdirSync(cfgDir, { recursive: true });
  // Auto-approve tools. Headless there's no TTY/SSE to answer a permission prompt, so the
  // default "ask" hangs on any file edit or command (e.g. creating a card). This is the
  // serve-API equivalent of `run --auto`.
  writeFileSync(
    join(cfgDir, 'opencode.json'),
    JSON.stringify({ $schema: 'https://opencode.ai/config.json', permission: 'allow' }, null, 2),
  );
  return dir;
}
