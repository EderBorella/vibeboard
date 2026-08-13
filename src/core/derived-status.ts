import { type AutopilotConfig, isBlockedColumn, isTerminalColumn } from './autopilot.js';
import { childrenOf } from './hierarchy.js';
import type { Card } from './types.js';

// What is under this card, read as a status. Two questions live here, and they answer differently on
// purpose:
//
//   SETTLED (decision 45) — done OR blocked. A blocked task has had every attempt it is allowed and is
//   waiting for a person, so it unblocks its story: the checkup runs, the story closes, and the machine
//   carries on. Stopping the project instead means one task nobody can fix costs you every feature after
//   it. AT BOTH LEVELS since the 2026-08-13 correction: a blocked STORY settles its feature the same way,
//   so the feature checkup can run over a feature holding one.
//
//   UNFINISHED CHILDREN — terminal only, so a blocked child still counts as unfinished. That is the
//   distinction that makes both functions necessary rather than one of them redundant.

// Settled, not terminal. `isBlockedColumn` already answers which boards have a blocked column at all
// (`BLOCKED_BOARDS`), so the board question is not re-asked here.
export function isSettled(ap: AutopilotConfig, card: Card): boolean {
  return (
    isTerminalColumn(ap, card.board, card.columnSlug) || isBlockedColumn(ap, card.board, card.columnSlug)
  );
}

// EVERY card, and at least one. `[].every()` is true, and a story nobody has broken down yet would then
// read as finished — the vacuous case that reports success over work that never happened.
export function allSettled(ap: AutopilotConfig, cards: Card[]): boolean {
  return cards.length > 0 && cards.every((c) => isSettled(ap, c));
}

// THE ONE HOME FOR DECISION 46, and the emptiness of this list IS the status. There was a `derivedStatus`
// beside it answering `clean` / `carrying-a-problem` over the same walk, and nothing called it: the wire
// computes the fact from here because it needs the IDS, not an enum — a badge saying "carrying a problem"
// with no name is one nobody can act on (server/snapshot.ts). Two spellings of one rule is the duplication
// decision 46 exists to avoid.
//
// Every blocked card below this one, through as many levels as there are. Recursion rather than a
// one-level walk because a feature's problem is often two levels down: its story is `done` and the task
// under that story is what is blocked, so a one-level walk calls the feature clean.
//
// A BLOCKED STORY IS ONE OF THEM (the 2026-08-13 correction). A feature carrying a story nobody could
// break down is carrying a problem, exactly as one carrying a blocked task is.
//
// DERIVED, NEVER STAMPED. Two reasons, the second mattering more day to day: one fact has one owner, and
// this SELF-HEALS — the user moves the blocked task to done and the story and the feature stop reporting a
// problem with nothing to remember to update.
//
// About what is UNDER the card, so a blocked task is not itself carrying a problem: it IS the fact.
//
// Terminates because `childrenOf` reads strictly down the fixed board order (hierarchy.ts:12-16).
export function blockedUnder(ap: AutopilotConfig, card: Card, cards: Card[]): Card[] {
  const found: Card[] = [];
  for (const child of childrenOf(card, cards)) {
    if (isBlockedColumn(ap, child.board, child.columnSlug)) found.push(child);
    found.push(...blockedUnder(ap, child, cards));
  }
  return found;
}

// A universal quantifier, so it passes vacuously for a childless card — deliberately: a card nobody has
// broken down yet is exactly what the break-down phase is for.
//
// RULING 62: moved here before slice 3 deleted eligibility.ts, where it lived with no test of its own
// anywhere — so deleting that file wholesale would have removed its only cover.
export function hasUnfinishedChildren(ap: AutopilotConfig, card: Card, cards: Card[]): boolean {
  return childrenOf(card, cards).some((child) => !isTerminalColumn(ap, child.board, child.columnSlug));
}
