import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { entryBlock } from '../../core/diary.js';
import {
  ARCHIVE_SLUG,
  BOARDS_DIR,
  boardRel,
  CONFIG_DIR,
  CONVENTIONS_FILE,
  INSTRUCTIONS_FILE,
  POINTER_FILES,
  PROJECT_LOG_FILE,
} from '../../core/layout.js';
import { BOARDS, type BoardName, type Card, type ProjectConfig } from '../../core/types.js';
import { boardColumnSlugs } from '../cards/board.js';
import { setCardLinks } from '../cards/links.js';
import { type CreateCardInput, createCard } from '../cards/mutations.js';
import { defaultConfig, writeConfig } from './config.js';
import { ensurePointerFile, INSTRUCTIONS_DOC } from './control.js';
import { seedDocs } from './seed-docs.js';
import { seedSkills } from './seed-skills.js';

export type ScaffoldMode = 'greenfield' | 'brownfield';

export const VIBEBOARD_DOC = `# VibeBoard card conventions

This project is managed by VibeBoard. Cards are markdown files in folders.

## Layout
- Everything VibeBoard owns lives under \`${CONFIG_DIR}/\`; the rest of the project is not its
  business.
- Three boards, highest level first: \`${BOARDS_DIR}/features/\` (capabilities/roadmap),
  \`${BOARDS_DIR}/product/\` (what/why), and \`${BOARDS_DIR}/engineering/\` (how).
- **Column = folder.** e.g. \`${boardRel('product', 'in-progress', 'P-001.md')}\`.
- \`${ARCHIVE_SLUG}/\` (per board) holds soft-deleted cards; it is not a column.

## Card file
One card = one \`.md\` file with YAML frontmatter + a markdown body:
\`\`\`
---
id: E-010            # F-### feature, P-### product, E-### engineering; zero-padded; NEVER change on move
title: ...
description: ...     # optional short miniature summary
order: 20            # position within the column
tags: [backend]
links: [P-001, E-002] # related cards on either board (symmetric)
group: sync-epic     # optional grouping label
created: 2026-07-23
archived: ...          # only in archive/: ISO timestamp it was archived
archivedFrom: doing    # only in archive/: column slug to restore it to
---
Markdown body.
\`\`\`

## Rules for agents
- **Board and column come from the file path**, never from frontmatter.
- **Never name a column that is not configured.** Because a column is a folder, a path naming one
  that does not exist does not fail — it CREATES the folder, and the card inside it is invisible to
  the board while still holding its id. The configured columns are in \`${CONFIG_DIR}/config.yaml\`.
- **Change cards through the API, never by writing files.** \`${CONFIG_DIR}/\` is denied to every agent
  for writing by the operating system, so a file written there fails — it does not quietly do
  something else. If your instructions gave you a credential, they also list the exact endpoints it
  opens; send it as \`Authorization: Bearer <credential>\`. If they did not, you cannot change the
  board: say what should change and let the person decide.
- A \`403\` means the action is outside your authority, not that the tool is broken. Retrying it, or
  writing the file by hand instead, will not work.
`;

async function ensureFolders(projectRoot: string, config: ProjectConfig): Promise<void> {
  await mkdir(join(projectRoot, CONFIG_DIR), { recursive: true });
  for (const board of BOARDS) {
    for (const slug of [...boardColumnSlugs(config, board), ARCHIVE_SLUG]) {
      await mkdir(join(projectRoot, boardRel(board, slug)), { recursive: true });
    }
  }
}

// Never name a column literally here. A literal that the defaults have moved past writes into a
// folder no column maps to — and because column = folder, the write CREATES that folder rather than
// failing. Engineering's Todo became Backlog while all three samples still said 'todo', so the
// engineering card landed where readBoard does not look, taking its id and its links with it.
const firstColumn = (config: ProjectConfig, board: BoardName): string => boardColumnSlugs(config, board)[0];

// The columns above are derived from the same config createCard validates against, so the sentinel
// is unreachable unless a board has no columns at all. That is a broken config, and a new project
// half-scaffolded in silence is worse than one that refuses to scaffold.
async function sampleCard(
  projectRoot: string,
  config: ProjectConfig,
  input: CreateCardInput,
  today: string,
): Promise<Card> {
  const card = await createCard(projectRoot, config, input, today);
  if (card === 'unknown-column') throw new Error(`board '${input.board}' has no columns to scaffold into`);
  return card;
}

