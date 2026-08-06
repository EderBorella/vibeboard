import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CRITIC_SKILL } from './autopilot.js';
import { SKILLS_DIR } from './layout.js';

// The skills a project starts with. They are ordinary files: the user edits or deletes them like
// any other, and nothing here is special-cased later.
//
// No `columns:` on purpose — a column slug has to exist in that project's config, and a project
// may have renamed its columns. Boards are fixed by BOARDS, so board scoping is always valid.
//
// No model, effort, backend or mode: see the header of core/skills.ts.

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
    slug: 'derive-features',
    content: `---
name: Derive features
description: Turn the README into the feature list
boards: [features]
---
Read the project's README and derive the features this project needs.

The README is the brief. Work out what capabilities the thing described actually
requires, and create one feature card per capability, in the order they must be
built — earlier cards must not depend on later ones.

Create them with \`POST /api/cards\` **in features/todo**; do not write card files.
Never in the column this card is in: a card in features/backlog is one that still
needs deriving, so a feature left there is sent back through this same phase — a
run that finds nothing to do, and a card that advances for doing nothing. Todo is
where a feature waits to be broken down, which is what comes next for it.

Keep each feature to a capability a person would name, not a task: "accounts and
sign-in", not "add a users table".

If the README is too thin to derive features from, say so in your report and
name what is missing rather than inventing a product.
`,
  },
  {
    slug: 'break-down',
    content: `---
name: Break down
description: Split the card into smaller cards, one criterion each
boards: [features, product]
---
Break the card below into smaller cards on the board one level down.

The level below has a name. A **feature** breaks into **user stories** on the
product board; a **user story** breaks into **tasks** on engineering. One feature,
its stories and their tasks are a single vertical, and the whole point of breaking
down is that the vertical can be built one card at a time.

**One acceptance criterion per card.** A card is the right size when exactly one
test can express whether it is done. Two criteria means two cards. This is the
rule that keeps the project a proof of concept rather than a product.

- Create each card with \`POST /api/cards\` and link it to this card with
  \`PUT /api/cards/:board/:id/links\` — the parent is your own card, so the link
  is yours to write and the far side is written for you.
- Everything the hierarchy knows comes from those links. An unlinked card is an
  orphan and nothing will ever roll it up.
- Set \`group\` on every card you create to the vertical it belongs to: this card's
  own \`group\` if it has one, and otherwise this card's id. That makes one group
  exactly one feature — from the feature, down through its user stories, to their
  tasks — so a person can see a whole vertical across three boards at once.
- Anything you notice that is real work but does not belong to this card goes to
  \`POST /api/suggestions\`, not into a bigger card and not into an extra one.
  Nothing is blocked and nothing is lost.

List every card you created in your report, by id.
`,
  },
  {
    slug: 'design',
    content: `---
name: Design
description: Decide what this product card is and why, before anyone builds it
boards: [product]
---
Decide what the card below is, and why.

Write the intent: what a person can do afterwards that they could not do before,
and how anyone would know it works. An engineering card usually carries only the
mechanics — this card is where the reason lives, and the run that implements it
is given this card's body in full.

Follow the project's foundation documents. The stack, the gates and the design
language are already decided and are not yours to revisit.

Edit this card with \`PATCH /api/cards/:board/:id\`. Do not create engineering
cards here — breaking down is its own phase.
`,
  },
  {
    slug: 'implement',
    content: `---
name: Implement
description: Build what the card describes, and make the gates pass
boards: [engineering]
---
Implement the card below.

Read the linked product card first: it carries the intent, while an engineering
card often carries only the mechanics.

The gates in the project's CODE-QUALITY.md are the bar, and they are quoted in
this prompt. Run them yourself before you finish — a run that leaves them failing
has not delivered, and it will be verified against them either way.

Do the one thing the card asks. Anything else you find — an unrelated bug, a
missing dependency, work the card implies but does not say — goes to
\`POST /api/suggestions\`. Do the part you can, file the rest, and stop.
`,
  },
  {
    slug: 'test',
    content: `---
name: Test
description: Prove the card's behaviour is actually held in place
boards: [engineering]
---
Write the tests that hold the card below in place.

A passing test proves the code ran, not that anything constrains it. For each
test you write, break the behaviour it names on purpose and watch it fail, then
restore it. A test that passes against deleted code is not a test.

Assert the behaviour the card describes, not the implementation that happens to
provide it. If the card's premise turns out to be wrong, say which — the code or
the card — in your report rather than widening an assertion to make it pass.

Run the project's gates before you finish.
`,
  },
  {
    slug: 'close-out',
    content: `---
name: Close out
description: Exercise the whole feature end to end
boards: [features]
---
Exercise the feature below end to end.

Its cards have each passed their own tests. That is not the same as the feature
working: three correct parts compose into something broken often enough that this
phase exists. Run the smoke test declared in the project's TESTING.md and use the
feature the way a person would.

Report what works and what does not, specifically. If it does not work, say which
card's assumption was wrong — that is what the next run needs, and "it fails" is
not it.

Change as little as possible: this is a verification phase, not a second chance
to implement.
`,
  },
  {
    // The verifier a `critic` route dispatches. No `boards:` — it judges cards on all three, and a
    // route on any of them may name it. Its prompt says nothing about the threshold: that number comes
    // from the project's config and is stated in the dispatch prompt, so a project that changes it does
    // not have to remember to edit a skill file too.
    slug: CRITIC_SKILL,
    content: `---
name: Critic
description: Judge finished work against the card that asked for it
---
Judge the work described below against its card, and score it.

You are not building anything. Do not edit the code, do not edit the card and do
not move it: your report is the verdict, and a judge that fixes what it is
judging is grading its own work.

Read the card first, then the work as it stands now. Ask one question: does this
meet the acceptance criterion the card states? Not "is it good", not "is it what
I would have built" — does it do what was asked.

Work that does MORE than the card asked still passes. Note it as an overshoot
instead: failing a card for over-delivery throws away working code and spends one
of the card's attempts rebuilding it.

Say what you checked and where the work and the card differ, specifically enough
that someone can disagree with you.
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
// the skills root behind, so this is what makes a deletion permanent — and it also means a
// project that already keeps its own skills there is never written into.
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
