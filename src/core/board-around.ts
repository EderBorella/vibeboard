import { childrenOf, liveCards, parentOf } from './hierarchy.js';
import type { PhaseName } from './phases.js';
import type { Card } from './types.js';

// THE PART OF THE BOARD A PHASE WOULD OTHERWISE GO AND FETCH (decision 90). The break-down skill says to read
// the board first, and every break-down did: it pulled the whole board and spent turns working out its shape
// before it had read a line of code. The loop already holds that board, so it hands over the slice the
// question needs — what is under the card, and what sits beside it.
export interface BoardAround {
  // The card one level up, when there is one. A feature has none.
  parent?: Card;
  // The parent's other children, each with its own children — or, for a feature, the other features alone.
  siblings: { card: Card; children: Card[] }[];
  // What is already under this card. Absent for the feature checkup, whose prompt lists its stories already.
  children?: Card[];
}

// Which phases get one. The two break-downs, because "what already exists" is their first question; the
// feature checkup, because it is told the same, and it may create stories that another feature holds.
const SLICED: ReadonlySet<PhaseName> = new Set(['story-breakdown', 'feature-breakdown', 'feature-checkup']);

export function boardAroundFor(
  phase: PhaseName | undefined,
  card: Card,
  cards: Card[],
): BoardAround | undefined {
  if (phase === undefined || !SLICED.has(phase)) return undefined;
  const children = phase === 'feature-checkup' ? {} : { children: childrenOf(card, cards) };
  if (card.board === 'features') {
    const others = liveCards(cards).filter((c) => c.board === 'features' && c.id !== card.id);
    return { siblings: others.map((c) => ({ card: c, children: [] })), ...children };
  }
  const parent = parentOf(card, cards);
  const beside = parent ? childrenOf(parent, cards).filter((c) => c.id !== card.id) : [];
  return {
    ...(parent ? { parent } : {}),
    siblings: beside.map((c) => ({ card: c, children: childrenOf(c, cards) })),
    ...children,
  };
}
