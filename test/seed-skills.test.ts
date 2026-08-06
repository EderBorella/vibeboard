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

  // THE FIRST HAND-RUN. F-002 — itself a card `derive-features` had just created in features/backlog — was
  // dispatched `derive-features`, reported "nothing needed to be created", was PASSED by the critic and
  // advanced. A card advanced for doing nothing, and two iterations went with it. The output column is the
  // fix: todo is where a feature waits to be broken down, which is what actually comes next for it.
  it('tells derive-features to put its features where they will be broken down, not back in its own column', () => {
    const content = SEED_SKILLS.find((s) => s.slug === 'derive-features')?.content ?? '';
    expect(content).toContain('features/todo');
    // The reason, not only the instruction: an agent that knows WHY does not reason its way out of it.
    expect(content).toMatch(/never in the column this card is in/i);
  });

  // One group is one vertical: a feature, its user stories, their tasks. The rule has to be evaluable from
  // the card in front of the agent, which is why it is "this card's group, or else this card's id" — that
  // yields the feature's id at every level without the agent needing to walk the link graph.
  it('tells break-down to carry the vertical’s group down to every card it creates', () => {
    const content = SEED_SKILLS.find((s) => s.slug === 'break-down')?.content ?? '';
    expect(content).toContain('`group`');
    expect(content).toMatch(/own .?group.? if it has one, and otherwise this card's id/i);
  });

  it('tells break-down what the level below is called at each level', () => {
    const content = SEED_SKILLS.find((s) => s.slug === 'break-down')?.content ?? '';
    expect(content).toMatch(/user stories.+product board/is);
    expect(content).toMatch(/tasks.+engineering/is);
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
