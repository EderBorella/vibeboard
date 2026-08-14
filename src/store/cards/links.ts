import { rm } from 'node:fs/promises';
import { oneParentProblem } from '../../core/hierarchy.js';
import { BOARDS, type Card, type ProjectConfig } from '../../core/types.js';
import { readBoard, spentIds } from './board.js';
import { type CreateCardInput, createCard, updateCard } from './mutations.js';

// Set `card`'s links to exactly `desired` and keep the relationship symmetric: every
// desired target gains this card's id, and any live card that referenced this card but is
// no longer desired loses it. Only live cards are reconciled; non-live / self ids are
// ignored. Idempotent — safe to call on both create and edit.
export async function setCardLinks(
  projectRoot: string,
  config: ProjectConfig,
  card: Card,
  desired: string[],
  // Ids that were asked for, exist as a file, and could not be read. Dropping an id that names no
  // card at all is the documented contract; dropping one whose file is sitting right there is a
  // different fact, and it used to be indistinguishable — `break-down` could link a child, be told
  // it succeeded, and leave an orphan.
  unreadable?: string[],
): Promise<Card> {
  const self = card.id;
  const desiredSet = new Set(desired.filter((id) => id !== self));

  const perBoard = await Promise.all(BOARDS.map((board) => readBoard(projectRoot, board, config)));
  const all = perBoard.flat();
  const liveIds = new Set(all.map((c) => c.id));

  if (unreadable) {
    const missing = [...desiredSet].filter((id) => !liveIds.has(id));
    if (missing.length > 0) {
      // Only pay for the directory listing when something is actually missing.
      const onDisk = new Set(
        (await Promise.all(BOARDS.map((board) => spentIds(projectRoot, board, config)))).flat(),
      );
      unreadable.push(...missing.filter((id) => onDisk.has(id)));
    }
  }

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

// A CREATE THAT CARRIES LINKS, and the only door onto one (ruling 65). `CreateCardInput` used to have a `links`
// field that `createCard` wrote into the new card's frontmatter directly, never through the writer above — so
// the far side was never written, and both `childrenOf` and `parentOf` read the far side. Two tasks were
// created that way on the first real run, echoed their parent's id back to the agent, and were orphans.
//
// `oneParentProblem` runs here as it does on the links route, because writing this card's links writes the
// back-reference onto every target: the create path could give an existing card a second parent, which is the
// far-side half that check exists for.
export async function createLinkedCard(
  projectRoot: string,
  config: ProjectConfig,
  input: CreateCardInput,
  links: string[],
  today: string,
  // The links route's policy, decided by the caller because it turns on the credential: many-to-many is
  // legitimate when a person means it, and only the DERIVED HIERARCHY cannot survive it — two parents make
  // "whose child is this" unanswerable, and that is the question the checkup asks before it advances one.
  enforceOneParent = true,
): Promise<Card | 'unknown-column' | { problem: string }> {
  const card = await createCard(projectRoot, config, input, today);
  if (card === 'unknown-column' || links.length === 0) return card;
  if (enforceOneParent) {
    const all = (await Promise.all(BOARDS.map((board) => readBoard(projectRoot, board, config)))).flat();
    const problem = oneParentProblem(card, links, all);
    // JUDGED AFTER THE CREATE, because both of that check's sentences name the card and the id does not exist
    // until the file does. So a refused card is taken back off the board rather than left standing with none
    // of the links it was created for — the caller gets a refusal, not a half-made card.
    if (problem) {
      await rm(card.filePath, { force: true });
      return { problem };
    }
  }
  return setCardLinks(projectRoot, config, card, links);
}
