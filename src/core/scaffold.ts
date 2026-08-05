import { execFile } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { boardColumnSlugs } from './board.js';
import { defaultConfig, writeConfig } from './config.js';
import { ensurePointerFile, INSTRUCTIONS_DOC } from './control.js';
import { entryBlock } from './diary.js';
import {
  ARCHIVE_SLUG,
  BOARDS_DIR,
  boardRel,
  CONFIG_DIR,
  CONVENTIONS_FILE,
  INSTRUCTIONS_FILE,
  POINTER_FILES,
  PROJECT_LOG_FILE,
} from './layout.js';
import { setCardLinks } from './links.js';
import { type CreateCardInput, createCard } from './mutations.js';
import { seedSkills } from './seed-skills.js';
import { BOARDS, type BoardName, type Card, type ProjectConfig } from './types.js';

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
- **If your instructions gave you a credential, change cards through the API rather than by writing
  files.** Every skill run gets one. Send it as \`Authorization: Bearer <credential>\`:
  - \`POST /api/cards\` — \`{ board, columnSlug, title, description?, body?, links? }\`. The id is
    assigned for you; never choose one.
  - \`PATCH /api/cards/:board/:id\` — title, description, tags, group, body.
  - \`PUT /api/cards/:board/:id/links\` — \`{ links: [id, ...] }\`, the complete list. The far side is
    written for you.
  - Moving and archiving are not yours. A \`403\` means the action is outside your authority, not
    that the tool is broken.
- **Without a credential** (the chat copilot, driven by a person), edit the files directly:
  - Create: next id = highest existing of that prefix + 1, inside a configured column's folder.
  - Move: move the file to another column folder — do not change its id.
  - Archive: move it to \`${ARCHIVE_SLUG}/\` **and** set \`archived\` + \`archivedFrom\`, or it cannot be put
    back where it came from. Restore: move it out and delete both keys — a live card never carries
    them.
  - Link: relating two cards records each other's id in both \`links\` lists. Any pairing is allowed
    — product↔product, engineering↔engineering, or across boards.
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
  opts: { name: string; mode: ScaffoldMode; today: string },
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
  // Sample cards demonstrate the shape for a brand-new project. Adopting an existing repo
  // should add the cockpit and nothing else — three "delete me" cards would just be noise in
  // someone's real project (and in their git status).
  if (greenfield) await writeSampleCards(projectRoot, config, opts.today);
  await ensureDiary(projectRoot, opts.name, opts.today);
  await ensureRepo(projectRoot);
}
