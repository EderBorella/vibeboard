import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

// THE BUTTON. One geometry, four voices, two sizes — against the 56 classes that were on a `<button>`
// and declared their own radius, padding or font-size before this existed. The census and the argument
// are in docs/design-system.md; the incident that pays for it is one button borrowed from a card report
// list rendering at 10.88px inside a 12.16px bar, invisible to 2,000 green jsdom tests.
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
// twelve survivors, it is a missing voice: exactly the reasoning that gave `--t-display` its first
// consumer in Phase 2, where the scale turned out not to be short. Here it was.
export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger' | 'bare';
export type ButtonSize = 'sm' | 'md';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
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
export function Button({ variant = 'default', size = 'sm', className, type, ...rest }: Props) {
  const classes = ['vb-btn', `vb-btn-${variant}`, `vb-btn-${size}`, className].filter(Boolean);
  return <button type={type ?? 'button'} className={classes.join(' ')} {...rest} />;
}
