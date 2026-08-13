import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { skillRel } from '../src/core/layout.js';
import { SEED_SKILLS, seedSkills } from '../src/core/seed-skills.js';
import { readSkills } from '../src/server/skill-catalogue.js';
import { tempDir } from './helpers.js';

const config = defaultConfig('T');

describe('seedSkills', () => {
  it('writes every seeded skill into an empty project', async () => {
    const root = await tempDir();
    expect(await seedSkills(root)).toBe(true);
    const { skills, invalid } = await readSkills(root, config);
    expect(invalid).toEqual([]);
    expect(skills.map((s) => s.slug)).toEqual([...SEED_SKILLS.map((s) => s.slug)].sort());
  });

  it('every seeded skill is valid against a default config', async () => {
    // The seeds ship in the product: an invalid one would be invisible in the rail with no clue
    // why. This is the test that would catch a typo in a seed's frontmatter.
    const root = await tempDir();
    await seedSkills(root);
    const { skills } = await readSkills(root, config);
    expect(skills).toHaveLength(SEED_SKILLS.length);
    for (const s of skills) {
      expect(s.name).not.toBe('');
      expect(s.description).not.toBe('');
      expect(s.prompt.length).toBeGreaterThan(20);
      // No column scoping: a column slug must exist in that project's config, and a project may
      // have renamed its columns. Boards are fixed by BOARDS, so board scoping is always valid.
      expect(s.columns).toEqual([]);
    }
  });

  it('leaves an existing skills folder alone, so a deleted skill stays deleted', async () => {
    const root = await tempDir();
    await seedSkills(root);
    await rm(join(root, skillRel(SEED_SKILLS[0].slug)), { recursive: true });

    expect(await seedSkills(root)).toBe(false);
    const { skills } = await readSkills(root, config);
    expect(skills.map((s) => s.slug)).not.toContain(SEED_SKILLS[0].slug);
  });

  it('leaves an adopted repo that already has its own skills untouched', async () => {
    // A real skill, not a bare folder: the fixture used to be an empty directory and read the
    // result out of `invalid`, which only worked while an empty folder counted as an invalid skill.
    // What this test is about is that seeding neither overwrites what is already there nor adds its
    // own beside it.
    const root = await tempDir();
    await mkdir(join(root, skillRel('their-skill')), { recursive: true });
    const theirs = '---\nname: their-skill\ndescription: what they wrote\n---\nTheir prompt.\n';
    await writeFile(join(root, skillRel('their-skill', 'SKILL.md')), theirs, 'utf8');

    expect(await seedSkills(root)).toBe(false);
    const { skills, invalid } = await readSkills(root, config);
    expect(skills.map((s) => s.slug)).toEqual(['their-skill']);
    expect(invalid).toEqual([]);
    expect(skills[0].prompt).toBe('Their prompt.');
  });

  it('does not edit a seed already on disk', async () => {
    const root = await tempDir();
    await seedSkills(root);
    const path = join(root, skillRel(SEED_SKILLS[0].slug, 'SKILL.md'));
    const mine = '---\nname: Mine\ndescription: my own\n---\nMy prompt.\n';
    await writeFile(path, mine, 'utf8');
    await seedSkills(root);
    expect(await readFile(path, 'utf8')).toBe(mine);
  });
});

describe('the two entry points', () => {
  it('scaffolding a project seeds its skills', async () => {
    const { scaffoldProject } = await import('../src/core/scaffold.js');
    const root = await tempDir();
    await scaffoldProject(root, { name: 'S', mode: 'greenfield', today: '2026-07-26' });
    const { skills } = await readSkills(root, config);
    expect(skills.map((s) => s.slug)).toEqual([...SEED_SKILLS.map((s) => s.slug)].sort());
  });

  it('the open-time upgrade path seeds skills into a project that predates them', async () => {
    // ensureControlFiles runs on every project open. A project scaffolded before skills existed
    // has none, and would otherwise show an empty rail forever.
    const { ensureControlFiles } = await import('../src/core/control.js');
    const root = await tempDir();
    await ensureControlFiles(root);
    const { skills } = await readSkills(root, config);
    expect(skills.map((s) => s.slug)).toEqual([...SEED_SKILLS.map((s) => s.slug)].sort());
  });
});

