import { listSkills, type SkillCatalogue } from '../../lib/api';
import { useFetched } from '../../lib/useFetched';

const EMPTY: SkillCatalogue = { skills: [], invalid: [] };

// The catalogue, refetched whenever `trigger` changes — pass the snapshot, so a SKILL.md written
// by the user or an agent reaches the rail without a reload. A failed fetch keeps the last good
// catalogue: an empty rail would read as "this project has no skills".
// `enabled` gates the fetch on holding a credential — see the note in useAutopilot: hooks run on mount
// before the render chooses the sign-in screen, so this asked for the catalogue with no cookie and took
// a 401 on every first load. A disabled fetch KEEPS the last value rather than clearing it, which is
// what stops the rail flickering empty.
export function useSkills(trigger: unknown, enabled = true): SkillCatalogue {
  // `trigger` is this hook's own parameter, so it changes between renders and IS a real dependency.
  // Its "fix" — dropping it — is exactly the defect test/use-skills.test.tsx pins ("refetches when
  // the trigger changes").
  return useFetched(listSkills, [trigger], EMPTY, { enabled }).value;
}
