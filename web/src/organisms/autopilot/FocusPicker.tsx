import { Control } from '../../atoms/Control';
import type { AutopilotConfig, Card } from '../../lib/shared';

// The whole board is the ordinary state, so the empty option has to say that rather than read as "none
// chosen yet". A blank first option is how a picker comes to look like it is waiting for an answer.

// A `<select>` IS AS WIDE AS ITS WIDEST OPTION, and a feature title is unbounded — the loop's own mandatory
// harness card is called "The product can be run the way the README describes". The bar wraps rather than
// overflowing the shell (autopilot.css), so a long option costs a second line rather than a horizontal
// scrollbar; this keeps it from costing one for a title nobody needs to read in full. The id is always
// shown, and it is the part that identifies the card.
//
// TRUNCATED IN THE LABEL RATHER THAN BY A WIDTH RULE, because the class budget is a ratchet at 230 with no
// slack (CLAUDE.md) — a one-declaration class for this would have to displace another.
const TITLE_CHARS = 32;
const label = (id: string, title: string): string =>
  `${id} — ${title.length > TITLE_CHARS ? `${title.slice(0, TITLE_CHARS - 1).trimEnd()}…` : title}`;
const WHOLE_BOARD = 'The whole board';
export const NO_FOCUS = '';

interface Props {
  // `null` where a project has no lifecycle block, exactly as the mode picker takes it.
  config: AutopilotConfig | null;
  features: Card[];
  onChange: (focus: string | undefined) => void;
  disabled?: boolean;
}

// WHICH FEATURES CAN BE FOCUSED: every one that is not finished, which is BACKLOG as well as Todo and In
// Progress.
//
// Backlog is the deliberate part. In this machine a feature that has never been started sits in `backlog` —
// `derive-features` creates them there and the loop moves one to `todo` when it begins its break-down — so a
// picker offering only the started ones cannot reach the case the focus exists for: taking one feature that
// has not begun and seeing it through end to end.
//
// A FINISHED FEATURE IS NOT OFFERED, because focusing one is not a run: `derivePosition` reads a focused
// feature in a terminal column as "nothing left to do" and the loop reports complete without dispatching.
// Offering it would be offering a button that does nothing.
function focusable(features: Card[], terminal: string[]): Card[] {
  return features.filter((c) => !terminal.includes(c.columnSlug));
}

// ONE FEATURE, END TO END. Shown only in express mode — see the bar, which is also what clears the saved
// focus when the mode changes, so a hidden picker can never leave the loop confined to a card nobody can
// see.
//
// A `select` AND NOT A SEGMENTED PICKER, unlike the two beside it: those choose between two fixed options
// and this one is a list of whatever a project happens to have, which can be twenty. `Control as="select"`
// is the box this design system already draws for exactly that.
export function FocusPicker({ config, features, onChange, disabled = false }: Props) {
  if (config?.mode !== 'express') return null;
  const options = focusable(features, config.terminal.features ?? []);
  return (
    <Control
      as="select"
      aria-label="The feature auto-pilot works on"
      title="Confine auto-pilot to one feature: it works that card and its stories and tasks, and stops when they are done. Everything else on the board is left alone."
      value={config.focus ?? NO_FOCUS}
      disabled={disabled}
      onChange={(e) => onChange(e.currentTarget.value === NO_FOCUS ? undefined : e.currentTarget.value)}
    >
      <option value={NO_FOCUS}>{WHOLE_BOARD}</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {label(c.id, c.title)}
        </option>
      ))}
    </Control>
  );
}
