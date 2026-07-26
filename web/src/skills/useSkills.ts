import { useEffect, useState } from 'react';
import { listSkills, type SkillCatalogue } from '../api';

const EMPTY: SkillCatalogue = { skills: [], invalid: [] };

// The catalogue, refetched whenever `trigger` changes — pass the snapshot, so a SKILL.md written
// by the user or an agent reaches the rail without a reload. A failed fetch keeps the last good
// catalogue: an empty rail would read as "this project has no skills".
export function useSkills(trigger: unknown): SkillCatalogue {
  const [catalogue, setCatalogue] = useState<SkillCatalogue>(EMPTY);
  // `trigger` is this hook's own parameter, so it changes between renders and IS a real dependency —
  // Biome only sees an outer-scope value. Its "fix" is exactly the defect
  // test/use-skills.test.tsx pins ("refetches when the trigger changes").
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate trigger
  useEffect(() => {
    let live = true;
    listSkills()
      .then((c) => {
        if (live) setCatalogue(c);
      })
      .catch(() => {
        /* keep what we had; the next trigger retries */
      });
    return () => {
      live = false;
    };
  }, [trigger]);
  return catalogue;
}
