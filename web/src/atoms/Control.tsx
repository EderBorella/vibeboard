import type { InputHTMLAttributes, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

// THE CONTROL: a box that holds a value. An `<input>`, a `<select>` or a `<textarea>`, all drawing the
// same box, which is what `.vb-input` was — applied by hand at 22 sites, plus a descendant selector on
// `Field` for the callers who did not.
//
// WHY IT IS AN ATOM AND NOT A CLASS ANY MORE, and it is the descendant selector that answers it.
// `.vb-field input, .vb-field textarea, .vb-field select` was (0,1,1), so it outranked every
// single-class rule a surface could write about its own control — a specificity hazard the stylesheet
// commented on itself. It also reached `<input type="checkbox">`, which paints no border and so could
// use none of the box, and had to be cut out of the focus rule by two `:not()`s. Passing the element
// through here means the box arrives with the control instead of with its parent, and a checkbox is
// simply not one of these.
//
// `as` IS A CLOSED SET, for `Surface`'s and `Chip`'s reason: it says what the control IS, and an open
// tag would make this a general element factory whose geometry claim is empty.
export type ControlTag = 'input' | 'select' | 'textarea';

// THE UNION OF THE THREE ELEMENTS' OWN ATTRIBUTES, and it is a union rather than a hand-written list
// because every one of these controls is a real form element with a real contract: `value`, `onChange`,
// `rows`, `multiple`, `min`, `step`, `checked`. Narrowing that to the handful the tree happens to use
// today would make the next caller edit this file, and a component nobody can use without editing it is
// a class with extra steps.
//
// `className` IS LAYOUT ONLY, exactly as it is on Button, Chip and Surface — `flex`, `min-width`, a
// `resize`, a margin. Not a padding and not a border: `npm run check:shape-coverage` reads `<Control`
// alongside the three literal tags for that reason, so a box decided at a call site is a finding.
type Attributes = InputHTMLAttributes<HTMLInputElement> &
  SelectHTMLAttributes<HTMLSelectElement> &
  TextareaHTMLAttributes<HTMLTextAreaElement>;

interface Props extends Omit<Attributes, 'className'> {
  as?: ControlTag;
  // THE MONOSPACED FACE, AND IT IS NOT A `Readout`. Four surfaces declared `font-family: var(--font-mono)`
  // on their own control class — a card's whole file, a config file, a prompt, and the exact string a
  // typed confirmation demands back. All four are machine TEXT rather than a measurement, and
  // test/mono-census.test.tsx already ruled that a control cannot be a Readout at all, structurally: a
  // Readout is a `<span>`. So the face is an option here, said once, and those four rules are gone.
  mono?: boolean;
  className?: string;
  // DECLARED, not forwarded, for Button's reason: React 19 passes `ref` as an ordinary prop and the
  // spread carries it through, but the HTML attribute types do not name it, so a caller that focuses or
  // measures its own control is a type error without this line.
  ref?: Ref<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>;
}

export function Control({ as = 'input', mono, className, ...rest }: Props) {
  const Tag = as;
  const classes = ['vb-ctl', mono && 'vb-ctl-mono', className].filter(Boolean).join(' ');
  return <Tag className={classes} {...rest} />;
}