async function writeSampleCards(projectRoot: string, config: ProjectConfig, today: string): Promise<void> {
  const feature = await sampleCard(
    projectRoot,
    config,
    {
      board: 'features',
      columnSlug: firstColumn(config, 'features'),
      title: 'Sample feature',
      description: 'A high-level capability. Delete me once you get going.',
      body: 'Describe the capability and its goal here.',
    },
    today,
  );
  const product = await sampleCard(
    projectRoot,
    config,
    {
      board: 'product',
      columnSlug: firstColumn(config, 'product'),
      title: 'Sample product card',
      description: 'A product outcome. Delete me once you get going.',
      body: 'Describe the what/why here.',
    },
    today,
  );
  const engineering = await sampleCard(
    projectRoot,
    config,
    {
      board: 'engineering',
      columnSlug: firstColumn(config, 'engineering'),
      title: 'Sample engineering card',
      description: 'An implementation task. Delete me once you get going.',
      body: 'Describe the how here.',
    },
    today,
  );
  // Symmetric hierarchy trace: feature <-> product <-> engineering.
  await setCardLinks(projectRoot, config, product, [feature.id, engineering.id]);
}

const run = promisify(execFile);

// Both modes: adopting a folder that is not yet a repo should still get one, because everything
// downstream assumes commits exist — commit-before-dispatch, the checkup's own commits, rollback.
// An existing repo is never re-initialised: `git init` on one is mostly harmless, and "mostly" is
// how someone's config gets eaten.
//
// Failure is logged by its absence rather than thrown. A project without git still works as a
// board; it is auto-pilot's pre-flight that turns this into a refusal, and doing it here would
// mean a missing `git` binary broke project creation.
async function ensureRepo(projectRoot: string): Promise<void> {
  try {
    // `is-inside-work-tree`, not `existsSync('.git')`. The latter answers "is this the ROOT of a
    // repo", so adopting /monorepo/packages/app — an ordinary thing to do — gave it its own .git
    // shadowing the parent, and the parent then saw an embedded repository whose history it had
    // stopped tracking.
    await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectRoot });
    return;
  } catch {
    /* not in a work tree — or no git at all, which the init below will discover */
  }
  try {
    await run('git', ['init'], { cwd: projectRoot });
  } catch {
    /* no git on PATH, or a filesystem that will not take a repo */
  }
}

// `.vibeboard/` goes in `.gitignore`, and the whole of it — ruled 2026-08-10.
//
// WHY THE WHOLE FOLDER. Nobody wants two hundred AI-generated cards, run records and reports in their
// repository. The board is the cockpit, not the product: what belongs in someone's history is the code
// their project is made of.
//
// It also removes a dead end that had no way out. Auto-pilot refuses to create its branch on a dirty
// tree, because `checkout -b` carries uncommitted work onto the new branch and the loop's next act is to
// commit everything — so a user's work-in-progress would land under a message saying an agent wrote it.
// But VibeBoard writes into this folder constantly: a chat transcript per message, run records per tick,
// its own state file. The tree was therefore never clean, and a user who followed the refusal's advice
// and committed those files made it worse — they were now tracked, so every message dirtied the tree
// again. The same class of bug was found once before (2026-08-06) and fixed for exactly one filename.
//
// APPENDED, NEVER REWRITTEN, and skipped entirely when the rule is already there: this is the user's
// file and it may be full of theirs. Matched on the exact line rather than a substring, so a
// `!.vibeboard/keep` exception someone added on purpose is not mistaken for our own entry.
async function ensureGitignore(projectRoot: string): Promise<void> {
  const path = join(projectRoot, '.gitignore');
  const rule = `${CONFIG_DIR}/`;
  let existing = '';
  try {
    existing = await readFile(path, 'utf8');
  } catch {
    /* no .gitignore yet — the write below creates it */
  }
  if (existing.split('\n').some((line) => line.trim() === rule)) return;
  // A newline before ours whenever there is content to separate. That single `\n` does BOTH jobs — it
  // terminates a last line that had none (`dist/` + `.vibeboard/` on one line ignores nothing and
  // reports no error) and it separates the blocks when the file already ended cleanly. A second guard
  // for the no-trailing-newline case was written here first and deleted: a planted defect proved it
  // changed nothing, because this covers it.
  const spacer = existing.trim() === '' ? '' : '\n';
  const block = `${spacer}# VibeBoard's board, runs and chat history — the cockpit, not the project.\n${rule}\n`;
  await writeFile(path, `${existing}${block}`, 'utf8');
}

