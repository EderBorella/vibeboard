import type { ReactNode } from 'react';
import { Text } from '../atoms/Text';

// THE FIELD: a label, a control, an optional hint and an optional error, in that order.
//
// The last primitive of docs/design-system.md and the least urgent one, which is why it is last: the
// fewest sites and the most bespoke behaviour. The behaviour it does NOT own is inline commit-on-blur
// editing — that stays in ui/InlineField.tsx, whose 17 tests were re-proven live before this landed by
// planting `onBlur: () => setDraft(null)`, which turned four of them red.
//
// WHY IT IS WORTH A COMPONENT AND NOT JUST A CLASS: the label is the part that was written twenty ways.
// A settings field wrote `<label class="field"><span>…</span>`, the gate wrote `.gate-field > span`, the
// skill editor and the dispatch pane each wrote a fixed-width rail label — at 6rem and 5.5rem, half a rem
// apart, which nobody chose. Passing the label as a prop is what makes the order of label, control, hint
// and error one decision instead of one per form.
//
// THE CONTROL IS A `Control` AS OF THE ATOM LAYER, and the descendant selector that used to hand it the
// box — `.vb-field input, .vb-field textarea, .vb-field select`, at (0,1,1) — is gone with it. That
// selector meant a caller could not forget the box; it also meant no surface could override it, and it
// reached a checkbox, which paints no border and had to be excluded from the focus rule by name.
interface Props {
  // What the field is. Rendered first, or beside the control when `layout` is `row`.
  label: ReactNode;
  // How something works. Not a warning, and not a refusal.
  hint?: ReactNode;
  // What was refused. Danger ink, below the control, so it reads as an answer to this field.
  error?: ReactNode;
  // `rail` puts the label in a fixed-width column beside its control; `check` is a checkbox, where the
  // control comes FIRST and the label says what it does — a field that holds a decision rather than a
  // value, which is the distinction `.field-check` already drew by hand.
  layout?: 'stack' | 'rail' | 'check';
  // THE FACE, WHICH IS A SEPARATE AXIS FROM THE LAYOUT, and Phase 5b is what separated them: the RAIL
  // is a width and the CAPS is a face. `rail` implies caps because a rail label has always worn it;
  // this flag is for the two labels that want the same face over a control too tall to sit beside them
  // — the skill editor's prompt and the dispatch pane's, both of which wrote
  // `class="vb-label vb-label-caps"` by hand in a form whose other labels are railed.
  caps?: boolean;
  // A `<label>` wraps its control and focuses it on click, which is what almost every one of these
  // wants. `div` is for the two whose control is a custom picker rather than a form element, where a
  // wrapping label has nothing to focus and screen readers announce the whole group as the name.
  as?: 'label' | 'div';
  className?: string;
  children?: ReactNode;
}

export function Field({
  label,
  hint,
  error,
  layout = 'stack',
  caps = false,
  as = 'label',
  className,
  children,
}: Props) {
  const Tag = as;
  const classes = [
    'vb-field',
    layout !== 'stack' && 'vb-field-row',
    // A DECISION IS NOT A VALUE, and the label of one is content rather than a field name — so the check
    // layout sets its label at the surrounding size and ink, and makes the whole row a click target. Both
    // were measured rather than chosen: five checkbox rows in the tree labelled themselves at body/text
    // (`.link-option` at four sites and Diagnostics' bare span) against one at the label step's muted 12px.
    layout === 'check' && 'vb-field-check',
    className,
  ];
  // THE LABEL IS A `Text`, AND THE ONLY THING THE FIELD ADDS IS THE RAIL — which is a WIDTH, so it is
  // the field's and not the face's, and it is `.vb-field-rail` for that reason. A rail label names its
  // caps face explicitly because the two were separated once already and got confused again immediately.
  const name = (
    <Text caps={layout === 'rail' || caps} className={layout === 'rail' ? 'vb-field-rail' : undefined}>
      {label}
    </Text>
  );
  return (
    <Tag className={classes.filter(Boolean).join(' ')}>
      {layout === 'check' ? children : name}
      {layout === 'check' ? name : children}
      {hint && <Text role="hint">{hint}</Text>}
      {error && <Text role="error">{error}</Text>}
    </Tag>
  );
}
