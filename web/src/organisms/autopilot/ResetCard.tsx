import { useState } from 'react';
import { Button } from '../../atoms/Button';
import { Control } from '../../atoms/Control';
import { Text } from '../../atoms/Text';
import { type RunList, resetCardAttempts } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { useConfirm } from '../../lib/useConfirm';
import { cardNamedIn, resettableCards } from './reset';

interface Props {
  // WHY THE LOOP STOPPED, so this component decides its own visibility — the arrangement
  // `ForgiveDerivation` beside it uses, and for the reason recorded there: when a control is offered is
  // part of what it means, and the bar has no test that can see the rule while the component has one
  // that can.
  reason: string | undefined;
  // The stop sentence, which names the card. Read here so the control comes up aimed at it — see
  // `cardNamedIn`, which matches KNOWN ids against the prose rather than pulling one out of it.
  detail: string | undefined;
  // Every run in the project, which the bar already holds for its own drawer. It is where the list of
  // cards comes from: a card the project has never run anything on has no attempt to clear.
  runs: RunList;
  // Re-asks the loop's state. Whether this control is offered at all is read off it, so a bar that did
  // not re-ask would keep offering a remedy for a stop somebody has since restarted out of.
  onReset: () => void;
}

const PICK = '';

// THE WAY OUT OF A CARD ITS OWN SUCCESSES STOPPED — and the second half of the same incident as the
// feature checkup's (decision 86).
//
// `ForgiveAttempts` on the card spares a run that SUCCEEDED, deliberately and correctly: the user is
// clearing failures, and clearing a `break-down` that worked frees the loop to hang a second set of
// children off the card. But a card can be stopped by its successes alone. Measured on F-003: every
// story done, its feature checkup run four times — three `success` and one `attention` already
// forgiven — so the card sat at three of three attempts with nothing that button would touch, and the
// product offered no route back at all. A state a person cannot get out of should not exist.
//
// A DISTINCT ACTION, NOT A WIDER FORGIVE. Two names, two confirmations, and the cost stated in this
// one's rather than hidden behind a flag on the milder action: clearing a creating run that worked
// means the loop may create that work again, and a remedy whose price is not on the label is the same
// class of problem as the dead end it fixes.
//
// BESIDE THE STOP SENTENCE, where `ForgiveDerivation` is, because that sentence is where the problem is
// met and it is the sentence that names the card. The card pane's own button is for the ordinary case;
// this is for the case in which the loop has stopped and is telling you which card it stopped on.
export function ResetCard({ reason, detail, runs, onReset }: Props) {
  const { busy, error, run } = useAction();
  const { confirm, dialog } = useConfirm();
  // What the last reset cleared. Reported rather than swallowed, like both buttons it sits with: a bare
  // "done" on a card that was never the problem reads as "your problem is fixed", and it is not.
  const [forgiven, setForgiven] = useState<number | null>(null);
  // `null` until the person picks, so the sentence's own card can be the default without that default
  // becoming unchangeable. Three states and not two: not chosen, chosen, and chosen as nothing.
  const [picked, setPicked] = useState<string | null>(null);

  // AFTER the hooks, never before: a conditional return above them changes the hook order between
  // renders. `stalled` only, for the reason on `ForgiveDerivation` — on `complete` there is nothing
  // wrong to undo, and while the loop runs an unfinished run lands as an attempt moments later, which
  // is why the server refuses it too rather than trusting a button not to be there.
  if (reason !== 'stalled') return null;

  const cards = resettableCards(runs);
  if (cards.length === 0) return null;
  const chosen = picked ?? cardNamedIn(detail, cards) ?? PICK;
  const card = cards.find((c) => c.id === chosen);

  async function clear(): Promise<void> {
    if (!card) return;
    const ok = await confirm({
      title: `Reset ${card.id}?`,
      // THE CONSEQUENCE IS THE SECOND SENTENCE, and it is the reason this dialog is not the other one's.
      // A run that succeeded and created cards stops counting too, so the loop may create that work
      // again — which is precisely what the milder button refuses to risk, and precisely what has to be
      // risked to move a card its successes stopped.
      body: `Every attempt ${card.id} has spent stops counting, including the runs that SUCCEEDED — which is what makes this different from clearing failed tries. If one of those was a run that created cards, auto-pilot is free to create that work again, so you may end up with a second set. Every run stays in the list — nothing is deleted, and each is stamped with the time you cleared it.`,
      // THE TITLE CARRIES THE CARD AND THIS CARRIES THE VERB, which is the house shape (`Clear them`)
      // and here also the accessible one: two buttons on screen at once reading "Reset F-003" give the
      // thing that ASKS and the thing that DOES one name between them.
      //
      // `danger` is absent on the same reasoning as archiving a card and as the forgive: nothing here is
      // destroyed, and borrowing the weight of a deletion would make every red button mean less. What
      // this one costs is in the sentence above, where it can be read.
      action: 'Reset it',
    });
    if (!ok) return;
    setForgiven(null);
    await run(async () => {
      const res = await resetCardAttempts(card.board, card.id);
      setForgiven(res.forgiven);
      onReset();
    });
  }

  return (
    <>
      {/* THE ID ALONE, not "id — title". The stop sentence above says F-003 and this is the list you
          match it against; the titles are on the board behind this bar. It also keeps the box off the
          fixed-width lane FocusPicker needs — that rule is `.ap-bar-row select`, and this select is in
          the remedy region rather than on the row. */}
      <Control
        as="select"
        aria-label="The card to reset"
        value={chosen}
        disabled={busy !== null}
        onChange={(e) => setPicked(e.currentTarget.value)}
      >
        <option value={PICK}>Reset a card…</option>
        {cards.map((c) => (
          <option key={c.id} value={c.id}>
            {c.id}
          </option>
        ))}
      </Control>
      <Button
        variant="default"
        className="ap-remedy-btn vb-fixed"
        disabled={busy !== null || !card}
        onClick={() => void clear()}
      >
        {/* Names the card, because the row already carries one remedy and the difference between them
            is what each is addressed to. "Reset" rather than "clear": this one clears runs that worked,
            and reusing the other's word for a wider action would make the two read as one. */}
        {busy !== null ? 'Resetting…' : card ? `Reset ${card.id}` : 'Reset'}
      </Button>
      {forgiven !== null && (
        <span className="reports-forgiven">
          {forgiven === 0
            ? 'Nothing was counting against that card, so nothing was cleared — whatever is holding this project is somewhere else.'
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
