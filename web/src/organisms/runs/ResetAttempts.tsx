import { useState } from 'react';
import { Button } from '../../atoms/Button';
import { Text } from '../../atoms/Text';
import { resetCardAttempts } from '../../lib/api';
import type { BoardName } from '../../lib/shared';
import { useAction } from '../../lib/useAction';
import { useConfirm } from '../../lib/useConfirm';

interface Props {
  board: BoardName;
  card: string;
  // Refetches the card's runs and its ledger line, exactly as the forgive beside it does: the "3 of 3"
  // this clears is DERIVED from the records the write stamps, so without it the row goes on reading the
  // number it had before the click.
  onForgiven: () => void;
}

// THE WAY OUT OF A CARD ITS OWN SUCCESSES STOPPED, on the card (decision 86).
//
// `ForgiveAttempts`, one button along, spares a run that SUCCEEDED — deliberately and correctly, because
// clearing a `break-down` that worked frees the loop to hang a second set of children off the card. But a
// card can be stopped by its successes alone: measured on F-003, whose feature checkup ran four times,
// three `success` and one `attention` already forgiven, leaving it at its cap with nothing that button
// would touch.
//
// AND IT IS HERE AS WELL AS ON THE BAR, which is the correction rather than a duplicate. `ResetCard` in
// organisms/autopilot renders only while the loop reports `stalled`; a card in this state on a project
// whose loop last said `complete` or `stopped` had no route to a reset at all, and "restart auto-pilot
// until it stalls" is not a remedy. A state a person cannot get out of should not exist, and one
// reachable from a single loop state does not satisfy that.
//
// A SECOND COMPONENT AND NOT A FLAG ON THE FIRST, for the reason the ROUTES are two rather than one: the
// two are different decisions with different costs, and the cost of this one is stated in its own
// confirmation rather than hidden behind a checkbox on the milder action.
export function ResetAttempts({ board, card, onForgiven }: Props) {
  const { busy, error, run } = useAction();
  const { confirm, dialog } = useConfirm();
  // What the last reset cleared. Reported rather than swallowed, like both buttons it sits with: a bare
  // "done" on a card that was never the problem reads as "your problem is fixed", and it is not.
  const [forgiven, setForgiven] = useState<number | null>(null);

  async function clear(): Promise<void> {
    const ok = await confirm({
      title: `Reset ${card}?`,
      // THE CONSEQUENCE IS THE SECOND SENTENCE, and it is what makes this dialog not the other one's. A
      // run that succeeded and created cards stops counting too, so the loop may create that work again
      // — precisely what the milder button refuses to risk, and precisely what has to be risked to move
      // a card its successes stopped.
      body: `Every attempt ${card} has spent stops counting, including the runs that SUCCEEDED — which is what makes this different from clearing failed tries. If one of those was a run that created cards, auto-pilot is free to create that work again, so you may end up with a second set. Every run stays in the list — nothing is deleted, and each is stamped with the time you cleared it.`,
      // `danger` is absent on the same reasoning as the forgive and as archiving a card: nothing here is
      // destroyed, and borrowing the weight of a deletion would make every red button mean less. What
      // this one costs is in the sentence above, where it can be read.
      action: 'Reset it',
    });
    if (!ok) return;
    setForgiven(null);
    await run(async () => {
      const res = await resetCardAttempts(board, card);
      setForgiven(res.forgiven);
      onForgiven();
    });
  }

  return (
    <>
      <Button data-testid="reports-reset" disabled={busy !== null} onClick={() => void clear()}>
        {/* "ALL", against the neighbour's "failed tries", because the difference between the two buttons
            IS which tries they touch and the pair is always on screen together. A bare "Reset" would
            leave that to the confirmation, which is the part people skim.

            AND IT IS AS LONG AS THE LINE TAKES. Measured against the browser harness, which is the only
            thing here with a layout engine: at its 1280 viewport the ledger row holds these four children
            at nine characters and WRAPS at eleven — "Reset every try" was the first label written here
            and check 7 of visual/checks/surfaces.spec.ts refused it. A longer one needs the row
            restructured, not the ceiling raised. */}
        {busy !== null ? 'Resetting…' : 'Reset all'}
      </Button>
      {forgiven !== null && (
        <span className="reports-forgiven">
          {forgiven === 0
            ? 'Nothing was counting against this card, so nothing was cleared — whatever is holding it is somewhere else.'
            : `Reset ${forgiven} attempt${forgiven === 1 ? '' : 's'}. They are still in the list, and no longer count.`}
        </span>
      )}
      {error && (
        <Text role="error" className="reports-forgiven">
          {error}
        </Text>
      )}
      {dialog}
    </>
  );
}
