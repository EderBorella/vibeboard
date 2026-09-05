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

// THE SAVED FOCUS IS ALWAYS ONE OF THE OPTIONS, even when it is finished or gone from the board — and this
// is here because the control lied on screen. `focus: F-001` was saved, F-001 had been closed by the run
// that finished it, so the filter above dropped it and a `<select>` whose value matches no option falls back
// to the first: the picker read **The whole board** over a project the loop was still confined to.
//
// Invisible to every gate. jsdom never had a saved focus pointing at a finished feature, Storybook's fixture
// has none either, and the browser harness runs in standard mode where this control does not render. It was
// found by opening the page and reading it.
//
// The state is LABELLED rather than silently repaired, because both readings are real: a finished focus is
// what a completed focused run leaves behind, and an absent one is a card somebody archived — which the tick
// refuses by name (core/position.ts). A picker that quietly cleared either would be deciding for the person.
function withSavedFocus(options: Card[], features: Card[], focus: string | undefined): FocusOption[] {
  const out: FocusOption[] = options.map((c) => ({ value: c.id, text: label(c.id, c.title) }));
  if (focus === undefined || out.some((o) => o.value === focus)) return out;
  const card = features.find((c) => c.id === focus);
  out.push({
    value: focus,
    text: card ? `${label(focus, card.title)} (finished)` : `${focus} (no longer on the board)`,
  });
  return out;
}

interface FocusOption {
  value: string;
  text: string;
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
  const options = withSavedFocus(focusable(features, config.terminal.features ?? []), features, config.focus);
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
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.text}
        </option>
      ))}
    </Control>
  );
}
