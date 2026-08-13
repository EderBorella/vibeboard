import { isBlockedColumn } from './autopilot.js';
import { boardColumnSlugs } from './board.js';
import type { BoardName, ProjectConfig } from './types.js';

// WHERE A BOARD IS ENTERED: its first column, POSITIONALLY, and `undefined` rather than a fallback when that
// column is one nothing can continue from. The loop stamps `todo` itself when it starts a break-down (decision
// 37 superseded), so `backlog` — the top of the board — is where a created card belongs.
//
// IN CORE RATHER THAN IN A ROUTE. It lived in `routes/cards.ts` and `routes/suggestions.ts` imported it from
// there — a route importing a route, which is how one derivation ends up with two homes: the alternative
// anybody reaches for is a second copy, and a second copy is how one path refuses a terminal first column
// while the other quietly creates a card in it. It is a derivation from the board's own configuration and
// belongs beside the other ones.
//
// "Every board opens with a Backlog" is a SCAFFOLDER DEFAULT, not an invariant: columns can be renamed and
// reordered, and a review pointed out that on a board whose first column happened to be terminal this stamp
// would put every child card exactly where it exists to stop one going — standing as a live card in a
// terminal column, which is the positive evidence `complete` reads. Refused rather than worked around,
// because there is no other column a card can be said to enter at.
//
// `Array.isArray` and the string compare because `autopilot` is parsed YAML: a hand-edited block arrives as
// whatever was in the file, and reading a member off it is a 500 handed to the caller least able to interpret
// one.
export function entryColumn(config: ProjectConfig, board: BoardName): string | undefined {
  const slug = boardColumnSlugs(config, board)[0];
  if (slug === undefined) return undefined;
  const terminal = config.autopilot?.terminal?.[board];
  if (Array.isArray(terminal) && terminal.includes(slug)) return undefined;
  // THROUGH `isBlockedColumn`, not a second copy of the rule: which boards have a blocked column is one
  // fact (`BLOCKED_BOARDS`), and stating it twice is how one path refuses an entry the other allows —
  // which is the very failure the comment above records for this function's own history. A card is put in
  // `blocked` when it has exhausted its attempts, so a new one created there is work nothing picks up.
  const ap = config.autopilot;
  if (ap && typeof ap.blockedColumn === 'string' && isBlockedColumn(ap, board, slug)) return undefined;
  return slug;
}
