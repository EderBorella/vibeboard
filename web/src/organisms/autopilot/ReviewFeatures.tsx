import { Button } from '../../atoms/Button';
import { Stack } from '../../atoms/Stack';
import { Text } from '../../atoms/Text';
import type { AutopilotConfig, Card } from '../../lib/shared';
import { useAction } from '../../lib/useAction';
import { FocusPicker } from './FocusPicker';

interface Props {
  // WHY THE LOOP STOPPED, so this component decides its own visibility — the same arrangement as
  // `ForgiveDerivation` beside it, and for the reason recorded there: when a control is offered is part of
  // what it means, and the bar has no test that can see the rule while the component has one that can.
  reason: string | undefined;
  config: AutopilotConfig | null;
  features: Card[];
  // Saves the focus. The bar owns this because `PATCH /api/config` takes the whole autopilot block — see
  // `chooseFocus` — and a second copy of that rule here would be a second thing to keep true.
  onFocus: (focus: string | undefined) => void;
  // Starts the loop again and refetches. Confirming IS resuming: there is no separate acknowledgement to
  // record, because the stop already happened and Start is what ends it.
  onConfirm: () => Promise<void>;
  disabled?: boolean;
}

// THE FEATURE LIST, AND THE ONE MOMENT IT IS CHEAP TO CORRECT — decision 74.
//
// Auto-pilot derives every feature from the README in one shot, with no person in the loop, and then builds
// everything else on top of that list. A wrong list is the error that compounds hardest. So the loop stops
// here and this is what a person meets.
//
// IT CARRIES THE FOCUS PICKER, which is the half that makes this more than an acknowledgement. `decision 73`
// gave the loop a focus and could not place the choice: focus cannot be SET until the derivation has produced
// the cards to choose from, so the order was always bootstrap, then choose — with nothing in between. This
// stop IS the in-between. The list exists, nothing has been built on it yet, and choosing one feature to see
// end to end is a decision a person can only make while looking at exactly this screen.
//
// LEAVING IT ON "The whole board" IS AN ANSWER, not a skipped question, which is why the button says Confirm
// rather than Skip and why nothing here is required before it can be pressed.
//
// BENEATH THE BAR, NEVER ON IT. The row needs 1504px of the 1277 it has at the harness's width — that is the
// whole of what the *"auto-pilot bar is full"* note records — and this is three controls, not one. The
// remedy region below the stop sentence is where it fits, and it is also where the sentence explaining the
// stop already is: the explanation and the way forward in one place.
export function ReviewFeatures({ reason, config, features, onFocus, onConfirm, disabled = false }: Props) {
  // `busy` is a KEY, not a boolean — `useAction` keys it to which control was pressed so only that one
  // spins. There is one control here, so the key is only ever present or absent.
  const { busy, error, run } = useAction();

  // AFTER the hooks, never before: a conditional return above them changes the hook order between renders.
  if (reason !== 'review') return null;

  return (
    <Stack direction="column" gap={4} testId="ap-review">
      <Text caps size="micro">
        Before anything is built on this
      </Text>
      <Stack gap={4} wrap>
        {/* THE BOARD IS THE LIST, and this points at it rather than repeating it. A copy of the feature
            titles here would be a second rendering of cards that are already on screen behind this bar,
            drifting the moment one is edited — and the board shows each card's description and body, which
            is what somebody checking a derivation actually needs to read. */}
        <Text>
          {features.length === 1
            ? 'One feature is on the board.'
            : `${features.length} features are on the board.`}{' '}
          Read them, then confirm — or edit and delete cards first, and confirm when the list is right.
        </Text>
      </Stack>
      <Stack gap={4} wrap>
        {/* THE SAME PICKER THE BAR CARRIES, not a second one. It renders only in express — which is its own
            rule, recorded on it — so in standard this row is the sentence and the button, which is correct:
            there is no focus to choose when the lifecycle does not honour one. */}
        <FocusPicker
          config={config}
          features={features}
          disabled={disabled || busy !== null}
          onChange={onFocus}
          spacer={false}
        />
        <Button
          variant="primary"
          disabled={disabled || busy !== null}
          data-testid="ap-review-confirm"
          onClick={() => void run(onConfirm)}
        >
          Confirm and start
        </Button>
      </Stack>
      {error && <Text role="error">{error}</Text>}
    </Stack>
  );
}
