import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultConfig, writeConfig, CONFIG_DIR } from './config.js';
import { boardColumnSlugs, ARCHIVE_SLUG } from './board.js';
import { createCard } from './mutations.js';
import type { BoardName, ProjectConfig } from './types.js';

export type ScaffoldMode = 'greenfield' | 'brownfield';

const POINTER = 'See VIBEBOARD.md for card conventions.';

export const VIBEBOARD_DOC = `# VibeBoard card conventions

This project is managed by VibeBoard. Cards are markdown files in folders.

## Layout
- Two boards: \`product/\` (what/why) and \`engineering/\` (how).
- **Column = folder.** e.g. \`product/in-progress/P-001.md\`.
- \`archive/\` (per board) holds soft-deleted cards; it is not a column.

## Card file
One card = one \`.md\` file with YAML frontmatter + a markdown body:
\`\`\`
---
id: E-010            # P-### product, E-### engineering; zero-padded; NEVER change on move
title: ...
description: ...     # optional short miniature summary
order: 20            # position within the column
tags: [backend]
links: [P-001, E-002] # related cards on either board (symmetric)
group: sync-epic     # optional grouping label
created: 2026-07-23
---
Markdown body.
\`\`\`

## Rules for agents
- To create a card, pick the next id = highest existing of that prefix + 1.
- To move a card, move its file to another column folder — do not change its id.
- Board and column come from the file path, never from frontmatter.
- Links are symmetric: relating two cards records each other's id in both \`links\` lists.
  Any pairing is allowed — product↔product, engineering↔engineering, or across boards.
`;

async function ensureFolders(projectRoot: string, config: ProjectConfig): Promise<void> {
  await mkdir(join(projectRoot, CONFIG_DIR), { recursive: true });
  for (const board of ['product', 'engineering'] as BoardName[]) {
    for (const slug of [...boardColumnSlugs(config, board), ARCHIVE_SLUG]) {
      await mkdir(join(projectRoot, board, slug), { recursive: true });
    }
  }
}

async function writeClaudePointer(projectRoot: string, name: string, mode: ScaffoldMode): Promise<void> {
  const path = join(projectRoot, 'CLAUDE.md');
  if (mode === 'greenfield') {
    await writeFile(path, `# ${name}\n\n${POINTER}\n`, 'utf8');
    return;
  }
  let existing = '';
  try {
    existing = await readFile(path, 'utf8');
  } catch {
    /* no existing CLAUDE.md */
  }
  if (existing.includes('VIBEBOARD.md')) return;
  const sep = existing.endsWith('\n') || existing === '' ? '' : '\n';
  await writeFile(path, `${existing}${sep}\n${POINTER}\n`, 'utf8');
}

async function writeSampleCards(projectRoot: string, config: ProjectConfig, today: string): Promise<void> {
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
  await createCard(
    projectRoot,
    config,
    {
      board: 'engineering',
      columnSlug: 'todo',
      title: 'Sample engineering card',
      description: 'An implementation task linked to the sample product card.',
      links: [product.id],
      body: 'Describe the how here.',
    },
    today,
  );
}

export async function scaffoldProject(
  projectRoot: string,
  opts: { name: string; mode: ScaffoldMode; today: string },
): Promise<void> {
  const config = defaultConfig(opts.name);
  await ensureFolders(projectRoot, config);
  await writeConfig(projectRoot, config);
  await writeFile(join(projectRoot, 'VIBEBOARD.md'), VIBEBOARD_DOC, 'utf8');
  await writeClaudePointer(projectRoot, opts.name, opts.mode);
  await writeSampleCards(projectRoot, config, opts.today);
}