// The routing table names skills by slug, and the seeds are where those skills come from. Nothing
// else ties the two together: rename a folder and the route points at nothing, so the phase silently
// never runs — under auto-pilot, where nobody is watching it not happen.
describe('the phase skills the routing table names', () => {
  it('provides a skill for every route in the default table', async () => {
    const { DEFAULT_AUTOPILOT } = await import('../src/core/autopilot.js');
    const slugs = new Set(SEED_SKILLS.map((s) => s.slug));
    for (const route of DEFAULT_AUTOPILOT.routes) {
      expect(slugs, `${route.board}/${route.column}`).toContain(route.skill);
    }
  });

  it('scopes each phase skill to the board its route is on', async () => {
    const root = await tempDir();
    await seedSkills(root);
    const { skills } = await readSkills(root, config);
    const boardsOf = (slug: string): string[] => skills.find((s) => s.slug === slug)?.boards ?? ['MISSING'];
    expect(boardsOf('derive-features')).toEqual(['features']);
    expect(boardsOf('close-out')).toEqual(['features']);
    expect(boardsOf('design')).toEqual(['product']);
    expect(boardsOf('implement')).toEqual(['engineering']);
    expect(boardsOf('test')).toEqual(['engineering']);
    expect(boardsOf('break-down')).toEqual(['features', 'product']);
    // The lifecycle's own, each scoped to the one board its phase sits on: a `fix` and a `review` are always
    // about a task, a story checkup about a story, a feature checkup about a feature.
    expect(boardsOf('fix')).toEqual(['engineering']);
    expect(boardsOf('review')).toEqual(['engineering']);
    expect(boardsOf('checkup-story')).toEqual(['product']);
    expect(boardsOf('checkup-feature')).toEqual(['features']);
  });

  // What keeps a proof of concept from becoming a product. Both halves have to be in the prompt, or
  // the rule exists only in the design document.
  it('tells break-down to size by acceptance criterion and to file what will not fit', () => {
    const content = SEED_SKILLS.find((s) => s.slug === 'break-down')?.content ?? '';
    expect(content).toContain('One acceptance criterion per card');
    expect(content).toContain('POST /api/suggestions');
    // Links are what the hierarchy is derived from; a card created without one is an orphan.
    expect(content).toContain('PUT /api/cards/:board/:id/links');
  });

  // SUPERSEDED, and recorded rather than quietly rewritten. This asserted `features/todo` and "never in the
  // column this card is in", which was decision 37: `features/backlog` dispatched `derive-features`, so a
  // feature created there was sent straight back through the phase that made it. Under this machine a column
  // dispatches nothing — the phase comes from the position — so `backlog` is where the queue belongs, and the
  // self-loop is closed by the machine rather than by an instruction (decision 43's own table).
  it('tells derive-features where the feature queue lives, and which feature is the scaffolding', () => {
    const content = SEED_SKILLS.find((s) => s.slug === 'derive-features')?.content ?? '';
    expect(content).toContain('features/backlog');
    expect(content).not.toContain('features/todo');
  });

  // WEAKENED DELIBERATELY, because the instruction stopped being the mechanism. The endpoint stamps `group`
  // now (server/routes/cards.ts), so "this card's own group if it has one, and otherwise this card's id" is a
  // rule the agent no longer carries out — and asserting it would pin an instruction that cannot be wrong.
  // What survives is that the body NAMES the field, so an agent reading a value it did not set is not
  // surprised by it and does not try to correct it.
  it('tells break-down that the vertical’s group is stamped for it', () => {
    const content = SEED_SKILLS.find((s) => s.slug === 'break-down')?.content ?? '';
    expect(content).toContain('`group`');
  });

  // THE DIRECTION of the spine, not merely its vocabulary. These were dotAll `.+` regexes, which a review
  // showed pass just as well when the two levels are stated backwards — "a user story breaks into features" —
  // because both words appear somewhere in the document. The exact sentence, then: this is a prompt, so the
  // wording IS the behaviour.
  it('tells break-down what the level below is called, and in which direction', () => {
    const content = SEED_SKILLS.find((s) => s.slug === 'break-down')?.content ?? '';
    expect(content).toContain(
      'A **feature** breaks into **user stories** on the\nproduct board; a **user story** breaks into **tasks** on engineering.',
    );
  });

  it('tells implement to file what it finds rather than widen the card', () => {
    const content = SEED_SKILLS.find((s) => s.slug === 'implement')?.content ?? '';
    expect(content).toContain('POST /api/suggestions');
    expect(content).toContain('CODE-QUALITY.md');
  });

  it('keeps the manual skills a person already had', () => {
    expect(SEED_SKILLS.map((s) => s.slug)).toEqual(
      expect.arrayContaining(['execute', 'research', 'review', 'summarise']),
    );
  });
});

