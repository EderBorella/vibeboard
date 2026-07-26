import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  dedupeSkills,
  type InvalidSkill,
  parseSkill,
  type Skill,
  type SkillParse,
  skillPath,
} from '../core/skills.js';
import type { ProjectConfig } from '../core/types.js';

// Where skills live. Already a Project Control category (control-files.ts), so the user can
// create, rename, edit and delete them with no new file plumbing.
export const SKILLS_DIR = '.claude/skills';

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
    try {
      const content = await readFile(join(root, SKILLS_DIR, slug, 'SKILL.md'), 'utf8');
      parsed.push(parseSkill(slug, content, config));
    } catch {
      // A folder without SKILL.md is a half-made skill, not a skill. Saying so beats a folder
      // that silently never appears.
      parsed.push({
        ok: false,
        invalid: { slug, path: skillPath(slug), reason: 'no SKILL.md in the folder' },
      });
    }
  }
  return dedupeSkills(parsed);
}
