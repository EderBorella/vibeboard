import { slugify } from '../../core/slug.js';
import type { BoardName, Card, ProjectConfig } from '../../core/types.js';
import { placeCard } from '../../store/cards/mutations.js';
import { resolveCardRuns } from '../../store/run-store.js';
import { nowIso } from '../route-context.js';

// A card in its board's last column is closed, so nothing on it is still waiting for a decision.
// Which column that is comes from the config rather than a name: "done" is a convention, and a
// project may call it anything.
function isClosingColumn(config: ProjectConfig, board: BoardName, columnSlug: string): boolean {
  const last = config.boards[board].columns.at(-1);
  return last !== undefined && slugify(last) === columnSlug;
}

// Every move of a card to a column goes through here — a drag, a place, a person's run that succeeded — so
// the resolve-on-close rule has one home.
export async function moveCard(
  root: string,
  config: ProjectConfig,
  card: Card,
  toColumnSlug: string,
  beforeId: string | null,
): Promise<Card | 'unknown-column'> {
  const placed = await placeCard(root, config, card, toColumnSlug, beforeId);
  // Closing a card resolves its runs. Done on the move rather than in the watcher: writing run
  // records in response to filesystem events, inside the folder the watcher watches, is a loop —
  // so a card moved by an agent editing files directly still needs Dismiss.
  if (placed !== 'unknown-column' && isClosingColumn(config, card.board, placed.columnSlug)) {
    await resolveCardRuns(root, card.board, placed.id, nowIso());
  }
  return placed;
}
