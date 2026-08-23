import { useState } from 'react';
import { Button } from '../../atoms/Button';
import { Text } from '../../atoms/Text';
import { forgiveProjectAttempts } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { useConfirm } from '../../lib/useConfirm';

interface Props {
  // WHY THE LOOP STOPPED, so this component decides its own visibility.
  //
  // The condition lived in the bar until the complexity gate refused it there, and moving it here is the
  // better home anyway: when this control is offered is part of what it means, and the bar had no test that
  // could see the rule while the component had one that could.
  //
  // `stalled` only. On `complete` there is nothing wrong to undo, and while the loop is running an
  // unfinished derivation lands as an attempt of its own moments later — which is why the server refuses it
  // as well, rather than trusting a button not to be there.
  reason: string | undefined;
  // Refetches the auto-pilot state. The stop sentence in the bar is DERIVED from the records this write
  // stamps, so without it the bar keeps saying the derivation has used all its attempts and the button
  // reads as having done nothing.
  onForgiven: () => void;
}

// THE SAME WAY OUT AS A CARD'S, FOR THE POSITION THAT HAS NO CARD.
//
// The bootstrap — an empty board derived from the README — runs without a card, so its cap is counted over
// the project's own runs and `ForgiveAttempts` cannot address it: that one is keyed by board and card.
//
// Measured 2026-08-16: an OpenCode server that could not be reached spent all three of the calculator's
// derivation attempts in five seconds — 449ms each, no model, no tokens — and auto-pilot stopped saying the
// README might be too thin to derive features from. The README was fine and nothing had opened it. The only
// remedy was moving files out of `project-runs/` by hand, which destroys the account of why the project was
// stuck and which nobody could be expected to discover.
//
// It sits with the stop sentence rather than in Settings, because that sentence is where the problem is met.
export function ForgiveDerivation({ reason, onForgiven }: Props) {
  const { busy, error, run } = useAction();
  const { confirm, dialog } = useConfirm();
  // WHAT WAS ACTUALLY CLEARED, reported rather than swallowed — the same reasoning as the card button. A
  // bare "done" on a project whose derivation was never the problem reads as "your problem is fixed", and
  // whatever is holding it is then still there.
  const [forgiven, setForgiven] = useState<number | null>(null);

  // AFTER the hooks, never before: a conditional return above them changes the hook order between renders.
  if (reason !== 'stalled') return null;

  async function clear(): Promise<void> {
    const ok = await confirm({
      title: 'Clear the derivation attempts on this project?',
      // WHAT IT DOES AND WHAT IT DOES NOT, and the last sentence is the one that must be there: these runs
      // are cleared most often because they failed for a reason outside the project — an unreachable
      // backend, a dead credential — and implying the machine is now fixed sends the next run into the
      // same wall.
      body: 'The attempts spent deriving the board from your README stop counting, so auto-pilot can try again. Every run stays in the list — nothing is deleted, and each is stamped with the time you cleared it. This does not fix whatever made those runs fail: if the cause was outside the project, the next one will hit it too.',
      action: 'Clear them',
    });
    if (!ok) return;
    setForgiven(null);
    await run(async () => {
      const res = await forgiveProjectAttempts();
      setForgiven(res.forgiven);
      onForgiven();
    });
  }

  return (
    <>
      {/* IT HAD ITS OWN CLASS, and the reason it needed one is now the primitive's job. Borrowing the card
          list's `reports-forgive` put a 10.88px control with 1.6px of padding into a bar whose other buttons
          were 12.16px with 4px — measured in a browser, because jsdom reports every box as zero and cannot
          see it. Copying the neighbour's declarations verbatim was the second attempt. `Button` is the third
          and last: there is one geometry, so there is nothing left to borrow wrongly.
          `default` rather than `ghost`, deliberately: this is the ONE action on a stopped project, and the
          three controls beside it (Details, How it works, Settings) are quiet on purpose.
          The result and error lines below stay on the shared classes — those are prose. */}
      <Button
        variant="default"
        className="ap-remedy-btn"
        disabled={busy !== null}
        onClick={() => void clear()}
      >
        {/* Names the derivation rather than saying "clear failed tries", because the card button already
            uses those words for a different position — and a person looking at a stalled project needs to
            know which of the two this is. */}
        {busy !== null ? 'Clearing…' : 'Clear the derivation attempts'}
      </Button>
      {forgiven !== null && (
        <span className="reports-forgiven">
          {forgiven === 0
            ? 'Nothing was counting against the derivation, so nothing was cleared — whatever is holding this project is somewhere else.'
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
