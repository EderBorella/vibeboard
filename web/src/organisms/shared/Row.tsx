import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import type { StackGap } from '../../atoms/Stack';
import { Surface, type SurfaceVariant } from '../../atoms/Surface';
import type { Tone } from '../../design/state-tones';

// ROW — one line of a list. Nineteen families built this by hand — the census is in docs/design-system.md,
// *The atomic revamp: the seven phases*, Phase 6 — and disagreed about
// four things, none of which anybody chose: the gap, the rail width, how a cell takes the slack, and what
// selected looks like. See organisms/shared/list.css for the measurements.
//
// IT COMPOSES `Surface` AND DRAWS NO BOX OF ITS OWN. That is the line: whether the box is drawn is
// `Surface`'s question (`flat` undrawn, `inset` drawn, `plain` no box at all) and how the row ARRANGES
// its cells is this one's. A row that drew its own box would be the eleventh thing in this tree with an
// opinion about `border-radius`.
//
// `rail` IS WHERE `--rule` AND `--tone` MEET. Passing a tone puts `.vb-tone-*` on the row, which assigns
// `--tone`, which the rail reads — so the colour is the table's and the width is the token's, and neither
// is the surface's. `rail` alone (no tone) is the quiet 3px edge eleven of these already drew.
export interface RowProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'className'> {
  // `plain` means no `Surface` box at all — the row is a bare arrangement, which is what nine of the
  // nineteen were. `flat` and `inset` are the atom's two undrawn/drawn nested boxes.
  variant?: SurfaceVariant | 'plain';
  as?: 'div' | 'li' | 'button';
  // A left edge that MEANS something. `true` for the quiet one, a tone name for a state's colour.
  rail?: boolean | Tone;
  // Clickable: a ground on hover, an accent edge when `active`.
  interactive?: boolean;
  active?: boolean;
  // Two lines rather than a line of cells. Five of the nineteen stacked, and `.vb-list` is the same
  // column-with-a-gap a list of rows is — one class, both jobs.
  stack?: boolean;
  // THE GAP BETWEEN A ROW'S CELLS, and `.explorer-item` was it written alone: `gap: var(--s-2)` and
  // nothing else, because a file row's icon, name and marker sit tighter than a list row's cells. Reaches
  // BOTH classes, because `stack` decides which one this element wears — a stacked row is `.vb-list`.
  gap?: StackGap;
  // The cells before and after the one that takes the slack: a twisty, a star, a `✕`. Rendered around
  // `children`, which is wrapped in `.vb-row-main` only when either is present — a row with no lead and
  // no trail has nothing to take the slack FROM.
  lead?: ReactNode;
  trail?: ReactNode;
  // Layout only, and a treatment the surface genuinely owns. Not a padding: check:radius-scale.
  className?: string;
  children?: ReactNode;
  disabled?: ButtonHTMLAttributes<HTMLButtonElement>['disabled'];
}

export function Row({
  variant = 'plain',
  as = 'div',
  rail,
  interactive,
  active,
  stack,
  gap,
  lead,
  trail,
  className,
  children,
  disabled,
  ...rest
}: RowProps) {
  // `vb-stack` ALWAYS, AND THAT IS THE COMPOSITION. `.vb-row` was `display: flex; align-items: center;
  // gap: var(--s-4)` plus three declarations of its own, and `.vb-list` was the same three with
  // `flex-direction: column` and a tighter gap. Both of them were the ATOM, written again — so both now
  // wear it and keep only what they add: a row adds `width: 100%` and `text-align: left`, a list adds the
  // UA list reset. The direction and the gap come from `Stack`'s own attributes below.
  const classes = [
    'vb-stack',
    stack ? 'vb-list' : 'vb-row',
    rail !== undefined && rail !== false && 'vb-row-rail',
    typeof rail === 'string' && `vb-tone-${rail}`,
    interactive && 'vb-row-hit',
    active && 'active',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  // HOISTED, because the same two expressions appeared in both return branches and the rule that fired is
  // cognitive complexity, which counts NESTING. Naming them once flattens it and says what they are.
  const dir = stack ? 'column' : undefined;
  // FULL WIDTH WHENEVER IT STACKS, because `.vb-row` declares `width: 100%` and `.vb-list` — which the
  // stacked form emits INSTEAD — does not. A `<button>` shrinks to fit, so `Row as="button" stack` was
  // sizing to its content and leaving its container's slack unclaimed. See atoms/stack.css.
  const wide = stack ? '' : undefined;
  // `--s-1` for a stacked row and `--s-4` for a line of cells: the two gaps `.vb-list` and `.vb-row`
  // declared before either of them wore the atom.
  const gapStep = String(gap ?? (stack ? 1 : 4));
  const inner =
    lead === undefined && trail === undefined ? (
      children
    ) : (
      <>
        {lead}
        <span className="vb-row-main">{children}</span>
        {trail}
      </>
    );
  if (variant === 'plain') {
    // A `<button>` with no `Surface` still needs the UA styles undone, which is `Surface`'s `flat`. So
    // `plain` is a `<div>` or an `<li>` only, and asking for a plain button is asking for `flat`.
    const Tag = as === 'button' ? 'div' : as;
    return (
      <Tag className={classes} data-dir={dir} data-gap={gapStep} data-wide={wide} {...rest}>
        {inner}
      </Tag>
    );
  }
  return (
    <Surface
      variant={variant}
      as={as}
      className={classes}
      data-dir={dir}
      data-gap={gapStep}
      data-wide={wide}
      disabled={disabled}
      {...rest}
    >
      {inner}
    </Surface>
  );
}
