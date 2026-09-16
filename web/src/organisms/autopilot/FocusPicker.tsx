import { Control } from '../../atoms/Control';
import type { AutopilotConfig, Card } from '../../lib/shared';

// The whole board is the ordinary state, so the empty option has to say that rather than read as "none
// chosen yet". A blank first option is how a picker comes to look like it is waiting for an answer.
const WHOLE_BOARD = 'The whole board';
export const NO_FOCUS = '';

// THE LABEL IS BUDGETED TO THE BOX, and the TITLE is what gives way rather than the state.
//
// The select holds a fixed width so choosing a feature cannot shove the mode selector sideways
// (autopilot.css), which leaves about 38 characters of room. A first attempt capped the title alone and let
// the box clip whatever followed, and what followed was the state: the option read
// "F-001 — greet — a command-line… (fi" — two truncations fighting, with the informative half losing. So the
// title is trimmed to whatever the id and the suffix leave, and the suffix is never cut.
//
// The id is never shortened either: it is the part that identifies the card, and it is what the config holds.
// A CHARACTER COUNT STANDING IN FOR A PIXEL BOX, and the number is measured rather than reasoned. The select
// is 288px wide, of which about 252 is usable once the padding and the native arrow are taken; the row's font
// runs about 7px per character on this text, so 38 characters overran it and clipped "(finished)" to "(finish".
// 32 leaves room for the wide glyphs a proportional font makes no promises about.
const LABEL_CHARS = 32;
const MIN_TITLE = 8;

function label(id: string, title: string, suffix = ''): string {
  const room = Math.max(MIN_TITLE, LABEL_CHARS - id.length - 3 - suffix.length);
  const short = title.length > room ? `${title.slice(0, room - 1).trimEnd()}…` : title;
  return `${id} — ${short}${suffix}`;
}

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
    text: card ? label(focus, card.title, ' (finished)') : `${focus} (no longer on the board)`,
  });
  return out;
}

interface FocusOption {
  value: string;
  text: string;
}

// ONE FEATURE, END TO END.
//
// EXPRESS ONLY, and it is the BAR that makes that free of layout cost: this sits in the row's left, unpushed
// region, where arriving and leaving takes nothing from the groups pinned to the right. Rendered inside the
// pushed group it moved the mode selector ~300px at the moment you clicked it, and reserving the lane in
// standard instead made the row wide enough to wrap — which the browser harness refused, twice over.
//
// The bar also clears any saved focus when the mode leaves express, so an absent picker can never be hiding
// a live constraint.
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
