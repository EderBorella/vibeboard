import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The user's own standing instructions live here — freely editable by the user AND the
// copilot, and injected into the copilot's system prompt every turn. Keeping it separate
// from CLAUDE.md/AGENTS.md/VIBEBOARD.md means the user can steer the models without risking
// the VibeBoard-managed conventions.
export const INSTRUCTIONS_FILE = 'INSTRUCTIONS.md';

// CLI pointer files (CLAUDE.md for Claude Code, AGENTS.md for OpenCode) that we keep pointed
// at the conventions + the user's instructions. VibeBoard-managed; the copilot is asked not
// to edit them (soft block in copilot-system-prompt.md).
export const POINTER_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;

export const INSTRUCTIONS_DOC = `# Project instructions

This file is your space to steer the copilot. Anything you write here is added to
the copilot's system prompt on **every turn**, for both backends (Claude Code and
OpenCode).

You *and* the copilot can edit this file freely — ask the copilot to update it, or
edit it yourself from the Project Control tab.

VibeBoard keeps its card conventions in \`VIBEBOARD.md\`, and \`CLAUDE.md\` / \`AGENTS.md\`
point the CLIs here. Put your own guidance in this file rather than those.

## Ideas for what to put here
- Tone / voice for card content
- A short domain glossary the copilot should know
- Conventions specific to this project
`;

// The @-imports we keep present in CLAUDE.md / AGENTS.md so both CLIs load the VibeBoard
// conventions and the user's project instructions.
const IMPORTS = ['@VIBEBOARD.md', `@${INSTRUCTIONS_FILE}`];
const POINTER_NOTE =
  'See VIBEBOARD.md for card conventions and INSTRUCTIONS.md for project-specific instructions.';

// Write (greenfield) or upgrade (brownfield/existing) a CLI pointer file so it imports both
// VIBEBOARD.md and INSTRUCTIONS.md. Greenfield writes a fresh file; otherwise we append only
// the import lines that are missing, never touching the user's existing content.
export async function ensurePointerFile(
  projectRoot: string,
  filename: string,
  name: string,
  greenfield: boolean,
): Promise<void> {
  const path = join(projectRoot, filename);
  let existing = '';
  try {
    existing = await readFile(path, 'utf8');
  } catch {
    /* no existing file */
  }
  if (greenfield && existing === '') {
    await writeFile(path, `# ${name}\n\n${IMPORTS.join('\n')}\n\n${POINTER_NOTE}\n`, 'utf8');
    return;
  }
  const missing = IMPORTS.filter((imp) => !existing.includes(imp));
  if (missing.length === 0) return;
  const sep = existing.endsWith('\n') || existing === '' ? '' : '\n';
  await writeFile(path, `${existing}${sep}\n${missing.join('\n')}\n`, 'utf8');
}

// Bring an existing (possibly older) project up to the current control-file contract:
// create INSTRUCTIONS.md if missing and ensure both pointer files import it + VIBEBOARD.md.
// Idempotent; called on every project open (mirrors ensureBoards for config).
export async function ensureControlFiles(projectRoot: string): Promise<void> {
  const insPath = join(projectRoot, INSTRUCTIONS_FILE);
  try {
    await readFile(insPath, 'utf8');
  } catch {
    await writeFile(insPath, INSTRUCTIONS_DOC, 'utf8');
  }
  for (const filename of POINTER_FILES) {
    await ensurePointerFile(projectRoot, filename, '', false);
  }
}
