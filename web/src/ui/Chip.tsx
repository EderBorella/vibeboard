import type { MouseEvent, ReactNode } from 'react';
import type { Tone } from './Dot';

// THE CHIP. Tags, state words, counts and badges — the same bordered pill rebuilt by hand at a dozen
// sites, each with its own radius, padding and font-size.
//
// `tone` AND `state` ARE TWO DIFFERENT THINGS, and collapsing them is what would have made this
// primitive a liar. `tone` is a visual weight from the closed five, and the chip owns the colour.
// `state` is a surface's OWN vocabulary — a run status, a socket state, a backend name — rendered as
// `data-state` so the surface can still colour it. Three of those vocabularies do not fit the five
// tones and must not be forced into them: `--accent-2` is every theme's secondary and equals `--warn`
// in two of the three themes but NOT in marshmallow (#8a6420 against #9a5b12), so mapping "attention"
// or "connecting" onto `warn` would silently repaint the light theme. themes.css argues that
// distinction by name at `.conn-failing`; a primitive is not the place to overrule it.
//
// What the attribute buys even so: the class is no longer composed at run time, so it is visible to a
// literal grep. That is the whole defect the *Risks* section of docs/design-system.md describes.
//
// A CHIP MAY BE A `<button>`, and Phases 3, 4 and 5 all said so without making it possible. Each of them
// listed `.tag`, `.tag-chip`, `.mp-chip` and `.board-archive` as survivors with the same reason — *"a
// Chip that happens to be clickable: `Chip` owns that box, not `Button`; making it a button gives it a
// button's radius and padding"* — and then left them hand-rolled, because the primitive rendered a
// `<span>` and nothing else. The box is the same box whether or not it takes a click, which is the
// argument `Panel`'s `as="button"` already rests on: the tag says what this thing IS in the document,
// and it does not change what it looks like.
export type ChipTag = 'span' | 'button';

interface Props {
  tone?: Tone;
  // `--r-pill` rather than `--r-sm`. A state word is a pill; a tag on a tile is a pill; a count is a
  // pill. A square-ish chip is the exception, which is why the flag turns it on rather than off.
  pill?: boolean;
  // A GROUND. Four count badges each chose their own — `--panel-2` twice, `--bg` once, none once —
  // for one thing: how many items are in the group this sits beside. The fill is the distinction from a
  // state chip, which is an outline, so it is a flag rather than four classes.
  fill?: boolean;
  // A CLOSED SET, for `Panel`'s reason: `as` says what the box is in the document — a label or a
  // control — and an open tag would make this a general element factory whose geometry claim is empty.
  as?: ChipTag;
  // The surface's own state vocabulary. See above.
  state?: string;
  title?: string;
  // Layout, and a surface's own non-geometry treatment (mono, uppercase, letter-spacing).
  className?: string;
  // So a test can find the chip without selecting on the class this phase exists to stop it selecting
  // on. Named rather than taking the attribute directly, so it cannot become a hole for arbitrary props.
  testId?: string;
  // NAMED, NOT SPREAD, and the reason is the same one `testId` carries: a `{...rest}` here would let a
  // caller pass the `style` prop and put a padding back on the box the primitive exists to own. Only
  // meaningful on `as="button"`, and only attached there — `aria-pressed` on a `<span>` claims a widget
  // role the span does not have.
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  ariaPressed?: boolean;
  ariaExpanded?: boolean;
  children?: ReactNode;
}

export function Chip({
  tone,
  pill,
  fill,
  as = 'span',
  state,
  title,
  className,
  testId,
  onClick,
  ariaPressed,
  ariaExpanded,
  children,
}: Props) {
  const Tag = as;
  const classes = [
    'vb-chip',
    pill && 'vb-chip-pill',
    fill && 'vb-chip-fill',
    tone && `vb-chip-${tone}`,
    className,
  ];
  // `type="button"` BY DEFAULT for Button's and Panel's reason: a `<button>` inside a `<form>` defaults
  // to `submit`, and a tag filter that submitted the form around it is a behaviour change.
  const control =
    as === 'button'
      ? { type: 'button' as const, 'aria-pressed': ariaPressed, 'aria-expanded': ariaExpanded }
      : {};
  return (
    <Tag
      className={classes.filter(Boolean).join(' ')}
      data-state={state}
      data-testid={testId}
      title={title}
      onClick={onClick}
      {...control}
    >
      {children}
    </Tag>
  );
}
