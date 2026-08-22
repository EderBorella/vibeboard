import { type KeyboardEvent, type MouseEvent, type ReactNode, useState } from 'react';
import { Control } from '../atoms/Control';
import { Text } from '../atoms/Text';

// THE FIELD: a label, a control, an optional hint and an optional error, in that order.
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
//
// `inline` IS THE ABSORBED `InlineField`, and the merge is the atom layer's doing rather than a tidy-up.
// The objection to it was GEOMETRIC — a commit-on-blur editor is a control in two states that must share
// one padding, and no primitive owned that box — and `--ctl-h` plus `Control` answers it: the editor IS a
// `<Control>` now, which is what takes `check-shape-coverage`'s control arm to zero. What is left is
// BEHAVIOUR — click to edit, commit on blur, Enter commits, Escape reverts — and behaviour is an option.
// Its 17 tests were re-proven live once already by planting `onBlur: () => setDraft(null)`, which turned
// four of them red; they move with it rather than being rewritten.
interface FormProps {
  inline?: false;
  // What the field is. Rendered first, or beside the control when `layout` is `rail`.
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

interface InlineProps {
  inline: true;
  value: string;
  // What the field is, for the hover hint and the accessible name. No label ELEMENT: the value is read
  // in place, in the sentence it belongs to, and a label above it would be the thing it is not.
  label: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  // Stands in for an empty value, so an unset field is still something to click.
  placeholder?: string;
  className?: string;
  // How a committed value is shown. Defaults to the text; the body passes a markdown renderer.
  display?: (value: string) => ReactNode;
  // Refuses to commit an empty value and reverts instead — a card with no title has no name.
  required?: boolean;
}

export function Field(props: FormProps | InlineProps) {
  return props.inline ? <InlineBody {...props} /> : <FormBody {...props} />;
}

function FormBody({
  label,
  hint,
  error,
  layout = 'stack',
  caps = false,
  as = 'label',
  className,
  children,
}: FormProps) {
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

// Click to edit, in place. Commits on blur and on Enter (Escape reverts); a multiline field takes
// Enter as a newline and commits on blur alone.
function InlineBody({
  value,
  label,
  onCommit,
  multiline,
  rows = 6,
  placeholder,
  className,
  display,
  required,
}: InlineProps) {
  // null while not editing, so an empty draft is still a draft.
  const [draft, setDraft] = useState<string | null>(null);

  if (draft !== null) {
    // Hoisted to a const so the narrowing survives into the handlers below; a guard inside commit
    // would be one no caller could reach, since commit only exists while editing.
    const current = draft;
    const commit = (): void => {
      const next = current.trim();
      setDraft(null);
      if (required && next === '') return; // reverts: the old value stays
      if (next !== value) onCommit(next);
    };

    const stop = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDraft(null);
      // Enter commits a single-line field; in a textarea it belongs to the text.
      else if (e.key === 'Enter' && !multiline) commit();
    };
    // A `Control` AND NOT A LITERAL `<input>`, which is what closes `check-shape-coverage`'s control arm:
    // the box arrives with the element. `.inline-edit` keeps only what is not the box — the accent edge
    // that says "editing now", and the height the surrounding prose sets rather than `--ctl-h`.
    const common = {
      value: draft,
      'aria-label': label,
      className: 'inline-edit',
      autoFocus: true,
      onBlur: commit,
      onKeyDown: stop,
    };
    return multiline ? (
      <Control as="textarea" {...common} rows={rows} onChange={(e) => setDraft(e.target.value)} />
    ) : (
      <Control {...common} onChange={(e) => setDraft(e.target.value)} />
    );
  }

  const shown =
    value === '' ? (
      <Text role="hint" lead>
        {placeholder}
      </Text>
    ) : (
      (display?.(value) ?? value)
    );
  const cls = `inline-view${className ? ` ${className}` : ''}`;
  const open = (): void => setDraft(value);

  // A multiline value can contain links (rendered markdown), and an anchor inside a button is
  // invalid and unclickable — so this one is a div that ignores clicks landing on a link.
  if (multiline) {
    return (
      <div
        className={cls}
        title={`Edit ${label}`}
        role="button"
        tabIndex={0}
        onClick={(e: MouseEvent) => {
          if (!(e.target as HTMLElement).closest('a')) open();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') open();
        }}
      >
        {shown}
      </div>
    );
  }

  return (
    <button type="button" className={cls} title={`Edit ${label}`} onClick={open}>
      {shown}
    </button>
  );
}
