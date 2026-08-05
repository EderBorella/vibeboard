import { type AutopilotConfig, isTerminalColumn, type Rollup } from './autopilot.js';
import { childrenOf, isLive } from './hierarchy.js';
import type { Card } from './types.js';

// Reading the rollup rules against a live board. A parent completes from its children rather than from
// a run of its own, so this is where "all children terminal" gets decided — and every fail-closed case
// in Principle 1 lives here, because the rule as written is a universal quantifier and a universal
// quantifier over nothing is true.
//
// `advance` moves the card with no dispatch and no cost. `eligible` only admits it to its route: a
// feature earns one close-out dispatch, because three engineering cards can each pass their own tests
// while the feature they compose does not work.

export interface RollupAdvance {
  card: Card;
  to: string; // column slug
}

export interface RollupOutcomes {
  advance: RollupAdvance[];
  eligible: string[]; // card ids a rule has admitted to their route
}

// The one thing a rule cannot decide for itself. THREE ways this answers no, and all three are the
// same mistake wearing different clothes — treating "no evidence of unfinished work" as evidence of
// finished work:
//   - no children at all: nobody has broken this card down yet;
//   - every child archived: the archived ones are excluded, which leaves the case above;
//   - one child outside its board's terminal columns.
function childrenSatisfy(ap: AutopilotConfig, card: Card, cards: Card[]): boolean {
  const children = childrenOf(card, cards);
  if (children.length === 0) return false;
  return children.every((child) => isTerminalColumn(ap, child.board, child.columnSlug));
}

function subjects(rule: Rollup, cards: Card[]): Card[] {
  return cards.filter((c) => isLive(c) && c.board === rule.board && c.columnSlug === rule.column);
}

export function rollupOutcomes(ap: AutopilotConfig, cards: Card[]): RollupOutcomes {
  const advance: RollupAdvance[] = [];
  const eligible: string[] = [];
  for (const rule of ap.rollup) {
    for (const card of subjects(rule, cards)) {
      if (!childrenSatisfy(ap, card, cards)) continue;
      if (rule.action === 'eligible') {
        eligible.push(card.id);
        continue;
      }
      // `next` is required of an `advance` rule and the cover check refuses a config without it. Fail
      // closed anyway: a rule that reached here incomplete must move nothing, rather than move a card
      // to a column named `undefined` — which on disk is a folder that does not exist.
      if (rule.next !== undefined) advance.push({ card, to: rule.next });
    }
  }
  return { advance, eligible };
}
