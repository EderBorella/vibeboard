// --- Skills ---------------------------------------------------------------
// Mirrors src/core/skills.ts. A skill carries no backend, model, effort or mode — those are
// chosen per dispatch, so every skill works on every backend.

import type { BoardName } from '../shared';
import { put, request } from './http';

export interface Skill {
  slug: string;
  path: string;
  name: string;
  description: string;
  boards: BoardName[];
  columns: string[];
  prompt: string;
}

// A skill file that failed validation: absent from the rail, reported with its reason so it is
// distinguishable from a skill nobody wrote.
export interface InvalidSkill {
  slug: string;
  path: string;
  reason: string;
}

export interface SkillCatalogue {
  skills: Skill[];
  invalid: InvalidSkill[];
}

export async function listSkills(): Promise<SkillCatalogue> {
  return (await request('/api/skills')).json() as Promise<SkillCatalogue>;
}

// Write a skill from its fields; the server serialises the YAML and answers with the catalogue as it
// now reads it — including a validation failure the fields alone could not predict.
export function putSkill(
  slug: string,
  fields: {
    name: string;
    description: string;
    boards: BoardName[];
    columns: string[];
    prompt: string;
  },
): Promise<SkillCatalogue> {
  return put<SkillCatalogue>(`/api/skills/${encodeURIComponent(slug)}`, fields);
}
