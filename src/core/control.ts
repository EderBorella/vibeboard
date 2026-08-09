import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CONVENTIONS_FILE, INSTRUCTIONS_FILE, POINTER_FILES } from './layout.js';
import { seedDocs } from './seed-docs.js';
import { seedSkills } from './seed-skills.js';

// The user's standing instructions and the CLI pointer files that lead to them. The instructions
// are freely editable by the user AND the copilot, and injected into the copilot's system prompt
// every turn; keeping them separate from the pointer files and the conventions means the user can
// steer the models without risking anything VibeBoard manages.

export const INSTRUCTIONS_DOC = `# Project instructions

This file is your space to steer the copilot. Anything you write here is added to
the copilot's system prompt on **every turn**, for both backends (Claude Code and
OpenCode).

You *and* the copilot can edit this file freely — ask the copilot to update it, or
edit it yourself from the Project Control tab.

VibeBoard keeps its card conventions in \`${CONVENTIONS_FILE}\`, and \`CLAUDE.md\` /
\`AGENTS.md\` at the project root point the CLIs here. Put your own guidance in this
file rather than those.

## Ideas for what to put here
- Tone / voice for card content
- A short domain glossary the copilot should know
- Conventions specific to this project
`;

// The @-imports we keep present in CLAUDE.md / AGENTS.md so both CLIs load the VibeBoard
// conventions and the user's project instructions. An import may carry a path, which is what
// lets both documents live inside `.vibeboard/` while the pointer files stay at the root.
// Only Claude Code expands these. OpenCode reads AGENTS.md and injects the bytes verbatim — its
// `@file` handling is wired to prompts and command templates, not to instruction files — so for that
// backend the import lines are inert and POINTER_NOTE below is what actually carries the two paths.
// Both files get the same body regardless: nothing here is untrue for either CLI, and VibeBoard's own
// copilot never depends on it, because agent-turn.ts injects both documents into the system prompt on
// every turn for both backends.
const IMPORTS = [`@${CONVENTIONS_FILE}`, `@${INSTRUCTIONS_FILE}`];
const POINTER_NOTE = `See ${CONVENTIONS_FILE} for card conventions and ${INSTRUCTIONS_FILE} for project-specific instructions.`;

// Write (greenfield) or upgrade (brownfield/existing) a CLI pointer file so it imports both
// documents. Greenfield writes a fresh file; otherwise we append only the import lines that are
// missing, never touching the user's existing content.
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

// Bring an existing (possibly older) project up to the current control-file contract: create the
// instructions document if missing and ensure both pointer files import it + the conventions.
// Idempotent; called on every project open (mirrors ensureBoards for config).
export async function ensureControlFiles(projectRoot: string): Promise<void> {
  const insPath = join(projectRoot, INSTRUCTIONS_FILE);
  try {
    await readFile(insPath, 'utf8');
  } catch {
    // The document lives in a folder now, not at the root, so its parent may not be there yet.
    await mkdir(dirname(insPath), { recursive: true });
    await writeFile(insPath, INSTRUCTIONS_DOC, 'utf8');
  }
  for (const filename of POINTER_FILES) {
    await ensurePointerFile(projectRoot, filename, '', false);
  }
  // Skills for a project that predates them. Guarded inside: an existing skills folder is left
  // alone, so a skill the user deleted never comes back.
  await seedSkills(projectRoot);
  // And the documents an agent gets pointed at. Same reasoning, guarded per file rather than per
  // folder — the docs folder holds the user's own writing too.
  await seedDocs(projectRoot);
}
