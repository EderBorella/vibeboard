import type { BoardName, Card } from './types.js';

// Which board sits above which. Links are symmetric and the conventions allow any pairing, so
// direction cannot come from a link itself — it comes from the fixed board order, and that is what
// makes a feature's children its product links and a product card's its engineering links.
//
// The rule below exists because rollup ADVANCES a parent when all its children are terminal. With an
// arbitrary graph a card can have two parents, and a "see also" link silently adopts an unrelated
// card — so a wrong edge does not merely look untidy, it finishes the wrong card.

const PARENT: Record<BoardName, BoardName | undefined> = {
  features: undefined, // the top of the hierarchy
  product: 'features',
  engineering: 'product',
};

export function parentBoardOf(board: BoardName): BoardName | undefined {
  return PARENT[board];
}

// Judges the WHOLE list, because the endpoint receives the complete set rather than one added edge:
// a payload that replaces a card's links can introduce a second parent without adding anything to
// what was there before.
//
// Silent about ids that name no card: a link to something that does not exist is a different problem
// with its own answer at the endpoint, and reporting it here would give one mistake two messages.
export function secondParentProblem(card: Card, links: string[], cards: Card[]): string | null {
  const parentBoard = parentBoardOf(card.board);
  if (!parentBoard) return null;
  const byId = new Map(cards.map((c) => [c.id, c]));
  // Deduped: the same id listed twice is a sloppy payload, not a second parent, and refusing it
  // would be a refusal naming one card as both halves of the conflict.
  const parents = [...new Set(links)].filter((id) => byId.get(id)?.board === parentBoard);
  if (parents.length < 2) return null;
  return `${card.id} would have two parents on the ${parentBoard} board: ${parents.slice(0, 2).join(' and ')}. The hierarchy auto-pilot rolls up is derived from links, so a card has one.`;
}

// The other direction, and the one that made the rule above advisory. Links are SYMMETRIC: writing
// this card's list also writes the back-reference onto every target (`setCardLinks` → `updateCard`,
// which checks nothing). So checking only the card in the URL leaves the parent side wide open —
// a run whose own card is P-002 links to E-001, P-002 gains no parent so the check passes, and
// E-001 ends up with two. Reproduced with a real `work` credential before this existed.
//
// It is also the whole of the features→product case: `parentBoardOf('features')` is undefined, so the
// child-side check returns early and a feature could adopt any number of product cards that already
// had parents.
export function farSideParentProblem(card: Card, links: string[], cards: Card[]): string | null {
  const desired = new Set(links);
  for (const target of cards) {
    // Only targets this card would be the PARENT of — the direction the back-reference creates.
    if (parentBoardOf(target.board) !== card.board) continue;
    if (!desired.has(target.id)) continue;
    // Its existing parents on this board, excluding us: re-linking a child we already own is not a
    // second parent, or every idempotent write would be refused.
    const existing = target.links
      .filter((id) => id !== card.id)
      .filter((id) => cards.find((c) => c.id === id)?.board === card.board);
    if (existing.length === 0) continue;
    return `${target.id} already has a parent on the ${card.board} board (${existing[0]}), so linking it to ${card.id} would give it two. The hierarchy auto-pilot rolls up is derived from links, so a card has one.`;
  }
  return null;
}

// Both directions, for the one caller that writes links. Separate functions above because each is a
// distinct claim worth testing on its own; one entry point here because a caller that checked only
// half of it is exactly the bug this fixes.
export function oneParentProblem(card: Card, links: string[], cards: Card[]): string | null {
  return secondParentProblem(card, links, cards) ?? farSideParentProblem(card, links, cards);
}
