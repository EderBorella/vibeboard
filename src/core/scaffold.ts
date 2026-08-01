import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boardColumnSlugs } from './board.js';
import { defaultConfig, writeConfig } from './config.js';
import { ensurePointerFile, INSTRUCTIONS_DOC } from './control.js';
import {
  ARCHIVE_SLUG,
  BOARDS_DIR,
  boardRel,
  CONFIG_DIR,
  CONVENTIONS_FILE,
  INSTRUCTIONS_FILE,
  POINTER_FILES,
} from './layout.js';
import { setCardLinks } from './links.js';
import { createCard } from './mutations.js';
import { seedSkills } from './seed-skills.js';
import { BOARDS, type ProjectConfig } from './types.js';

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
- To create a card, pick the next id = highest existing of that prefix + 1.
- To move a card, move its file to another column folder — do not change its id.
- Board and column come from the file path, never from frontmatter.
- Archiving a card by hand: move it to \`archive/\` **and** set \`archived\` + \`archivedFrom\`,
  or it cannot be put back where it came from. Restoring: move it out and delete both keys —
  a live card never carries them.
- Links are symmetric: relating two cards records each other's id in both \`links\` lists.
  Any pairing is allowed — product↔product, engineering↔engineering, or across boards.
`;

async function ensureFolders(projectRoot: string, config: ProjectConfig): Promise<void> {
  await mkdir(join(projectRoot, CONFIG_DIR), { recursive: true });
  for (const board of BOARDS) {
    for (const slug of [...boardColumnSlugs(config, board), ARCHIVE_SLUG]) {
      await mkdir(join(projectRoot, boardRel(board, slug)), { recursive: true });
    }
  }
}

async function writeSampleCards(projectRoot: string, config: ProjectConfig, today: string): Promise<void> {
  const feature = await createCard(
    projectRoot,
    config,
    {
      board: 'features',
      columnSlug: 'todo',
      title: 'Sample feature',
      description: 'A high-level capability. Delete me once you get going.',
      body: 'Describe the capability and its goal here.',
    },
    today,
  );
  const product = await createCard(
    projectRoot,
    config,
    {
      board: 'product',
      columnSlug: 'todo',
      title: 'Sample product card',
      description: 'A product outcome. Delete me once you get going.',
      body: 'Describe the what/why here.',
    },
    today,
  );
  const engineering = await createCard(
    projectRoot,
    config,
    {
      board: 'engineering',
      columnSlug: 'todo',
      title: 'Sample engineering card',
      description: 'An implementation task. Delete me once you get going.',
      body: 'Describe the how here.',
    },
    today,
  );
  // Symmetric hierarchy trace: feature <-> product <-> engineering.
  await setCardLinks(projectRoot, config, product, [feature.id, engineering.id]);
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
}
