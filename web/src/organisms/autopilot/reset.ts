import type { RunList } from '../../lib/api';
import type { BoardName } from '../../lib/shared';

// Which card the reset is offered for, worked out from what the bar already holds. A module rather
// than markup so both answers can be tested without a DOM — the pair of questions is the whole of the
// control's behaviour, and the rest of it is a select and a button.

export interface ResettableCard {
  id: string;
  board: BoardName;
}

// THE CARDS A RESET COULD DO ANYTHING FOR: the ones this project has run something on.
//
// NOT THE WHOLE BOARD, and the difference is not cosmetic. A card with no run record has no attempt to
// clear, so offering it is offering a button that answers "nothing was counting" — and a picker over
// three hundred cards, all but a handful of them inert, is one nobody can find F-003 in.
//
// NOT "the cards with a run that still BURNS" either, which is the tighter list and would need
// `burnsAttempt`'s rule written a second time in the browser. That rule has four clauses and lives in
// core/accounting.ts; a copy here would be a second answer to "what counts against a card", and the
// server already tells the truth for the inert case — the reply says how many were cleared, and zero
// says so plainly.
//
// A project run has no card and no board (both or neither, never one), so it contributes nothing here.
export function resettableCards(runs: RunList): ResettableCard[] {
  const found = new Map<string, ResettableCard>();
  for (const run of runs.runs) {
    if (run.card === undefined || run.board === undefined) continue;
    if (!found.has(run.card)) found.set(run.card, { id: run.card, board: run.board });
  }
  // By id, which groups by board on its own: ids are board-prefixed and zero-padded, so `F-` then `P-`
  // then `E-` is both the alphabetical order and the order a person reads the three boards in.
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// WHICH OF THOSE THE STOP SENTENCE NAMES, so the control comes up already aimed at the card the person
// is reading about. Every stop that strands a card opens with its id.
//
// THE KNOWN IDS ARE MATCHED AGAINST THE PROSE, never the other way round. A pattern that pulled an
// id-shaped token out of a sentence would invent cards — the sentences quote git output, command lines
// and column slugs — and this cannot: the only thing it can answer with is a card the run list already
// named. The claim it makes is small enough to be true, which is "this sentence mentions F-003".
//
// AMBIGUITY IS NO ANSWER. Several sentences name two cards, and a default guessed wrong is worse than
// none: it puts the wrong id on a button whose confirmation the person is about to skim. Nothing is
// preselected then, and the select is what decides.
export function cardNamedIn(detail: string | undefined, cards: ResettableCard[]): string | undefined {
  if (!detail) return undefined;
  const named = cards.filter((c) => new RegExp(`\\b${literal(c.id)}\\b`).test(detail));
  return named.length === 1 ? named[0]?.id : undefined;
}

// A card id reaches the browser over the wire, so it is escaped rather than trusted to be `[A-Z]-\d+`.
const literal = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
