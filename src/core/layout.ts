// Where everything a VibeBoard project owns lives on disk. ONE home for the layout, because it was
// previously spread across nine modules — config.ts, board.ts, run-store.ts, chat-store.ts,
// control-files.ts, skill-catalogue.ts, seed-skills.ts, control.ts and agent-turn.ts — several of
// which had their own copy of the same literal. `SKILLS_DIR` was defined twice with identical text.
//
// Everything below is a project-root-relative POSIX path. Callers join it onto the root themselves;
// this module never touches the filesystem, which is what makes it safe to import anywhere.
//
// ## The shape
//
//   <project>/
//   ├── CLAUDE.md          ← MUST stay at the root: this is how Claude Code finds anything at all
//   ├── AGENTS.md          ← MUST stay at the root: same, for OpenCode
//   └── .vibeboard/
//       ├── VIBEBOARD.md       card conventions, imported by both pointer files
//       ├── INSTRUCTIONS.md    the user's standing instructions, injected every turn
//       ├── config.yaml
//       ├── resources.yaml     the links registry
//       ├── boards/<board>/<column>/<CARD>.md
//       ├── skills/<slug>/SKILL.md
//       ├── docs/
//       ├── resources/
//       ├── chat/              copilot transcripts (machine state)
//       └── runs/              run transcripts and reports (machine state)
//
// The two pointer files at the root are not a compromise we chose; both CLIs auto-discover them by
// name in the working directory and would otherwise read nothing. They are pointers only: their
// content is `@`-imports of the two documents inside the folder.

export const CONFIG_DIR = '.vibeboard';
export const CONFIG_FILE = 'config.yaml';

// Card content. Under a `boards/` level rather than directly in the folder so that `.vibeboard/`
// means one thing per child: boards/, docs/, resources/ and skills/ are content, chat/ and runs/ are
// machine state. Reversing this decision is this one constant.
export const BOARDS_DIR = `${CONFIG_DIR}/boards`;

export const SKILLS_DIR = `${CONFIG_DIR}/skills`;
export const DOCS_DIR = `${CONFIG_DIR}/docs`;
export const RESOURCES_DIR = `${CONFIG_DIR}/resources`;
export const RESOURCES_YAML = `${CONFIG_DIR}/resources.yaml`;
export const CHAT_DIR = `${CONFIG_DIR}/chat`;
export const RUNS_DIR = `${CONFIG_DIR}/runs`;
// The implementation diary: one line per event, appended through an endpoint rather than written
// by an agent.
export const PROJECT_LOG_FILE = `${CONFIG_DIR}/PROJECT-LOG.md`;

// The two documents that moved inside. Their names are unchanged, so the pointer files' imports read
// `@.vibeboard/VIBEBOARD.md` — an import may carry a path, which is what makes the move possible.
export const CONVENTIONS_FILE = `${CONFIG_DIR}/VIBEBOARD.md`;
export const INSTRUCTIONS_FILE = `${CONFIG_DIR}/INSTRUCTIONS.md`;

// Auto-discovered by the CLIs at the project root, and therefore immovable.
export const POINTER_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;

// Inside a board, not inside the config folder: a column is a folder, and these two are columns'
// peers. `archive/` holds soft-deleted cards; `results/` holds run records beside the card they
// belong to, which is why a record refreshes the board and a transcript does not.
export const ARCHIVE_SLUG = 'archive';
export const RESULTS_DIR = 'results';

// A board's folder, or a column inside it. Every caller that used to write
// `join(projectRoot, board, slug)` goes through here instead.
export function boardRel(board: string, ...rest: string[]): string {
  return [BOARDS_DIR, board, ...rest].join('/');
}

// A skill's folder, or the SKILL.md inside it.
export function skillRel(slug: string, ...rest: string[]): string {
  return [SKILLS_DIR, slug, ...rest].join('/');
}
