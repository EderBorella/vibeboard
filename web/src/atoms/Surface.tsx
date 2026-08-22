import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

// THE SURFACE. A container box, and the variant says whether the box is DRAWN.
//
// IT WAS `Surface`, AND THE RENAME IS THE ONLY THING THIS PHASE DID TO IT. The word collided with five
// components that are not it — `CopilotPanel`, `AutopilotPanel`, `SandboxPanel`, `DiagnosticsPanel`,
// `SignInPanel` — and with `.dock-pane`, so a reader met that word six times meaning six things. One
// vocabulary means one word per thing. The classes moved with the component rather than being left
// saying `panel` at a component called Surface; nothing about the boxes changed.
//
// NO HEIGHT, AND THAT IS THE ANSWER RATHER THAN AN OMISSION: `--ctl-h` is the height of a box you
// operate and `--mark-h` of a box you read, and a container's height is its content's.
//
//   `raised` — drawn: a panel ground, a border, a 10px corner. A surface that sits above the wash and
//              says where it ends: a board column, the archive drawer, an Execution column, the halt
//              card. All four were `--radius`'s consumers, and Phase 1 of docs/design-system.md ruled
//              that token would be deleted in the phase where a surface primitive owned them.
//   `flat`   — undrawn: no ground, a 1px TRANSPARENT border, a 6px corner. The box is there and takes
//              the same space; its edge appears only when the surface lights it — a hover, a
//              selection, a drop target. This is what a full-bleed list row is, and it is the reason
//              those ten rows could not be `Button`s: Phase 3's census says "`default`'s panel-2 fill
//              would draw a box round every row of every list", and that is true of all five voices.
//   `inset`  — drawn, but NESTED: `flat`'s corner, `flat`'s padding, `flat`'s reset, with a `--panel-2`
//              ground and a visible edge. A card on a board, an archived row, a run record, a scrolling
//              list of options, a project in the recents list, a quoted User-Agent.
//
// `inset` WAS ADDED BY MEASUREMENT, the way `Button` gained `bare` and `Chip` gained `fill`. Ten rules
// outside this file declared a 1px `--border`, a `--r-md` corner, a ground and a padding — the same box
// under ten names — and between them they wrote EIGHT paddings for it: `8px 8px`, `6px 8px`, `0.7rem`,
// `8px 0.7rem`, `4px 8px`, `0.2rem 8px`, `8px`, `8px 0.65rem`. Eight values for one property is the
// 27-font-sizes pathology one level up, and it is the third time this document has met it (Phase 4's
// eight list rows, Phase 5's five text boxes). They disagreed on the ground as well, six `--panel-2`
// against four `--bg`, and that one is NOT a distinction anybody chose: `.tile` and `.exec-run` are both
// a record in a column on a `--panel` parent and they answered differently. `--panel-2` is the mode and
// it is what this system already calls a drawn nested fill — `.vb-btn-default`'s ground and
// `.vb-chip-fill`'s. `--bg` is the ground of a control you TYPE in, which Phase 5b settled for the two
// select triggers on the same kind of measurement.
//
// THE TRANSPARENT BORDER ON `flat` IS THE SAME ARGUMENT `Button`'s `bare` AND `ghost` REST ON: a box
// that gains a border on hover must already occupy those 2px, or every row shifts under the pointer.
//
// `raised` IS A FLEX COLUMN AND `flat` IS NOT, which is not an oversight. Every raised consumer stacks
// a head over a scrolling body; a row's direction is genuinely the row's own — three of them stack two
// lines and four lay their parts out sideways — so `flat` leaves `display` to the caller.
//
// WHY IT MAY BE A `<button>`. A list row is a region of a list that happens to be clickable: it has no
// VOICE. That is the line between the two primitives, and it is the test to apply to anything new —
// if it is one of `primary`/`default`/`ghost`/`danger`/`bare`, it is a `Button`; if it is a region of
// the page that happens to take a click, it is a `Surface`. `tools/check-radius-scale.mjs` reads
// `<Surface` alongside `<button` and `<Button` for exactly this reason: a class on a Surface is a class
// on a box, and the atom owns the box.
export type SurfaceVariant = 'flat' | 'inset' | 'raised';

// A CLOSED SET, and closed on purpose. `as` exists to say what this box IS in the document — a
// region, a landmark, or a control — and an open `keyof JSX.IntrinsicElements` would make this a
// general element factory whose geometry claim means nothing.
type SurfaceTag = 'div' | 'section' | 'button';

interface Props extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'className'> {
  variant?: SurfaceVariant;
  as?: SurfaceTag;
  // The bordered row above the body. A SLOT rather than a `title` string, because every consumer puts
  // controls in it — a count, a `+`, an archive toggle — and a string prop would have grown a second
  // `actions` prop within one surface.
  header?: ReactNode;
  // Layout only, and a non-geometry treatment a surface genuinely owns — the archive drawer's dashed
  // border, a hover colour, a max-height. Not a padding: see the check named above.
  className?: string;
  children?: ReactNode;
  // Only meaningful on `as="button"`, and only spread there — `disabled` on a `<div>` is not a valid
  // attribute and React logs it on every render.
  disabled?: ButtonHTMLAttributes<HTMLButtonElement>['disabled'];
}

export function Surface({
  variant = 'raised',
  as = 'div',
  header,
  className,
  children,
  disabled,
  ...rest
}: Props) {
  const Tag = as;
  const classes = ['vb-surface', `vb-surface-${variant}`, className].filter(Boolean).join(' ');
  // `type="button"` BY DEFAULT for the same reason Button does it: a `<button>` inside a `<form>`
  // defaults to `submit`, and a list row that submitted the form it sits in would be a behaviour
  // change no phase here asked for.
  const control = as === 'button' ? { type: 'button' as const, disabled } : {};
  return (
    <Tag className={classes} {...control} {...rest}>
      {header !== undefined && <div className="vb-surface-head">{header}</div>}
      {children}
    </Tag>
  );
}
