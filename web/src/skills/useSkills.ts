import { listSkills, type SkillCatalogue } from '../api';
import { useFetched } from '../useFetched';

const EMPTY: SkillCatalogue = { skills: [], invalid: [] };

// The catalogue, refetched whenever `trigger` changes — pass the snapshot, so a SKILL.md written
// by the user or an agent reaches the rail without a reload. A failed fetch keeps the last good
// catalogue: an empty rail would read as "this project has no skills".
export function useSkills(trigger: unknown): SkillCatalogue {
  // `trigger` is this hook's own parameter, so it changes between renders and IS a real dependency.
  // Its "fix" — dropping it — is exactly the defect test/use-skills.test.tsx pins ("refetches when
  // the trigger changes").
  return useFetched(listSkills, [trigger], EMPTY).value;
}
