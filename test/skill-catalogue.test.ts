import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { readSkills } from '../src/server/skill-catalogue.js';
import { tempDir } from './helpers.js';

const config = defaultConfig('T');

async function withSkills(files: Record<string, string>): Promise<string> {
  const root = await tempDir();
  for (const [slug, content] of Object.entries(files)) {
    await mkdir(join(root, '.claude', 'skills', slug), { recursive: true });
    await writeFile(join(root, '.claude', 'skills', slug, 'SKILL.md'), content, 'utf8');
  }
  return root;
}

const file = (name: string, extra = ''): string =>
  `---\nname: ${name}\ndescription: does ${name}\n${extra}---\nPrompt for ${name}.\n`;

describe('readSkills', () => {
  it('is empty for a project with no skills folder, rather than throwing', async () => {
    expect(await readSkills(await tempDir(), config)).toEqual({ skills: [], invalid: [] });
  });

  it('reads every skill folder, in slug order', async () => {
    const root = await withSkills({ review: file('Review'), execute: file('Execute') });
    const { skills, invalid } = await readSkills(root, config);
    expect(skills.map((s) => s.slug)).toEqual(['execute', 'review']);
    expect(skills[0].prompt).toBe('Prompt for Execute.');
    expect(invalid).toEqual([]);
  });

  it('ignores a folder with no SKILL.md — it is not a skill, and not an invalid file either', async () => {
    // This USED to be reported as `invalid: no SKILL.md in the folder`, on the reasoning that
    // silence was worse than a warning. In practice the warning was unclearable: it appears on
    // every card's skill rail, and an empty folder has no file for Project Control to select, so
    // nothing in the app could remove it. Reporting a missing file as an invalid file was also
    // just untrue. A folder that arrives this way is now silent, and the Explorer tab is where it
    // gets deleted.
    const root = await withSkills({ execute: file('Execute') });
    await mkdir(join(root, '.claude', 'skills', 'empty'), { recursive: true });
    const { skills, invalid } = await readSkills(root, config);
    expect(skills.map((s) => s.slug)).toEqual(['execute']);
    expect(invalid).toEqual([]);
  });

  it('still reports a SKILL.md that is really there and really wrong', async () => {
    // The distinction that matters: a missing file is not a finding, a broken one is.
    const root = await withSkills({ broken: '---\nname: Broken\n---\nno description\n' });
    await mkdir(join(root, '.claude', 'skills', 'empty'), { recursive: true });
    const { skills, invalid } = await readSkills(root, config);
    expect(skills).toEqual([]);
    expect(invalid.map((i) => i.slug)).toEqual(['broken']);
  });

  it('separates an invalid file from the valid ones', async () => {
    const root = await withSkills({
      execute: file('Execute'),
      broken: '---\nname: Broken\n---\nno description\n',
    });
    const { skills, invalid } = await readSkills(root, config);
    expect(skills.map((s) => s.slug)).toEqual(['execute']);
    expect(invalid.map((i) => [i.slug, i.reason])).toEqual([['broken', 'needs a description']]);
  });

  it('resolves a duplicated name by slug order, so the result never depends on the filesystem', async () => {
    // Both declare "Execute"; `a-run` sorts first, so it wins on every machine.
    const root = await withSkills({ 'z-run': file('Execute'), 'a-run': file('Execute') });
    const { skills, invalid } = await readSkills(root, config);
    expect(skills.map((s) => s.slug)).toEqual(['a-run']);
    expect(invalid.map((i) => i.slug)).toEqual(['z-run']);
  });

  it('returns a sorted list whatever order the filesystem hands the folders back in', async () => {
    // Twelve folders created in a shuffled order. readdir returns hash order on ext4, so this is
    // what actually witnesses the sort — a two-folder fixture can come back already sorted by
    // chance, in which case removing the sort changes nothing.
    const names = ['m3', 'a9', 'z1', 'q7', 'b2', 'y8', 'c5', 'x4', 'd6', 'w0', 'e1', 'v2'];
    const root = await withSkills(Object.fromEntries(names.map((n) => [n, file(n)])));
    const { skills } = await readSkills(root, config);
    expect(skills.map((s) => s.slug)).toEqual([...names].sort());
  });

  it('ignores a loose file sitting beside the skill folders', async () => {
    const root = await withSkills({ execute: file('Execute') });
    await writeFile(join(root, '.claude', 'skills', 'README.md'), '# not a skill\n', 'utf8');
    const { skills, invalid } = await readSkills(root, config);
    expect(skills.map((s) => s.slug)).toEqual(['execute']);
    expect(invalid).toEqual([]);
  });
});
