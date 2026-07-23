import { readBoard } from './board.js';
import { updateCard } from './mutations.js';
import { BOARDS, type BoardName, type Card, type ProjectConfig } from './types.js';

// Link target ids are self-describing: "F-###" feature, "P-###" product, "E-###" engineering.
export function boardOfId(id: string): BoardName {
  if (id.startsWith('F')) return 'features';
  if (id.startsWith('P')) return 'product';
  return 'engineering';
}

// Set `card`'s links to exactly `desired` and keep the relationship symmetric: every
// desired target gains this card's id, and any live card that referenced this card but is
// no longer desired loses it. Only live cards are reconciled; non-live / self ids are
// ignored. Idempotent — safe to call on both create and edit.
export async function setCardLinks(
  projectRoot: string,
  config: ProjectConfig,
  card: Card,
  desired: string[],
): Promise<Card> {
  const self = card.id;
  const desiredSet = new Set(desired.filter((id) => id !== self));

  const perBoard = await Promise.all(BOARDS.map((board) => readBoard(projectRoot, board, config)));
  const all = perBoard.flat();
  const liveIds = new Set(all.map((c) => c.id));

  // Reconcile every other live card's back-reference to `self`.
  for (const other of all) {
    if (other.id === self) continue;
    const has = other.links.includes(self);
    const should = desiredSet.has(other.id);
    if (should && !has) {
      await updateCard(projectRoot, other, { links: [...other.links, self] });
    } else if (!should && has) {
      await updateCard(projectRoot, other, { links: other.links.filter((l) => l !== self) });
    }
  }

  // Write this card's own links: desired ids that resolve to a live card.
  const ownLinks = [...desiredSet].filter((id) => liveIds.has(id));
  return updateCard(projectRoot, card, { links: ownLinks });
}
