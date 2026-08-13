import type { CardProblem } from './board.js';
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
// `terminal` rather than the whole autopilot block, like `setupState`: a project written before the
// lifecycle has no block, and this must still answer.
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
  //
  // REQUIRED, and it used to default to `[]`. That default made the ABSENCE OF THE ARGUMENT read as the
  // absence of problems, so the whole three-valued answer below hung on every caller remembering an
  // optional parameter — and the one thing known about this parameter is that most callers did not pass
  // it. An empty array is still fine; it just has to be written by someone who meant it.
  problems: CardProblem[],
): SetupState {
  if (problems.length > 0) return 'unknown';
  const ids = setupSubtreeIds(cards);
  if (ids.size === 0) return 'finished'; // genuinely no barrier — see above
  const done = live(cards)
    .filter((c) => ids.has(c.id))
    .every((c) => (terminal[c.board] ?? []).includes(c.columnSlug));
  return done ? 'finished' : 'unfinished';
}
