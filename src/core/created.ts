import { liveCards } from './hierarchy.js';
import { BOARDS, type BoardName, type Card } from './types.js';

// A card-creating phase whose run produced no card has not done its job, whatever it reported
// (decision 43). `producedNothing` does not catch it: that predicate is
// `status === 'failed' && outcome === undefined && filesChanged === 0`, and a run that reports success
// satisfies none of the three — while cards are created through the API, so `filesChanged` is 0 for a
// SUCCESSFUL derivation too. Both predicates are needed and both earn their place.
//
// COUNTED FROM THE BOARD, never from `record.created`. That list is frontmatter the agent wrote about
// itself (`parseAgentReport`, runs.ts:435, copied onto the record at :455), so trusting it would make the
// loop's one deterministic check depend on a self-report — the failure decision 40 exists to prevent. It
// would refuse a break-down that created five cards and forgot to list them, and pass one that listed five
// it never made.
//
// IT DOES NOT APPLY TO THE CHECKUPS. Their product is a report; creating is optional, and a checkup that
// creates nothing is the ordinary closing case (decision 47), so applied to them this rule would refuse
// every close. It applies to `bootstrap` and both `break-down`s — the three phases whose only product is
// cards.

// FAIL CLOSED on a board that shrank. Archiving during a run is not a creation, and reading a smaller
// board as "something appeared" would advance a phase over work that never happened. Being wrong the other
// way costs one retry, which is ordinary.
export function createdNothing(before: number, after: number): boolean {
  return after <= before;
}

// Every board, and a missing one counts as zero rather than throwing: this feeds a decision the loop makes
// between dispatches, and an exception there would end the run instead of the tick.
export function countLive(boards: Record<BoardName, Card[]>): number {
  return BOARDS.reduce((total, board) => total + liveCards(boards[board] ?? []).length, 0);
}
