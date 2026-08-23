import type { Skill } from '../../lib/api';
import type { BoardName } from '../../lib/shared';

// The same rule as skillsForCard in src/core/skills.ts — deliberately duplicated, because the web
// bundle cannot import server core (web/src/lib/shared.ts exists for the same reason). Agreement is
// asserted by test/mirror.test.ts, so changing one side alone fails the suite.
export function skillsForCard(skills: Skill[], board: BoardName, columnSlug: string): Skill[] {
  return skills.filter(
    (s) =>
      (s.boards.length === 0 || s.boards.includes(board)) &&
      (s.columns.length === 0 || s.columns.includes(columnSlug)),
  );
}
