import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

// THE BUTTON. One geometry, four voices, two sizes — against the 56 classes that were on a `<button>`
// and declared their own radius, padding or font-size before this existed. The census and the argument
// are in docs/design-system.md; the incident that pays for it is one button borrowed from a card report
// list rendering at 10.88px inside a 12.16px bar, invisible to 2,000 green jsdom tests.
//
// `size` IS A HORIZONTAL AXIS ONLY as of the atom layer, which is why all 67 call sites are untouched by
// the change that matters most here: the box declares `height: var(--ctl-h)` and its vertical padding is
// gone. A height nobody declares is a height nobody chose — it is padding plus a line box plus a border,
// so a badge inside a tab changed the tab — and ten unchosen control heights is the measured diagnosis
// this whole revamp answers. `md` is still a bigger label with more room beside it; it is no longer a
// bigger box.
//
// `className` IS FOR LAYOUT AND NOTHING ELSE — `align-self`, `flex`, `min-width`, a margin, or a
// non-geometry colour a surface genuinely owns. It is not a hole to put a padding back through, and
// `npm run check:radius-scale` fails on any rule that names a `<button>` class and declares
// `border-radius`, `padding` or `font-size`. The split is the point: the primitive owns the box, the
// caller owns where the box sits.
// FIVE, and the fifth was added by measurement rather than taste. Phase 3 shipped four and left 46
// classes hand-rolled; going through them, TEN were the same shape under ten names — `background:
// transparent; border: none; color: var(--muted); cursor: pointer`, differing only in a font-size
// nobody chose and a hover colour that is genuinely the surface's: `.modal-close`, `.mp-modal-close`,
// `.cards-tab-x`, `.res-del`, `.chat-del`, `.tile-archive`, `.column-add`, `.control-new`, `.mp-star`,
// `.dock-collapse`, plus `.tag-filter-clear` and `.cv-link-edit` which add an underline.
//
// Asking "which of the four would have to lie" of each of those gets the same answer twelve times —
// ALL FOUR, because every one of them draws a box and these have none. Twelve identical answers is not
// twelve survivors, it is a missing voice: exactly the reasoning that gave the type scale's top step a
// consumer in Phase 2, where the scale turned out not to be short. Here it was. (That step was
// `--t-display` and it has since retired — one consumer is not a step — which does not weaken the shape
// of the argument, only that instance of it.)
export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger' | 'bare';
export type ButtonSize = 'sm' | 'md';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  // A LEADING LABEL, AND IT IS THREE CLASSES OTHERWISE. `.conn-status`, `.cs-action` and `.option-btn`
  // each declared `text-align: left` and NOTHING else: all three are full-width buttons in a flex column
  // — a skill to run, a next step to pick, a connection to inspect — where a centred label reads as a
  // dialog action rather than as a row you choose. That is one decision written three times, and spelled
  // as an attribute it costs no class.
  align?: 'start';
  // Layout only. See above.
  className?: string;
  children?: ReactNode;
  // DECLARED, not forwarded. React 19 passes `ref` as an ordinary prop to a function component, so it
  // reaches `<button>` through the spread on its own — but `ButtonHTMLAttributes` does not name it, so
  // without this line every caller that focuses a button is a type error. Three do, and each has a
  // reason: the halt overlay's Restart, the sign-in prompt's Refuse and the confirm dialog's Cancel all
  // take focus when they mount, so the reflex Enter lands on the safe answer.
  ref?: Ref<HTMLButtonElement>;
}

// `type="button"` BY DEFAULT, not by hope. A `<button>` inside a `<form>` defaults to `submit`, and
// several of these sit in the settings and gate forms — one of them submitting on click would be a
// behaviour change nothing in this phase asked for. Overridable, because the gate form has a real
// submit.
export function Button({ variant = 'default', size = 'sm', align, className, type, ...rest }: Props) {
  const classes = ['vb-btn', `vb-btn-${variant}`, `vb-btn-${size}`, className].filter(Boolean);
  return <button type={type ?? 'button'} className={classes.join(' ')} data-align={align} {...rest} />;
}
