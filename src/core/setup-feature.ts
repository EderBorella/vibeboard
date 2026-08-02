import type { CardProblem } from './board.js';
import { ARCHIVE_SLUG } from './layout.js';
import type { BoardName, Card } from './types.js';

// The setup feature and the cards it covers. It establishes the stack, the tooling, the logging, the
// test harness and the design decisions, and while it is unfinished nothing outside its subtree is
// eligible — which is what makes "one feature at a time" safe rather than repetitive: the shared
// architectural decisions are made once, not re-argued per feature.
//
// Direction comes from the BOARD, not from a frontmatter field. Links are symmetric, but the
// hierarchy is fixed: a feature's children are its linked cards on product, and a product card's are
// its linked cards on engineering.
//
// An ARCHIVED card is excluded entirely — it neither blocks nor satisfies. A subtree whose children
// were all archived is the childless case, and a childless card does not roll up.

const isLive = (card: Card): boolean => card.columnSlug !== ARCHIVE_SLUG && card.archived === undefined;

const live = (cards: Card[]): Card[] => cards.filter(isLive);

// First in document order, which is the order the board itself reads in. Two flagged features is a
// mistake in the files rather than a tie to break, and taking the first is at least deterministic.
// Nothing surfaces the second one yet — readiness does not report it and the panel does not show it,
// so this tiebreak is currently silent. Worth fixing when the barrier is actually consumed.
export function setupFeature(cards: Card[]): Card | undefined {
  return live(cards).find((c) => c.board === 'features' && c.setup === true);
}

export function setupSubtreeIds(cards: Card[]): Set<string> {
  const feature = setupFeature(cards);
  if (!feature) return new Set();
  const alive = live(cards);
  const byId = new Map(alive.map((c) => [c.id, c]));
  const childrenOf = (card: Card, board: BoardName): Card[] =>
    card.links.map((id) => byId.get(id)).filter((c): c is Card => c !== undefined && c.board === board);

  const ids = new Set<string>([feature.id]);
  for (const product of childrenOf(feature, 'product')) {
    ids.add(product.id);
    for (const engineering of childrenOf(product, 'engineering')) ids.add(engineering.id);
  }
  return ids;
}

// Three states, not two, and the third is the point.
//
// `readBoard` DROPS any card whose file will not parse (core/board.ts) — it reports it through the
// optional `problems` array, which most callers do not pass. So a setup feature with one bad YAML
// quote simply is not in `cards`, `setupSubtreeIds` finds nothing, and a boolean would answer
// "finished": the barrier the whole design rests on lifts in silence and auto-pilot starts building
// features before the stack exists.
//
// "No barrier" and "we cannot tell" are different facts. The first is deliberately not a blocker — an
// adopted repo, or a board someone built by hand, must not be frozen out of its own lifecycle by a
// card nobody wrote. The second must never advance anything. Same distinction `foundation.ts` draws
// between a document that is absent and one that will not parse.
export type SetupState = 'finished' | 'unfinished' | 'unknown';

export function setupState(
  cards: Card[],
  terminal: Record<BoardName, string[]>,
  // Whatever `readBoard` could not parse. ANY unreadable card makes this unknown, not just one on the
  // features board: the broken file could be the barrier, a child that would extend the subtree, or a
  // descendant sitting outside a terminal column.
  problems: CardProblem[] = [],
): SetupState {
  if (problems.length > 0) return 'unknown';
  const ids = setupSubtreeIds(cards);
  if (ids.size === 0) return 'finished'; // genuinely no barrier — see above
  const done = live(cards)
    .filter((c) => ids.has(c.id))
    .every((c) => (terminal[c.board] ?? []).includes(c.columnSlug));
  return done ? 'finished' : 'unfinished';
}
