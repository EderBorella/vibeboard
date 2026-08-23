import type { HTMLAttributes, ReactNode } from 'react';
import type { StackGap } from '../../atoms/Stack';

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
// AND THE OTHER FIVE HAD TO SAY SO, which was the honest cost of the option not existing. Two did:
// `.control-list` keeps 16px and `.gate-card .gate-list` keeps 6px. One declaration is the price; a silent
// 2px is not.
//
// `.gate-card .gate-list`'s EXTRA WEIGHT IS NOW REDUNDANT AND THE REASON WRITTEN HERE IS STALE. It was
// bought at (0,2,0) specifically to outrank `.vb-list` from a sheet imported BEFORE it; the templates phase
// moved `list.css` above every surface sheet (see `styles.ts`), so `.gate-list` alone would win on order.
// Left as it is: it is harmless weight, and (0,2,0) is what keeps it correct if the order ever moves back.
// The declaration is what is load-bearing, not the descendant.
// `'nav'` IS THE FOURTH TAG AND IT IS NOT A WIDENING FOR CONVENIENCE. `ControlFileList` renders the file
// list as a `<nav>` — it is the page's navigation between files, and the element is the accessibility
// claim — and with no `nav` here it hand-wrote `className="vb-list control-list"`, which is a caller
// reaching past the component to its class. A component whose tag set cannot express a real call site
// gets bypassed, and a bypassed component stops being where the shape is decided.
interface Props extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'className'> {
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
  className?: string;
  children?: ReactNode;
}

export function List({ as = 'div', gap, fill, scroll, className, children, ...rest }: Props) {
  const Tag = as;
  return (
    <Tag
      className={['vb-list', className].filter(Boolean).join(' ')}
      data-gap={gap === undefined ? undefined : String(gap)}
      data-grow={fill ? '' : undefined}
      data-scroll={scroll ? '' : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
