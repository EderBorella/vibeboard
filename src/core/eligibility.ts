import { attemptsUsed } from './accounting.js';
import { type AutopilotConfig, isTerminalColumn, type Route, routeFor } from './autopilot.js';
import type { CardProblem } from './board.js';
import { childrenOf, isLive, liveCards, parentOf } from './hierarchy.js';
import type { RunRecord } from './runs.js';
import { type SetupState, setupState, setupSubtreeIds } from './setup-feature.js';
import { BOARDS, type BoardName, type Card } from './types.js';

// Step 5 of the tick, and step 8's pick. Both are lookups over data — no clock, no disk, no model —
// which is what makes every boundary here assertable.
//
// Four filters, and each one exists because leaving it out has a named failure:
//   a route for the card's column   — an unrouted column is a card nothing can move (B3)
//   under the attempt cap           — otherwise a card that fails the same way for ever
//   inside the setup subtree, while the barrier is unfinished
//   the parent rule, plus the rollup's verdict where a rule asks for one

export interface Eligible {
  card: Card;
  route: Route;
  attemptsUsed: number;
}

export interface EligibilityInput {
  ap: AutopilotConfig;
  cards: Card[];
  runs: RunRecord[];
  // Ordered column slugs per board, from `boardColumnSlugs`. Only the pick reads them, and only to
  // break a tie — the routing table is what says a column is workable.
  columns: Record<BoardName, string[]>;
  rollupEligible: string[]; // card ids `rollupOutcomes` admitted to their route
  // Whatever `readBoard` could not parse. REQUIRED rather than optional: an optional list defaulting
  // to `[]` makes the absence of the argument read as the absence of problems, which is the fail-open
  // default the `unknown` barrier exists to prevent. Pass an empty array and mean it.
  problems: CardProblem[];
}

export interface EligibilitySet {
  eligible: Eligible[];
  // Cards that would be eligible but for the cap. The tick decides what happens to them: an
  // engineering card moves to the blocked column and the loop continues, anything else stops the run.
  blockedByAttempts: Eligible[];
  barrier: SetupState;
  setupIds: Set<string>; // the subtree the barrier covers, so a caller can tell it apart from one card
  // Why both lists are empty, when they are empty for a reason rather than for want of work. A refusal
  // the caller cannot explain is a dead end, and this is the sentence the stop carries.
  problem?: string;
}

// A universal quantifier, so it passes vacuously for a childless card — deliberately: a product card
// nobody has broken down yet is exactly what the break-down route is for. What holds the vacuous case
// shut for a CLOSE-OUT is the rollup, which requires at least one live child.
export function hasUnfinishedChildren(ap: AutopilotConfig, card: Card, cards: Card[]): boolean {
  const children = childrenOf(card, cards);
  return children.some((child) => !isTerminalColumn(ap, child.board, child.columnSlug));
}

// Whether this card's column earns its dispatch from a rollup rather than merely from having a route.
// `advance` rules are not consulted: they move the card themselves, before anything can dispatch.
function needsRollup(ap: AutopilotConfig, card: Card): boolean {
  return ap.rollup.some(
    (r) => r.action === 'eligible' && r.board === card.board && r.column === card.columnSlug,
  );
}

// The same shape as `invalidCap` in dispatch-gate.ts, for the same reason: `used >= NaN` is false, so a
// cap that is not a number does not raise the limit, it deletes it. Fail closed and name the field.
function invalidAttemptCap(ap: AutopilotConfig): string | undefined {
  if (Number.isInteger(ap.attemptCap) && ap.attemptCap > 0) return undefined;
  return `attemptCap is ${JSON.stringify(ap.attemptCap)}, which is not a whole number above zero, so no attempt cap can bind. Set it in Settings.`;
}

function unreadableSentence(problems: CardProblem[]): string {
  const first = problems[0];
  const rest = problems.length > 1 ? ` (and ${problems.length - 1} more)` : '';
  return `${first?.path} could not be read: ${first?.reason}${rest}. Until every card parses, VibeBoard cannot tell whether the setup feature is finished, so nothing is eligible.`;
}

// Whether there is work here at all, and which route would do it. Everything EXCEPT the attempt cap,
// because the cap decides which list a card lands in rather than whether it is workable — a card at
// the cap is still work, which is the whole reason the loop has something to say about it.
function workableRoute(
  input: EligibilityInput,
  card: Card,
  barrier: SetupState,
  setupIds: Set<string>,
): Route | undefined {
  const { ap, cards, rollupEligible } = input;
  if (!isLive(card)) return undefined;
  if (barrier === 'unfinished' && !setupIds.has(card.id)) return undefined;
  const route = routeFor(ap, card.board, card.columnSlug);
  if (!route) return undefined;
  if (hasUnfinishedChildren(ap, card, cards)) return undefined;
  if (needsRollup(ap, card) && !rollupEligible.includes(card.id)) return undefined;
  return route;
}

