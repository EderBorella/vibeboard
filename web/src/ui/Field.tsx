import type { ReactNode } from 'react';

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
// The CONTROL is a child and keeps no class of its own: `.vb-field input, .vb-field textarea,
// .vb-field select` gives it the box, so a caller cannot forget it. See ui/primitives.css.
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
    // (`.link-option` at four sites and Diagnostics' bare span) against one at `.vb-label`'s muted 12px.
    layout === 'check' && 'vb-field-check',
    className,
  ];
  // A rail label names its caps face explicitly, because `.vb-label-rail` is a width and nothing else
  // since the two were separated — see the note beside them in primitives.css.
  const face = layout === 'rail' || caps ? 'vb-label vb-label-caps' : 'vb-label';
  const name = <span className={layout === 'rail' ? `${face} vb-label-rail` : face}>{label}</span>;
  return (
    <Tag className={classes.filter(Boolean).join(' ')}>
      {layout === 'check' ? children : name}
      {layout === 'check' ? name : children}
      {hint && <span className="vb-hint">{hint}</span>}
      {error && <span className="vb-error">{error}</span>}
    </Tag>
  );
}
