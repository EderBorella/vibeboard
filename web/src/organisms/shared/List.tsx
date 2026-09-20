import type { ReactNode } from 'react';
import type { StackGap, StackPad } from '../../atoms/Stack';
import { Stack } from '../../atoms/Stack';

// LIST — a column of `Row`s with a gap. Six of the nineteen families were a `<ul>` and every one of them
// cancelled `list-style` itself; the other thirteen were a `<div>` with `flex-direction: column` and one
// of seven gaps.
//
// ONE CLASS, TWO JOBS, and it is the same job twice: `.vb-list` is a column of lines with a gap, which is
// what a list of rows is and what a `Row stack` is. That is why `Row`'s `stack` option reaches for this
// class rather than a sixth one of its own.
//
// THE ARGUMENT THAT THERE SHOULD BE NO `gap` OPTION, KEPT AS THE RECORD OF WHAT WAS WEIGHED AND
// OVERTURNED — see the `gap` prop below for why. The number was 5 OF 10. "Fourteen of the nineteen" stood here and is
// withdrawn: it appears in no census, it contradicted `RowInventory.stories.tsx`'s own table by a factor of
// seven, and the nineteen are the ROW families — a row's gap is horizontal and has nothing to say about the
// column its list sets. Counted directly off the sheets deleted in this commit, the list-shaped classes are
// TEN: `--s-1` ×5 (`.explorer-list`, `.diary-list`, `.suggestions-list`, `.filed-list`, `.vb-menu-list`),
// `--s-2` ×3 (`.blockers`, `.links-list`, `.cv-links`), `--s-3` ×1 (`.gate-list`), `--s-6` ×1
// (`.control-list`), plus `.mp-list`, which declared none. So `--s-1` is the plurality and not the
// majority — half the tree, and the half that is a list of adjacent rows, which is what this class is for:
// the rows carry their own padding.
//
// AND THE OTHER FIVE HAD TO SAY SO, which was the honest cost of the option not existing. One still
// does: `.control-list` keeps 16px in a declaration of its own. One declaration is the price; a silent
// 2px is not.
//
// THE PROJECT PICKER'S 6px IS THE CASE THIS PARAGRAPH USED TO BE ABOUT, and it is a `gap` prop at the
// one call site now — `.gate-list` is gone, class name included, and the record of why is in
// `pages/gate/gate.css` where the rule was. Two paragraphs stood here narrating that class's (0,2,0)
// specificity against `.vb-list`; they described a selector no stylesheet contains.
// `'nav'` IS THE FOURTH TAG AND IT IS NOT A WIDENING FOR CONVENIENCE. `ControlFileList` renders the file
// list as a `<nav>` — it is the page's navigation between files, and the element is the accessibility
// claim — and with no `nav` here it hand-wrote `className="vb-list control-list"`, which is a caller
// reaching past the component to its class. A component whose tag set cannot express a real call site
// gets bypassed, and a bypassed component stops being where the shape is decided.
// NAMED RATHER THAN SPREAD, and the reason is a trap this component walked into the moment it started
// rendering a `Stack`. It used to extend `HTMLAttributes` and spread `{...rest}` onto its own tag, which
// was fine when the tag was its own; a `Stack` deliberately does NOT spread unknown props — `Text` and
// `Chip` say why, a spread lets a caller pass `style` and put a margin back on a box the atom owns — so
// the spread became a SILENT DROP. TypeScript does not catch it: excess property checks do not apply to a
// spread. No call site passes anything extra today, so nothing was broken; the next one to pass an
// `aria-label` or an `onClick` would have been, with nothing to show it. Listing the props makes that a
// compile error instead.
interface Props {
  as?: 'div' | 'ul' | 'ol' | 'nav';
  // THE `gap` OPTION EXISTS NOW AND THE REFUSAL ABOVE IS WITHDRAWN — by decision, not because the count
  // changed. It is still 5 of 10 for `--s-1`, and the argument that a plurality is not a majority was
  // sound; what it did not price was that the other five each spell the gap a DIFFERENT way, so the shape
  // "a column of rows with a gap" had five spellings in the tree instead of one. The declaration was the
  // honest cost, and the honest cost turned out to be the thing worth removing.
  gap?: StackGap;
  // TAKE THE SPACE AND SHRINK BELOW YOUR CONTENT — `Stack`'s trio, and a list needs it for the same reason
  // a stack does: `.suggestions-list` was `min-height: 0` and nothing else, which is one third of it
  // written alone. `scroll` comes with it because a list that fills is nearly always a list that scrolls,
  // and `.mp-list` and `.links-list` each wrote both by hand.
  fill?: boolean;
  scroll?: boolean;
  // THE PADDING, FORWARDED RATHER THAN COPIED — and this is the change the refusal recorded in `shared.css`
  // asked for by name. That comment declined to give `List` a `pad` because it would be "a fourth copy of
  // `Stack`'s surface" and said the real answer was for `List` to COMPOSE `Stack` and inherit all of them.
  // It composes `Stack` as of the previous phase, so there is nothing left to copy: this is the atom's own
  // prop, its own type, handed straight through. `.mp-list` was a padding and nothing else.
  pad?: StackPad;
  className?: string;
  // The accessible name, forwarded to `Stack`'s own `label`. Four list families are landmarks.
  label?: string;
  testId?: string;
  children?: ReactNode;
}

// IT RENDERS A `Stack`, WHICH IS THE WHOLE POINT. `.vb-list` was `display: flex; flex-direction: column;
// gap: var(--s-1); min-width: 0` — the atom's column with a tighter gap, written a second time — and
// growing `gap`, `fill` and `scroll` onto it was three more copies of options `Stack` already had. So the
// component composes the atom and the class keeps ONE declaration plus the UA list reset. That is the
// difference between a design system and a directory of components that look alike.
export function List({ as = 'div', gap, fill, scroll, pad, className, label, testId, children }: Props) {
  return (
    <Stack
      as={as}
      direction="column"
      // `--s-1` AND NOT THE ATOM'S `--s-4`, because a list of adjacent rows reads tighter than a row of
      // cells and the rows carry their own padding. It was `.vb-list`'s own gap; it is this default now.
      gap={gap ?? 1}
      fill={fill}
      scroll={scroll}
      pad={pad}
      className={['vb-list', className].filter(Boolean).join(' ')}
      label={label}
      testId={testId}
    >
      {children}
    </Stack>
  );
}
