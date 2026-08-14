import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SKILLS_DIR } from '../../core/layout.js';

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
    // REWRITTEN from a general critique skill into the lifecycle's judge (decision 51's second step). It is
    // asked for the one thing a command's exit code cannot express: a gate proves the suite passes, and cannot
    // prove the suite tests the criterion the card states.
    slug: 'review',
    content: `---
name: Review
description: Judge one run against the card that asked for it
boards: [engineering]
---
Judge ONE run against the card below.

The run you are judging is named in this prompt, with how it ended, what VibeBoard
noted about it and how many files it changed. Judge what THAT run did. An earlier
run on this card may have succeeded; its work is not this run's work and does not
count for it.

**This prompt tells you what the gates did** — whether they passed, whether there
were none to run because this card is the one that installs them, or whether
nobody ran them at all. Do not assume; read it. Your question is the one no
command can answer: **does this do what the card asked?** Not "is it good", not
"is it what I would have built".

Change nothing. Not the code, not the card, not where it sits — your credential
grants you nothing on the board, and a judge that fixes what it is judging is
grading its own work.

Answer with a verdict: \`done\`, or \`sent-back\` with your findings. A report with
no verdict cannot pass anything, so answer even when the answer is sent-back.

Work that does MORE than the card asked still passes. Say so rather than marking
it down: failing a card for over-delivery throws away working code and spends one
of the card's attempts rebuilding it.

Your findings are what a \`fix\` run will be handed, so be specific enough that
someone could disagree with them.
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

**Read the board first** and say in your report what is already there — every
feature, archived ones included. This phase can run more than once: a README that
has grown gets what is new, and what already exists is left alone.

The README is the brief. Work out what capabilities the thing described actually
requires, and create one feature card per capability, in the order they must be
built — earlier cards must not depend on later ones.

**The FIRST feature is the project's own scaffolding**: the toolchain, the test
runner, and the commands foundation/CODE-QUALITY.md promises. Nothing after it can
be verified until it exists, which is why it is built first. Do not try to mark it
— auto-pilot flags the scaffolding feature itself, from the board, and this run
cannot write that field.

Create them in features/backlog with \`POST /api/cards\`, one card per call, and
never by writing card files. Backlog is where the feature queue lives; auto-pilot
moves a feature on itself when it starts breaking that one down.

Keep each feature to a capability a person would name, not a task: "accounts and
sign-in", not "add a users table".

If the README is too thin to derive features from, say so in your report and
name what is missing rather than inventing a product.

List every card you created in your report, by id.
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

**Read the board first** and say in your report what already exists under this
card. A card that already has children does not need breaking down again, and a
second set of them costs a break-down, an implement, the gates and a review each
for work that is already on the board.

**The brief is a ceiling, not a starting point.** The card below and the project's
README are the bound: read the README, and split what those two ask for and
nothing else. Work neither of them asks for is a **suggestion**, not a card — file
it with \`POST /api/suggestions\`, and a person decides whether it becomes work.
Every card you create costs a break-down, an implement, the gates and a review, so
one nobody asked for is not free.

**One acceptance criterion per card.** A card is the right size when exactly one
test can express whether it is done. Two criteria means two cards. This is the
rule that keeps the project a proof of concept rather than a product.

- Create each card with \`POST /api/cards\`, one card per call — never a shell loop
  whose result you cannot check.
- The board a card may go on, the column it enters, its \`group\` and the card it
  hangs off are all decided by the endpoint rather than by you. A 409 means you
  asked for a board this phase may not create on — not that the card was wrong.
- Anything you notice that is real work but does not belong to this card goes to
  \`POST /api/suggestions\`, not into a bigger card and not into an extra one.
  Nothing is blocked and nothing is lost.

**If a card you create declares the project's \`smoke:\` command**, say on the card
that the way to declare it is \`POST /api/foundation/smoke\` with \`{ command }\`.
The foundation documents are read-only to every run — that endpoint is the only way
in, and it writes that one key. A card telling a later run to edit
foundation/TESTING.md is asking for something no run can do.

That command must not be one of the gate commands foundation/CODE-QUALITY.md
declares, and the card must say so. A gate and a smoke command that are the same
command are one check, not two: gates are written alongside the code they judge, so
they pass over a product with no way to run it. The smoke command has to exercise
the product from OUTSIDE.

List every card you created in your report, by id.
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
card often carries only the mechanics. It is quoted in full in this prompt.

The gates in the project's foundation/CODE-QUALITY.md are the bar, and they are
quoted here in full. Run them yourself before you finish: auto-pilot runs them
again the moment you are done, and a run that leaves them failing has not
delivered.

**If this card asks you to declare the project's \`smoke:\` command**, declare it
with \`POST /api/foundation/smoke\` and a body of \`{ command }\`. Do NOT try to edit
foundation/TESTING.md: the foundation documents are read-only to every run, that
endpoint is the only way to declare this, and it writes that one key and nothing
else. If the card tells you to edit the file, this is what it means.

The command must not be one of the gate commands foundation/CODE-QUALITY.md
declares — the endpoint refuses that outright. A gate and a smoke command that are
the same command are one check, not two: gates are written alongside the code they
judge, so they pass over a product with no way to run it. Make the smoke command
start the product the way the README describes starting it, and use it the way the
README describes using it.

Do the one thing the card asks. Anything else you find — an unrelated bug, a
missing dependency, work the card implies but does not say — goes to
\`POST /api/suggestions\`. Do the part you can, file the rest, and stop.

You do not move your own card, and cannot: auto-pilot moves it when this run
finishes, and your credential grants nothing that could.
`,
  },
  {
    slug: 'fix',
    content: `---
name: Fix
description: Address the findings that sent this card back
boards: [engineering]
---
Fix what sent the card below back.

The failing verdict is in this prompt, under the previous run: either a gate's own
command and what it printed, or the reviewer's findings in their own words. That
is your whole brief — you are not being asked to look for problems.

Address the findings and nothing else. **Do not widen** what the card asks for: a
finding that reveals more work than this card covers goes to
\`POST /api/suggestions\`, and the card stays the size it was.

Run the gates before you finish. They are quoted in this prompt, and auto-pilot
runs them again the moment you are done.

You do not judge your own fix. It goes back to review, which is a separate run
with no stake in this one — and you do not move your own card either.

Say in your report which finding you addressed and how. The next reviewer reads
that first.
`,
  },
  {
    slug: 'checkup-story',
    content: `---
name: Story checkup
description: Decide whether the tasks under this story compose into it
boards: [product]
---
Decide whether the tasks under the card below compose into the story it describes.

Everything you need is in this prompt: every task under this story with the column
it is in and how its last run ended, the blocked ones named, and the open
suggestions. You cannot fetch any of it and do not need to — your credential does
not reach those endpoints, and auto-pilot already holds every one of those facts.

Three tasks can each pass their own gates and the story they compose not work.
That is the question here, and it is the only one no command can answer.

A blocked task is **settled**, not outstanding. If every task of this story is
done or blocked, the story is finished: **say so in your report** and name the
blocked ones. Do not create work to get past a blocked task —
it has already had every attempt it is allowed, and it is waiting for a person.

So: create work for what was MISSED, never for what was attempted and blocked.
**Read the board first**, and create through \`POST /api/cards\`,
one card per call. You get ONE round of creating: anything you still believe is
missing afterwards goes to \`POST /api/suggestions\`.

**The brief is a ceiling, and this phase is where over-scope is noticed.** Read the
project's README: it and the card below are the bound on what belongs under this
card. Anything under it that neither asks for is over-scope, and **naming it in
your report is the whole of what you do about it** — your one creating round is for
what was MISSED, never for work nobody asked for.

You do not move or archive any card. Auto-pilot stamps the column when this run
finishes.

Report what you found, list by id any cards you created, and name every blocked
task you left behind.
`,
  },
  {
    slug: 'checkup-feature',
    content: `---
name: Feature checkup
description: Decide whether the stories under this feature compose into it
boards: [features]
---
Decide whether the stories under the card below compose into a working feature.

Everything you need is in this prompt: every story under this feature with the
column it is in and how its last run ended, then ONE list of everything blocked
beneath this feature at any depth, the open suggestions, and what the smoke
command did. The blocked list is not broken down per story — if you need to know
which story a blocked card sits under, say so in your report rather than guessing.
You cannot fetch any of it and do not need to: your credential does not reach
those endpoints, and auto-pilot already holds every one of those facts.

Three stories can each close and the feature not work. That is why this phase
exists, and it is the only question here that no command can answer.

The smoke command's result is **evidence, not a verdict**. Auto-pilot ran it in
its own process before dispatching you: you are told what it did, and what it
means is yours to decide.

A blocked task is **settled**, not outstanding. If every story of this feature is
done, the feature is finished: **say so in your report** and name what was left
behind. Do not create work to get past a blocked task —
it has already had every attempt it is allowed, and it is waiting for a person.
A story carrying a blocked task is settled too, and is not work to attack.

So: create work for what was MISSED, never for what was attempted and blocked.
**Read the board first**, and create stories through \`POST /api/cards\`,
one card per call. You get ONE round of creating at this feature: when what you
created is settled and you run here again, either report the feature as finished
or say why it is not — and anything still missing goes to \`POST /api/suggestions\`.

**The brief is a ceiling, and this phase is where over-scope is noticed.** Read the
project's README: it and the card below are the bound on what belongs under this
card. Anything under it that neither asks for is over-scope, and **naming it in
your report is the whole of what you do about it** — your one creating round is for
what was MISSED, never for work nobody asked for.

You do not move or archive any card. Auto-pilot stamps the column when this run
finishes.

Report what you found, list by id any stories you created, and name everything
that is carrying a problem.
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
