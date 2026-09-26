import { type AutopilotConfig, isBlockedColumn, isTerminalColumn } from './autopilot.js';
import { childrenOf } from './hierarchy.js';
import type { Card } from './types.js';

// What is under this card, read as a status. The questions here answer differently on purpose — the two
// below, and `isJudgeable` further down, which asks only whether a story's judgement may run:
//
//   SETTLED (decision 45) — done OR blocked. A blocked card is waiting for a person, so it unblocks the
//   level above: the judgement runs, the parent closes, and the machine carries on. Stopping the project
//   instead means one card nobody can fix costs you every feature after it. AT BOTH LEVELS since the
//   2026-08-13 correction: a blocked STORY settles its feature the same way, so the feature checkup can
//   run over a feature holding one.
//
//   WHO PUTS A CARD THERE has changed and the rule has not. Decision 45 was written about a TASK that had
//   used every attempt; since decision 83 the loop blocks a STORY — the caps it counts are the story's —
//   and a blocked task is one a person dragged there. Either way it is settled for the same reason: what
//   is waiting for a person must not hold up the card above it.
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

// THE STRICTER OF THE TWO, and the distinction at the head of this file is the whole of why it exists
// separately: a blocked card SETTLES the level above it, because it is waiting for a person and must not
// hold up its parent — but nothing about it has been DONE. `creatingRoundStop` asks the second question
// (decision 86): a feature's checkup may look again once the work it created has been finished, and a
// story of its own that nobody could finish is precisely the case whose sentence says a person is needed.
//
// Same vacuity guard as above, and the same reason.
export function allTerminal(ap: AutopilotConfig, cards: Card[]): boolean {
  return cards.length > 0 && cards.every((c) => isTerminalColumn(ap, c.board, c.columnSlug));
}

// WHERE A TASK WAITS BETWEEN ITS WORK LANDING AND ITS STORY BEING JUDGED (decision 87). A literal, for the
// reason `TASK_ENTRY` in core/lifecycle/tick.ts is one: the scaffolder has created it on engineering since
// the first commit, and a board that has lost it is refused by name before a task is stamped into it.
export const DELIVERED_COLUMN = 'review';

export const isDelivered = (card: Card): boolean =>
  card.board === 'engineering' && card.columnSlug === DELIVERED_COLUMN;

// READY FOR ITS STORY'S JUDGEMENT: settled, or delivered and waiting — and it answers ONLY the question that
// fires that judgement. A delivered task is not done: `done` means a passing review said so, which is the
// whole of decision 87, so everything that asks whether work is FINISHED — `allTerminal`, the project's own
// ending — still reads it as outstanding.
//
// Without it the judgement never fires: a delivered task is neither terminal nor blocked, so the implement
// re-forms its group out of work that has landed and is dispatched until its cap blocks the story.
export const isJudgeable = (ap: AutopilotConfig, card: Card): boolean =>
  isSettled(ap, card) || isDelivered(card);

// Same vacuity guard as `allSettled`, and the same reason.
export function allJudgeable(ap: AutopilotConfig, cards: Card[]): boolean {
  return cards.length > 0 && cards.every((c) => isJudgeable(ap, c));
}

// THE ONE HOME FOR DECISION 46, and the emptiness of this list IS the status. There was a `derivedStatus`
// beside it answering `clean` / `carrying-a-problem` over the same walk, and nothing called it: the wire
// computes the fact from here because it needs the IDS, not an enum — a badge saying "carrying a problem"
// with no name is one nobody can act on (server/boards/snapshot.ts). Two spellings of one rule is the duplication
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