// The diary's first line. Both modes get one — it is the project's narrative, not sample content — and
// an existing diary is left completely alone: scaffolding is idempotent everywhere else here, and this is
// the one file where a mistake cannot be undone from the board, the run records or git.
//
// Midnight on the day the project was created, because the day is the granularity scaffold is given.
// `today` is injected rather than read from a clock so that scaffolding is deterministic, and reaching for
// `new Date()` here to gain three decimal places would give that up for nothing anyone will read.
async function ensureDiary(projectRoot: string, name: string, today: string): Promise<void> {
  const path = join(projectRoot, PROJECT_LOG_FILE);
  // `stat`, not `readFile`. Reading conflates "there is nothing here" with "there is something here I may not
  // read": a write-only diary was silently OVERWRITTEN, which is the one loss this guard exists to prevent.
  // Existence is the question, and a file we cannot read still exists.
  try {
    await stat(path);
    return;
  } catch (err) {
    // Only a missing file may be created. Anything else — a directory of that name, a permission problem — is
    // raised, because scaffolding over something we could not identify is how a narrative disappears.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const first = entryBlock(
    { at: `${today}T00:00:00.000Z`, kind: 'lifecycle', text: `Project ${name} created.` },
    true,
  );
  await writeFile(path, first, 'utf8');
}

export async function scaffoldProject(
  projectRoot: string,
  opts: { name: string; mode: ScaffoldMode; today: string; samples?: boolean },
): Promise<void> {
  const config = defaultConfig(opts.name);
  await ensureFolders(projectRoot, config);
  await writeConfig(projectRoot, config);
  await writeFile(join(projectRoot, CONVENTIONS_FILE), VIBEBOARD_DOC, 'utf8');
  await writeFile(join(projectRoot, INSTRUCTIONS_FILE), INSTRUCTIONS_DOC, 'utf8');
  const greenfield = opts.mode === 'greenfield';
  // Driven by the same list ensureControlFiles walks, so adding a CLI's pointer file is one
  // edit rather than two places that must agree.
  for (const filename of POINTER_FILES) {
    await ensurePointerFile(projectRoot, filename, opts.name, greenfield);
  }
  // Both modes: the guard inside leaves an existing skills folder untouched. Written here as well
  // as in ensureControlFiles for the same reason the instructions document is — scaffolding has to
  // produce a complete project without depending on a later open.
  await seedSkills(projectRoot);
  await seedDocs(projectRoot);
  // Sample cards demonstrate the shape for a brand-new project. Adopting an existing repo
  // should add the cockpit and nothing else — three "delete me" cards would just be noise in
  // someone's real project (and in their git status).
  //
  // AND A GREENFIELD CALLER MAY DECLINE THEM, which the wizard does. The bootstrap derives a feature
  // list only from an EMPTY board, so a sample card is what auto-pilot spends its first real run on and
  // `decision 74`'s review stop is never reached — measured on a live journey, against "Sample
  // engineering card". The DEFAULT IS TRUE because greenfield outside the wizard — the visual harness,
  // a direct API call — is the case the samples were written for: a board with nothing on it and nobody
  // guiding the person through what a card is.
  if (greenfield && (opts.samples ?? true)) await writeSampleCards(projectRoot, config, opts.today);
  await ensureDiary(projectRoot, opts.name, opts.today);
  // Order relative to `ensureRepo` does not matter — git reads `.gitignore` when it is asked about the
  // tree, not when the repository is created. Moving it after made no test fail, and the claim that it
  // had to come first was withdrawn rather than left standing.
  await ensureGitignore(projectRoot);
  await ensureRepo(projectRoot);
}
