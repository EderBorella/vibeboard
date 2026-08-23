import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

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
// `trigger` IS A CONTROL AND NOT A BUTTON, and the stylesheet had already decided that: `.vb-trigger`
// shares `.vb-ctl`'s box rule by name at the top of `control.css`, because it is the stand-in for a
// `<select>` when the choice is too rich for one — the chat history and the model picker. Two surfaces
// were hand-rolling `<button className="vb-trigger">`, which is the last shape in the tree that a
// primitive drew and no primitive owned.
export type ControlTag = 'input' | 'select' | 'textarea' | 'trigger';

// EACH ELEMENT'S OWN ATTRIBUTES, KEYED BY THE TAG, and it was an INTERSECTION of the three until a
// typecheck said what an intersection really means here. `InputHTMLAttributes & SelectHTMLAttributes &
// TextareaHTMLAttributes` makes every handler an intersection of three signatures, so `onFocus`'s
// `currentTarget` widens to the union of the three elements — and a rename row that calls
// `currentTarget.select()` to select the whole filename it is editing stopped compiling, because a
// `<select>` has no `select()`. Two call sites, and narrowing them with a cast would have moved the
// defect rather than removed it: the box arrives with the element, so the CONTRACT has to as well.
//
// So `as` is the type parameter it always described itself as being. A caller gets exactly the element's
// own attributes — `rows` on a textarea, `multiple` on a select, `checked` on an input — and its own
// event types, which is the real contract this comment claimed for the intersection.
type Attributes = {
  input: InputHTMLAttributes<HTMLInputElement>;
  select: SelectHTMLAttributes<HTMLSelectElement>;
  textarea: TextareaHTMLAttributes<HTMLTextAreaElement>;
  trigger: ButtonHTMLAttributes<HTMLButtonElement>;
};

type TagElement = {
  input: HTMLInputElement;
  select: HTMLSelectElement;
  textarea: HTMLTextAreaElement;
  trigger: HTMLButtonElement;
};

// `className` IS LAYOUT ONLY, exactly as it is on Button, Chip and Surface — `flex`, `min-width`, a
// `resize`, a margin. Not a padding and not a border: `npm run check:shape-coverage` reads `<Control`
// alongside the three literal tags for that reason, so a box decided at a call site is a finding.
type Props<T extends ControlTag> = Omit<Attributes[T], 'className' | 'ref'> & {
  as?: T;
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
  ref?: Ref<TagElement[T]>;
};

export function Control<T extends ControlTag = 'input'>({ as, mono, className, ...rest }: Props<T>) {
  // `trigger` IS THE ONLY VALUE THAT IS NOT ITS OWN TAG, and this line was lost once already: a later edit
  // to the class list below replaced the whole block and reverted it, so the atom rendered a literal
  // `<trigger>` element. It is invalid HTML, it is not focusable, and THE WHOLE UNIT SUITE PASSED — 4,501
  // tests, jsdom happily building an unknown element. What caught it was the browser harness's focus walk
  // examining one or two fewer elements per surface than it had recorded.
  const Tag = (as === 'trigger' ? 'button' : (as ?? 'input')) as 'input';
  // `'vb-trigger'` IS A LITERAL IN THIS LIST and not appended to a template string, because
  // `check:class-budget` reads class names as whole tokens out of the source: built as
  // `` `${classes} vb-trigger` `` the name is still there to a human and invisible to the gate, which
  // reported the rule as referenced from nowhere the moment the two hand-rolled call sites went.
  const classes = ['vb-ctl', mono && 'vb-ctl-mono', as === 'trigger' && 'vb-trigger', className]
    .filter(Boolean)
    .join(' ');
  // A TICK IS NOT A TEXT FIELD, and this option is what let six surfaces stop hand-rolling one. The box
  // above — 28px tall, a border, a corner, `padding: 0 var(--s-4)` — is for something you type into. A
  // checkbox and a radio have an intrinsic box the browser draws, and wearing `.vb-ctl` stretches it into
  // a slab, which is exactly why six `<input type="checkbox">` sat outside the primitive. `data-kind`
  // withdraws the box; it is an attribute and not a second class, like every option in this layer.
  const type = (rest as { type?: string }).type;
  const kind = type === 'checkbox' || type === 'radio' ? 'check' : undefined;
  // THE ONE CAST, and it is JSX's limit rather than a gap in the types above: a tag chosen at run time
  // cannot be checked against a per-tag attribute map, and there is no `T` in scope for the intrinsic
  // element the compiler picks. The caller's props were already checked against `Props<T>`, which is
  // where the contract lives.
  return <Tag className={classes} data-kind={kind} {...(rest as Attributes['input'])} />;
}
