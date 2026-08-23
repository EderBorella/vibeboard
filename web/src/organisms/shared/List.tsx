import type { HTMLAttributes, ReactNode } from 'react';

// LIST — a column of `Row`s with a gap. Six of the nineteen families were a `<ul>` and every one of them
// cancelled `list-style` itself; the other thirteen were a `<div>` with `flex-direction: column` and one
// of seven gaps.
//
// ONE CLASS, TWO JOBS, and it is the same job twice: `.vb-list` is a column of lines with a gap, which is
// what a list of rows is and what a `Row stack` is. That is why `Row`'s `stack` option reaches for this
// class rather than a sixth one of its own.
//
// NO `gap` OPTION, AND THE NUMBER THAT ARGUES IT IS 5 OF 10. "Fourteen of the nineteen" stood here and is
// withdrawn: it appears in no census, it contradicted `RowInventory.stories.tsx`'s own table by a factor of
// seven, and the nineteen are the ROW families — a row's gap is horizontal and has nothing to say about the
// column its list sets. Counted directly off the sheets deleted in this commit, the list-shaped classes are
// TEN: `--s-1` ×5 (`.explorer-list`, `.diary-list`, `.suggestions-list`, `.filed-list`, `.vb-menu-list`),
// `--s-2` ×3 (`.blockers`, `.links-list`, `.cv-links`), `--s-3` ×1 (`.gate-list`), `--s-6` ×1
// (`.control-list`), plus `.mp-list`, which declared none. So `--s-1` is the plurality and not the
// majority — half the tree, and the half that is a list of adjacent rows, which is what this class is for:
// the rows carry their own padding.
//
// AND THE OTHER FIVE HAVE TO SAY SO, which is the honest cost of the option not existing. Two do:
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
  className?: string;
  children?: ReactNode;
}

export function List({ as = 'div', className, children, ...rest }: Props) {
  const Tag = as;
  return (
    <Tag className={['vb-list', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </Tag>
  );
}
