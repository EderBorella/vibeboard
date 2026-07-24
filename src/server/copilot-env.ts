import { mkdirSync, symlinkSync, existsSync, writeFileSync } from 'node:fs';
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

function copilotHome(): string {
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
  const real = join(homedir(), '.claude', '.credentials.json');
  const link = join(dir, '.credentials.json');
  if (existsSync(real)) {
    try { symlinkSync(real, link); } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') { /* auth will fail loudly if this matters */ }
    }
  }
  return dir;
}

// Clean XDG_CONFIG_HOME for OpenCode — opencode looks in $XDG_CONFIG_HOME/opencode, which
// won't exist here, so no personal AGENTS.md/config/plugins load. Auth stays in the
// default XDG_DATA_HOME (~/.local/share/opencode).
export function opencodeConfigHome(): string {
  const dir = join(copilotHome(), 'opencode-xdg');
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