export function eligibility(input: EligibilityInput): EligibilitySet {
  const { ap, cards, runs, problems } = input;
  const setupIds = setupSubtreeIds(cards);
  const barrier = setupState(cards, ap.terminal, problems);
  const nothing = { eligible: [], blockedByAttempts: [], barrier, setupIds };
  if (barrier === 'unknown') return { ...nothing, problem: unreadableSentence(problems) };
  const capProblem = invalidAttemptCap(ap);
  if (capProblem) return { ...nothing, problem: capProblem };

  const eligible: Eligible[] = [];
  const blockedByAttempts: Eligible[] = [];
  for (const card of cards) {
    const route = workableRoute(input, card, barrier, setupIds);
    if (!route) continue;
    const used = attemptsUsed(runs, card.id, route.skill);
    (used >= ap.attemptCap ? blockedByAttempts : eligible).push({ card, route, attemptsUsed: used });
  }
  return { eligible, blockedByAttempts, barrier, setupIds };
}

// ── the pick ────────────────────────────────────────────────────────────────────────────────────
//
// One card, chosen by a fixed order so the same board always yields the same dispatch:
//
//   a. the earliest incomplete feature, by `order` then id
//   b. within it, the card furthest DOWN the pipeline — engineering before product before features,
//      because a parent cannot roll up until its children are finished
//   c. the later column, which is the same idea one level in: work already started finishes before
//      new work begins
//   d. the card's own `order`, then its id, so nothing is left to chance

// Beyond any real feature's rank, and finite.
//
// This comment used to claim `Infinity` would be a BUG, because `Infinity - Infinity` is NaN and a NaN
// falls through to the next tie-break. The premise is right and the conclusion was wrong: falling
// through is exactly what tying does, so `Infinity` behaves identically here and the two orphan cards
// would compare the same way either round. A wrong reason is worse than no reason, because it tells the
// next reader the comparator is fragile in a way it is not.
//
// The finite sentinel stays as a choice, not a fix: a comparator that never produces NaN is one whose
// behaviour survives being rewritten in a style where NaN does not happen to be harmless — `Math.sign`,
// or a sort that reads the sign of the raw difference.
const NO_FEATURE = Number.MAX_SAFE_INTEGER;

// Up the hierarchy to the feature this card serves, one step at a time through `parentOf` — which reads
// the same side of the relation `childrenOf` does. This used to search the CHILD's links instead, so on a
// hand-edited board the rollup and the pick disagreed about who a card's parent was. The walk terminates
// because each step moves strictly up the board order.
function featureOf(card: Card, cards: Card[]): Card | undefined {
  let current: Card | undefined = card;
  while (current && current.board !== 'features') {
    current = parentOf(current, cards);
  }
  return current;
}

// Incomplete features, in the order they will be worked. A feature already in a terminal column is not
// ranked at all: a stray eligible card underneath one is not a reason to reopen it ahead of the
// features still being built.
function featureRanks(input: EligibilityInput): Map<string, number> {
  const features = liveCards(input.cards)
    .filter((c) => c.board === 'features' && !isTerminalColumn(input.ap, c.board, c.columnSlug))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Map(features.map((c, index) => [c.id, index]));
}

interface Ranked {
  entry: Eligible;
  feature: number;
  depth: number;
  column: number;
  order: number;
  id: string;
}

function rank(entry: Eligible, input: EligibilityInput, ranks: Map<string, number>): Ranked {
  const feature = featureOf(entry.card, input.cards);
  return {
    entry,
    feature: (feature && ranks.get(feature.id)) ?? NO_FEATURE,
    // BOARDS is ordered highest level of project management first, which is the same order the
    // hierarchy runs in — so its index IS the depth. Read from there rather than written out again.
    depth: BOARDS.indexOf(entry.card.board),
    // -1 for a column the config does not list, which sorts it last among its board. Such a card is
    // not on the board at all (`readBoard` reads configured folders only), so this is a guard rather
    // than a case — but treating it as column zero would make it the first thing picked.
    column: (input.columns[entry.card.board] ?? []).indexOf(entry.card.columnSlug),
    order: entry.card.order,
    id: entry.card.id,
  };
}

function compare(a: Ranked, b: Ranked): number {
  return (
    a.feature - b.feature ||
    b.depth - a.depth ||
    b.column - a.column ||
    a.order - b.order ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function pickNext(eligible: Eligible[], input: EligibilityInput): Eligible | undefined {
  if (eligible.length === 0) return undefined;
  const ranks = featureRanks(input);
  return eligible.map((entry) => rank(entry, input, ranks)).sort(compare)[0]?.entry;
}
