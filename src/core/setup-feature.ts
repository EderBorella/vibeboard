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
// mistake in the files rather than a tie to break, and taking the first is at least deterministic;
// the readiness panel is where a person would see that there are two.
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

// No barrier means nothing to wait for — deliberately true rather than false. This is the one place
// where absence is not a blocker: a project that never had a setup feature (an adopted repo, a board
// someone built by hand) must not be frozen out of its own lifecycle by a card nobody wrote.
export function setupIsFinished(cards: Card[], terminal: Record<BoardName, string[]>): boolean {
  const ids = setupSubtreeIds(cards);
  if (ids.size === 0) return true;
  return live(cards)
    .filter((c) => ids.has(c.id))
    .every((c) => (terminal[c.board] ?? []).includes(c.columnSlug));
}
