import { childrenOf, liveCards } from './hierarchy.js';
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
// were all archived is the childless case, and a childless card does not roll up. Both that rule and
// the direction of the walk come from hierarchy.ts, which rollup and eligibility read too.

const live = liveCards;

// First in document order, which is the order the board itself reads in. Two flagged features is a
// mistake in the files rather than a tie to break, and taking the first is at least deterministic.
// Nothing surfaces the second one yet — readiness does not report it and the panel does not show it,
// so this tiebreak is currently silent. Worth fixing when the barrier is actually consumed.
export function setupFeature(cards: Card[]): Card | undefined {
  return live(cards).find((c) => c.board === 'features' && c.setup === true);
}

// HAS THIS PROJECT EVER HAD A SCAFFOLDING FEATURE — a different question from `setupFeature` above, and it
// reads a different set on purpose (decision 50).
//
// "Once" is a BOARD FACT, and an archived card is still a fact about this board: a feature somebody archived
// after the bootstrap stamped it must still count, or a second derivation would hand the flag to a card nobody
// chose — and under decision 51 that flag is what makes an absent gate set expected instead of a failure.
//
// `setupFeature` keeps reading LIVE cards only, because the subtree root the reviewer's exception is scoped to
// has to be a card that is actually on the board. Two questions, two functions.
export function hasSetupFeature(cards: Card[]): boolean {
  return cards.some((c) => c.board === 'features' && c.setup === true);
}

// THE ONE OPEN FOLLOW-UP (decision 50): a live features card carrying the flag whose column is not
// terminal. At most one at a time, and that invariant is the server's — a browser holding it would only
// hold it until two tabs did the same thing.
//
// The FLAG, never the title: a user can rename a card, and a card called "Follow-up 1" without the flag
// is a card somebody made by hand. When a feature checkup closes one, the next story carded out of a
// suggestion starts a new one rather than reopening a card recorded as finished.
//
// `terminal` rather than the whole autopilot block: a project written before the lifecycle has no
// block, and this must still answer.
//
// WITH NO BLOCK NOTHING IS TERMINAL, so on such a project a follow-up somebody moved to Done still reads as
// open and is reused. Deliberate, and stated because it looks like decision 50's forbidden reopen: it cannot
// un-do a ruling a checkup recorded, because a project with no block has no lifecycle to run at all — a
// missing block is `coverageProblems`' loudest refusal — so no checkup has ever closed anything there. The
// alternative reading, treating every column as terminal, would start a new wave for every suggestion.
export function openFollowUp(cards: Card[], terminal: Record<BoardName, string[]>): Card | undefined {
  return live(cards).find(
    (c) => c.board === 'features' && c.followUp === true && !(terminal.features ?? []).includes(c.columnSlug),
  );
}

// How many follow-ups this board has had, so the next one can say which wave it is. Counted from the
// FLAG for the same reason as above; a card titled like one but never flagged is nobody's wave.
export function followUpCount(cards: Card[]): number {
  return live(cards).filter((c) => c.board === 'features' && c.followUp === true).length;
}

export function setupSubtreeIds(cards: Card[]): Set<string> {
  const feature = setupFeature(cards);
  if (!feature) return new Set();
  const ids = new Set<string>([feature.id]);
  for (const product of childrenOf(feature, cards)) {
    ids.add(product.id);
    for (const engineering of childrenOf(product, cards)) ids.add(engineering.id);
  }
  return ids;
}

// NO `setupState`. Its three-valued answer — finished / unfinished / unknown — existed for the
// eligibility filter, whose only caller was eligibility.ts:101. The `unknown` case it was written for is
// NOT lost: any unreadable card still stops the loop, from the tick itself (core/tick.ts's
// `unreadableSentence`, finding C), which is the one route by which a broken file has to fail closed.
