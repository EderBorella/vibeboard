import type { MouseEvent, ReactNode } from 'react';
import { type StateName, stateClass, type Tone, toneClass } from '../molecules/state-tones';

// THE CHIP. Tags, state words, counts and badges — the same bordered pill rebuilt by hand at a dozen
// sites, each with its own radius, padding and font-size.
//
// `tone` AND `state` ARE TWO WAYS TO THE SAME FIVE COLOURS, and Phase 13 is where that became true.
// Until then `state` was a `string` rendered as `data-state` "so the surface can still colour it", and
// the argument for it was that three vocabularies did not fit the five tones — `attention`, `running`
// and `connecting` were `--accent-2`, the palette's secondary, which is not `--warn` in marshmallow.
//
// THAT ARGUMENT WAS ABOUT THE WRONG THING. It defended the TOKEN each surface had picked, and the
// measurement is what settled it: `running` came out `--text` on a report chip, `--accent-2` on the top
// bar's chip and `--accent` on the auto-pilot bar's rail — one fact, three colours, on three surfaces a
// person reads in one glance. `--accent-2` is the secondary HUE; `--warn` is the attention token; and a
// state that wants attention takes the attention token wherever it is said. So `state` is a
// `StateName` now, molecules/state-tones.ts maps it to a tone, and a surface has nothing left to choose.
//
// `tone` SURVIVES for the markers that are not states of anything: a tag, a count, the three words on a
// card tile. Both props reach the same five `.vb-tone-*` rules, which is what makes the shared tone set
// real rather than nominal.
//
// `data-state` STAYS ON THE ELEMENT and now decides nothing — it is what a test and a person reading
// the DOM select on, and it is the name that says which of the five this is.
//
// A CHIP MAY BE A `<button>`, and Phases 3, 4 and 5 all said so without making it possible. Each of them
// listed `.tag`, `.tag-chip`, `.mp-chip` and `.board-archive` as survivors with the same reason — *"a
// Chip that happens to be clickable: `Chip` owns that box, not `Button`; making it a button gives it a
// button's radius and padding"* — and then left them hand-rolled, because the primitive rendered a
// `<span>` and nothing else. The box is the same box whether or not it takes a click, which is the
// argument `Surface`'s `as="button"` already rests on: the tag says what this thing IS in the document,
// and it does not change what it looks like.
//
// THE BOX HAS A HEIGHT NOW — `--mark-h`, 16px — and `line-height: inherit` is withdrawn with it. That
// declaration existed so a `<span>` rendered what a span renders, which was true while the box had no
// height and stopped being true the moment it had one: a chip in the Project Log's prose measured 25.25px
// against 15px on the board, because the surrounding line-height was deciding the marker's size. One
// marker height everywhere is what the browser harness's check 13 asserts, on every surface.
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
  // A CLOSED SET, for `Surface`'s reason: `as` says what the box is in the document — a label or a
  // control — and an open tag would make this a general element factory whose geometry claim is empty.
  as?: ChipTag;
  // A row in molecules/state-tones.ts. See above.
  state?: StateName;
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

// THE CLASS LIST, EXPORTED, and the export is what makes `StatusChip` possible without a second copy of
// these names. `Popover` renders its own `<button>` — it owns the open state and the dismiss handlers —
// so a status chip cannot BE a `<Chip>`; it can only wear one. Writing `vb-chip vb-chip-pill` out by hand
// in that file would be a chip's box decided outside the chip, which is precisely what this directory was
// built to stop.
//
// `toned` RATHER THAN A TONE OR A STATE, because the two callers arrive at the tone class by different
// routes: `Chip` resolves it here, and `Popover` sets it from `triggerState` alongside the `data-state`
// attribute it must not disagree with. Passing a state through both would put the same class in the
// attribute twice.
export function chipClasses({
  pill,
  fill,
  toned,
  className,
}: {
  pill?: boolean;
  fill?: boolean;
  toned?: boolean;
  className?: string;
}): string {
  return ['vb-chip', pill && 'vb-chip-pill', fill && 'vb-chip-fill', toned && 'vb-chip-tone', className]
    .filter(Boolean)
    .join(' ');
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
  // `vb-chip-tone` carries the ink and the edge and the `vb-tone-*` class carries the colour, so a chip
  // with neither prop keeps `color: inherit` — the run-id chips inside a toned `.filed-entry` would
  // otherwise take that entry's tone by inheritance. See ui/primitives.css.
  const classes = chipClasses({
    pill,
    fill,
    toned: Boolean(tone || state),
    className: [tone && toneClass(tone), state && stateClass(state), className].filter(Boolean).join(' '),
  });
  // `type="button"` BY DEFAULT for Button's and Panel's reason: a `<button>` inside a `<form>` defaults
  // to `submit`, and a tag filter that submitted the form around it is a behaviour change.
  const control =
    as === 'button'
      ? { type: 'button' as const, 'aria-pressed': ariaPressed, 'aria-expanded': ariaExpanded }
      : {};
  return (
    <Tag
      className={classes}
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
