import type { Card } from '../core/types.js';
import type { Answer, BoardClient } from './board-client.js';

// THE ONE PLACE A COLUMN STAMP IS WRITTEN. A column is a state the loop stamps rather than a question it asks
// (decision 38), so every move the loop makes comes through here — and no other file can grow a second way to
// move a card, which is the whole reason this is a module rather than three call sites in act.ts.
//
// Through `POST /api/cards/:board/:id/move` under the `service` credential, never by writing a file: decision
// 10 makes endpoints the only write path, and the loop having a second way in would be the exception that
// swallows the rule (rule 3 in act.ts).
//
// THE DIARY LINE IS PART OF THE STAMP, not the caller's business. A card that moved with no account of why is
// a board nobody can read backwards, and a second caller would eventually forget to write one.
//
// It answers rather than throwing, and it does NOT decide what a refusal means: `Answer` carries `fatal`, and
// whether to stop the loop or note it and carry on belongs with the caller that knows what else it had spent.

export interface StampDeps {
  client: Pick<BoardClient, 'move' | 'log'>;
}

export async function stamp(deps: StampDeps, card: Card, to: string, why: string): Promise<Answer<unknown>> {
  const moved = await deps.client.move(card.board, card.id, to);
  // Only on success. A diary line for a move that was refused would be a record of something that did not
  // happen, which is worse than no record at all.
  if (!moved.ok) return moved;
  await deps.client.log('lifecycle', `${card.id} moved to ${to}: ${why}`, {
    card: card.id,
    board: card.board,
  });
  return moved;
}
