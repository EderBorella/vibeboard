import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// The skills a project starts with. They are ordinary files: the user edits or deletes them like
// any other, and nothing here is special-cased later.
//
// No `columns:` on purpose — a column slug has to exist in that project's config, and a project
// may have renamed its columns. Boards are fixed by BOARDS, so board scoping is always valid.
//
// No model, effort, backend or mode: see the header of core/skills.ts.

const SKILLS_DIR = '.claude/skills';

export const SEED_SKILLS: { slug: string; content: string }[] = [
  {
    slug: 'execute',
    content: `---
name: Execute
description: Implement what the card describes
boards: [engineering]
---
Implement the card below.

Read any linked product card first: it carries the intent, while an engineering
card often carries only the mechanics. Work in small steps, and run the
project's own test and lint commands before you finish.

Do not change a card's id, and do not move a card between columns unless the
card itself asks you to.
`,
  },
  {
    slug: 'research',
    content: `---
name: Research
description: Gather context and options without changing anything
---
Research the card below and report what you find.

Do NOT create, edit or delete any file except the report you are asked to write.
This is a reading task: explore the codebase, the linked cards and any attached
material, and weigh the options.

End with a recommendation and the reasoning behind it, so the next run can act
on it without repeating the search.
`,
  },
  {
    slug: 'review',
    content: `---
name: Review
description: Critique the work the card describes
boards: [engineering]
---
Review the work the card below describes.

Read the code and tests as they stand now. Judge correctness first, then whether
the tests actually constrain the behaviour they name, then clarity. Verify each
finding before reporting it — a plausible-sounding finding that does not
reproduce costs more than it saves.

Do not fix what you find unless the card asks you to; report it.
`,
  },
  {
    slug: 'break-down',
    content: `---
name: Break down
description: Split the card into smaller cards
boards: [features, product]
---
Break the card below into smaller cards.

Each new card should be independently deliverable and small enough to review in
one sitting. Write them as real cards in the right board and column, link them
to this card, and keep this card as the parent.

List every card you created in your report, by id, so the result is checkable.
`,
  },
  {
    slug: 'summarise',
    content: `---
name: Summarise
description: Condense the card and everything it links to
---
Summarise the card below together with every card it links to.

Say what the work is, what state it is in, and what is left. Keep it short
enough to read at a glance — this exists so someone returning to the card does
not have to read the whole chain.

Change nothing on disk except the report you are asked to write.
`,
  },
];

// Seed ONLY when the skills folder is absent. Deleting a skill removes its folder and leaves
// `.claude/skills/` behind, so this is what makes a deletion permanent — and it also means an
// adopted repo that already keeps its own skills there is never written into.
export async function seedSkills(root: string): Promise<boolean> {
  const dir = join(root, SKILLS_DIR);
  try {
    await readdir(dir);
    return false; // exists, even if empty
  } catch {
    /* absent — seed it */
  }
  for (const seed of SEED_SKILLS) {
    await mkdir(join(dir, seed.slug), { recursive: true });
    await writeFile(join(dir, seed.slug, 'SKILL.md'), seed.content, 'utf8');
  }
  return true;
}
