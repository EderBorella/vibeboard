import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
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
    await rm(join(root, '.claude', 'skills', SEED_SKILLS[0].slug), { recursive: true });

    expect(await seedSkills(root)).toBe(false);
    const { skills } = await readSkills(root, config);
    expect(skills.map((s) => s.slug)).not.toContain(SEED_SKILLS[0].slug);
  });

  it('leaves an adopted repo that already has its own skills untouched', async () => {
    const root = await tempDir();
    await mkdir(join(root, '.claude', 'skills', 'their-skill'), { recursive: true });
    expect(await seedSkills(root)).toBe(false);
    const { skills, invalid } = await readSkills(root, config);
    expect([...skills.map((s) => s.slug), ...invalid.map((i) => i.slug)]).toEqual(['their-skill']);
  });

  it('does not edit a seed already on disk', async () => {
    const root = await tempDir();
    await seedSkills(root);
    const path = join(root, '.claude', 'skills', SEED_SKILLS[0].slug, 'SKILL.md');
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
