import { useState } from 'react';
import { Button } from '../../atoms/Button';
import { Text } from '../../atoms/Text';
import { forgiveCardAttempts } from '../../lib/api';
import type { BoardName } from '../../lib/shared';
import { useAction } from '../../lib/useAction';
import { useConfirm } from '../../lib/useConfirm';

interface Props {
  board: BoardName;
  card: string;
  // Refetches the card's runs and its ledger line. The "2 of 3" beside this button is DERIVED from
  // the records this write stamps, so without it the row goes on reading the number it had before the
  // click and the control looks like it did nothing.
  onForgiven: () => void;
}

// The way out of a card the machine spent.
//
// It sits beside the attempt count because that is where the problem is met: the row says "execute 3
// of 3", auto-pilot will not dispatch the card, and until this existed the only remedy was to move the
// card's result files out of its folder by hand — which destroys the history explaining why it was
// blocked, and which nobody could be expected to discover.
//
// Its own component rather than more markup in CardReports for the reason SandboxPanel is one: it owns
// an async action, a confirmation, an error and a result line, and CardReports is otherwise a list.
export function ForgiveAttempts({ board, card, onForgiven }: Props) {
  const { busy, error, run } = useAction();
  const { confirm, dialog } = useConfirm();
  // What the last clearance actually cleared. Reported rather than swallowed, exactly as the box
  // rebuild reports its count: "done" on a card that had no spent attempts reads as "your problem is
  // fixed", and it is not — whatever is holding the card is somewhere else.
  const [forgiven, setForgiven] = useState<number | null>(null);

  async function clear(): Promise<void> {
    const ok = await confirm({
      title: `Clear the failed tries on ${card}?`,
      // WHAT IT DOES AND WHAT IT DOES NOT. The last sentence is the one that has to be there: these
      // runs are cleared most often because they failed for a reason outside the card — a dead
      // credential, a box pointing at a deleted directory — and a dialog that implied the machine was
      // now fixed would send the next run into the same wall.
      body: `The attempts ${card} has spent stop counting against it, so auto-pilot can dispatch it again. Every run stays in the list below — nothing is deleted, and each one is stamped with the time you cleared it. This does not fix whatever made those runs fail: if the cause was outside the card, the next run will hit it too.`,
      // `danger` is deliberately absent, on the same reasoning as archiving a card: nothing is
      // destroyed here, and borrowing the weight of a deletion would make every red button mean less.
      action: 'Clear them',
    });
    if (!ok) return;
    setForgiven(null);
    await run(async () => {
      const res = await forgiveCardAttempts(board, card);
      setForgiven(res.forgiven);
      onForgiven();
    });
  }

  return (
    <>
      {/* `default`, not `ghost`. It was a ghost on the argument that an escape hatch is a quiet thing,
          and that conflated QUIET with EXPLANATORY: this button WRITES — it clears the spent attempts and
          changes what auto-pilot will dispatch. A dashed border on a control that mutates the ledger says
          the wrong thing about it. Quietness is what `default` beside a `primary` already gives. */}
      <Button data-testid="reports-forgive" disabled={busy !== null} onClick={() => void clear()}>
        {/* "Clear failed tries" and not "Try this card again": the button does not RUN anything, and a
            label promising a retry set up the wrong expectation — what it does is stop the spent tries
            counting, after which auto-pilot picks the card up on its own schedule. */}
        {busy !== null ? 'Clearing…' : 'Clear failed tries'}
      </Button>
      {forgiven !== null && (
        <span className="reports-forgiven">
          {forgiven === 0
            ? 'Nothing was counting against this card, so nothing was cleared.'
            : `Cleared ${forgiven} attempt${forgiven === 1 ? '' : 's'}. They are still in the list, and no longer count.`}
        </span>
      )}
      {/* `.reports-forgive-error` IS DELETED: it said `flex-basis: 100%` — which is what the result
          line beside it says — plus `color: var(--danger)`, which is `Text error`. */}
      {error && (
        <Text role="error" className="reports-forgiven">
          {error}
        </Text>
      )}
      {dialog}
    </>
  );
}
