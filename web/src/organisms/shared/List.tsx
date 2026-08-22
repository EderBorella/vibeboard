import type { HTMLAttributes, ReactNode } from 'react';

// LIST — a column of `Row`s with a gap. Six of the nineteen families were a `<ul>` and every one of them
// cancelled `list-style` itself; the other thirteen were a `<div>` with `flex-direction: column` and one
// of seven gaps.
//
// ONE CLASS, TWO JOBS, and it is the same job twice: `.vb-list` is a column of lines with a gap, which is
// what a list of rows is and what a `Row stack` is. That is why `Row`'s `stack` option reaches for this
// class rather than a sixth one of its own.
//
// NO `gap` OPTION. Seven gaps existed and nothing chose the spread; `--s-1` is what fourteen of the
// nineteen already used and what a list of adjacent rows should be — the rows have their own padding.
// A surface that genuinely needs a looser column says so in its own sheet, which is one declaration.
interface Props extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'className'> {
  as?: 'div' | 'ul' | 'ol';
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
