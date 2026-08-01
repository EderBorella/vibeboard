import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SKILLS_DIR, skillRel } from '../core/layout.js';
import { dedupeSkills, type InvalidSkill, parseSkill, type Skill, type SkillParse } from '../core/skills.js';
import type { ProjectConfig } from '../core/types.js';

// Reading the skills folder. It is already a Project Control category (control-files.ts), so the
// user can create, rename, edit and delete skills with no new file plumbing.

export interface SkillCatalogue {
  skills: Skill[];
  invalid: InvalidSkill[];
}

// Read every skill folder. Sorted by slug so "first wins" for a duplicated name is decided by the
// name on disk and not by readdir order, which differs between filesystems.
export async function readSkills(root: string, config: ProjectConfig): Promise<SkillCatalogue> {
  let slugs: string[];
  try {
    const entries = await readdir(join(root, SKILLS_DIR), { withFileTypes: true });
    slugs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return { skills: [], invalid: [] }; // no skills folder — a project that has never had one
  }

  const parsed: SkillParse[] = [];
  for (const slug of slugs) {
    let content: string;
    try {
      content = await readFile(join(root, skillRel(slug, 'SKILL.md')), 'utf8');
    } catch {
      // A folder with no SKILL.md is not a skill — and it is not an invalid skill FILE either,
      // because there is no file. It used to be reported as one, which put a warning on every
      // card's skill rail that nothing in the app could clear: an empty folder has no file for
      // Project Control to select, so it could be neither seen nor deleted. Skipped instead.
      // Deleting a skill no longer leaves one behind (see deleteControlFile), and the Explorer
      // tab is where a folder that arrived some other way gets removed.
      continue;
    }
    parsed.push(parseSkill(slug, content, config));
  }
  return dedupeSkills(parsed);
}