describe('the critic seed', () => {
  // Shipped as an ordinary skill file, because that is what the loop dispatches. Without it every
  // critic-verified route is a phase that can never pass — which readiness now refuses to start on.
  it('is there, is told to score, and is told not to touch', () => {
    const critic = SEED_SKILLS.find((s) => s.slug === 'critic');
    expect(critic).toBeDefined();
    expect(critic?.content).toMatch(/score/i);
    expect(critic?.content).toMatch(/do not (change|edit|fix)/i);
  });
});

// THE LIFECYCLE'S OWN SEVEN. Every one of these is prose, and for a prompt the wording IS the behaviour — so
// what is asserted here is the exact sentences the design turns on, not that a body exists.
describe('the lifecycle skills', () => {
  const body = (slug: string): string => SEED_SKILLS.find((s) => s.slug === slug)?.content ?? '';

  it('seeds every lifecycle skill the phase table names', async () => {
    // From the TABLE, not from a list here: a phase whose skill nothing seeds is a phase that can never run,
    // and under auto-pilot nobody is watching it not happen.
    const { LIFECYCLE_SKILLS } = await import('../src/core/phases.js');
    const slugs = SEED_SKILLS.map((s) => s.slug);
    for (const skill of LIFECYCLE_SKILLS) expect(slugs, skill).toContain(skill);
  });

  // DECISION 45, VERBATIM, and this is the boundary that makes the attempt cap unescapable. Without it a
  // checkup can create work to get past a blocked task — and that story gets three fix attempts of its own,
  // then another checkup, then another story, through the one authority these runs have.
  it('tells both checkups the blocked-task rule, verbatim', () => {
    for (const slug of ['checkup-story', 'checkup-feature']) {
      expect(body(slug), slug).toContain('A blocked task is **settled**, not outstanding');
      expect(body(slug), slug).toContain('Do not create work to get past a blocked task');
      expect(body(slug), slug).toContain(
        'it has already had every attempt it is allowed, and it is waiting for a person',
      );
    }
  });

  it('tells the feature checkup the same rule one level up', () => {
    // A story whose task is blocked is itself settled. Without this, a feature checkup attacks the story
    // instead of the task, which is the same escape one level out.
    expect(body('checkup-feature')).toContain('A story carrying a blocked task is settled too');
  });

  it('tells every creating skill to read the board first', () => {
    // Decision 43: creating work is not idempotent, so a creating phase must look first. And one card per
    // call, never a shell loop the agent cannot verify.
    for (const slug of ['derive-features', 'break-down', 'checkup-story', 'checkup-feature']) {
      expect(body(slug), slug).toMatch(/read the board first/i);
      expect(body(slug), slug).toContain('one card per call');
    }
  });

  it('tells derive-features that the first feature is the scaffolding', () => {
    expect(body('derive-features')).toContain('scaffolding');
    expect(body('derive-features')).toContain('CODE-QUALITY.md');
    // And it must NOT ask the agent to flag it: the loop stamps that at the bootstrap's exit, from the board,
    // and `CreateCardInput` has no such field for an agent to set even if it tried.
    expect(body('derive-features')).not.toContain('setup: true');
  });

  // BESIDE the exact-bytes assertion above, never instead of it. That one catches a REWORDED sentence; this
  // one catches a REORDERING that leaves both sentences intact — "a user story breaks into features" reads
  // perfectly and is the wrong way up.
  //
  // THE PROSE, not the frontmatter: `boards: [features, product]` contains the word "features", so an indexOf
  // over the whole file matched the frontmatter and half this assertion was vacuous.
  it('names the spine in the right direction, as well as in the right words', () => {
    const prose = body('break-down').split('---')[2] ?? '';
    expect(prose.indexOf('user stories')).toBeGreaterThan(-1);
    expect(prose.indexOf('user stories')).toBeLessThan(prose.indexOf('tasks'));
    expect(prose.indexOf('**feature**')).toBeLessThan(prose.indexOf('user stories'));
  });

  it('tells fix to address the findings and nothing else', () => {
    // A fix that widens the card is a fix nobody asked for, and it spends the same budget as the one that
    // was asked for.
    expect(body('fix')).toContain('POST /api/suggestions');
    expect(body('fix')).toMatch(/do not widen/i);
  });

  it('tells review to change nothing and to answer with a verdict', () => {
    // "Change nothing" rather than "do not edit": a judge that fixes what it is judging is grading its own
    // work, and the credential grants it nothing on the board either way.
    expect(body('review')).toContain('Change nothing');
    expect(body('review')).toContain('verdict');
  });

  it('tells review it is judging ONE run, not the card’s whole history', () => {
    // The first hand-run's finding, in the skill as well as in the prompt: an earlier run on this card may
    // have succeeded, and its work is not this run's work.
    expect(body('review')).toMatch(/one run/i);
  });

  it('tells both checkups they do not move their own card', () => {
    // The loop stamps the column (decision 38). A checkup that moved its card would be a card advancing on
    // the say-so of the run being judged.
    for (const slug of ['checkup-story', 'checkup-feature']) {
      expect(body(slug), slug).toMatch(/do not move/i);
    }
  });

  it('tells the feature checkup the smoke result is evidence rather than a verdict', () => {
    // RULING 55. A feature whose smoke command fails is exactly what a person needs told about, so the run
    // decides what it means rather than being blocked by it.
    expect(body('checkup-feature')).toMatch(/evidence/i);
  });

  // RULING 64: a skill file states OBLIGATIONS, never facts the prompt owns. What is true right now — which
  // gates ran, what the reviewer said, which children are blocked — is the loop's to compute and the prompt's
  // to state, and a body that repeats it contradicts the prompt wrapped around it.
  it('does not tell review that auto-pilot ran the gates, which is false for a hand dispatch', () => {
    // The prompt says nobody ran them when nobody did. The obligation — read what it says — survives; the
    // claim about what happened does not.
    expect(body('review')).not.toMatch(/auto-pilot runs the gates/i);
    expect(body('review')).toContain('This prompt tells you what the gates did');
    expect(body('review')).toContain('Do not assume');
  });

  it('does not tell either checkup to close its own card while also telling it not to move one', () => {
    // Two required contracts, one of which cannot be carried out: the loop stamps the column, and a checkup
    // has no authority to close anything. What it owes is a report saying the work is finished.
    for (const slug of ['checkup-story', 'checkup-feature']) {
      expect(body(slug), slug).not.toMatch(/close it\b/i);
      expect(body(slug), slug).toContain('**say so in your report**');
      // And the obligation it replaced is still there, so this did not delete the rule with the wording.
      expect(body(slug), slug).toMatch(/is finished/i);
    }
    expect(body('checkup-feature')).not.toMatch(/you may close the feature/i);
  });

  it('promises the feature checkup the blocked list it is actually rendered', () => {
    // `checkupSection` renders ONE flat list of everything blocked beneath the card, at any depth. The body
    // promised each story's blocked descendants per story, which is a fact the prompt does not carry — so the
    // run either invents the attribution or reports that it could not.
    expect(body('checkup-feature')).toContain('ONE list of everything blocked');
    expect(body('checkup-feature')).toContain('not broken down per story');
  });
});

// THE THREE HAND-DISPATCH SKILLS the lifecycle never uses. Frozen as exact bytes, because "untouched" is a
// claim about this task and an assertion about a substring would not have held it.
const FROZEN: Record<string, string> = {
  execute: `---
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
  research: `---
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
  summarise: `---
name: Summarise
description: Condense the card and everything it links to
---
Summarise the card below together with every card it links to.

Say what the work is, what state it is in, and what is left. Keep it short
enough to read at a glance — this exists so someone returning to the card does
not have to read the whole chain.

Change nothing on disk except the report you are asked to write.
`,
};

describe('the skills the lifecycle does not use', () => {
  it('leaves the three hand-dispatch skills untouched', () => {
    for (const slug of ['execute', 'research', 'summarise']) {
      expect(SEED_SKILLS.find((s) => s.slug === slug)?.content, slug).toBe(FROZEN[slug]);
    }
  });
});
