import type { ReactNode } from 'react';

// A flex row or column with a gap on the space scale. See `atoms/stack.css` for the census that says why
// this had to exist, and why every option below is an attribute rather than a class.

export type StackGap = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type StackAlign = 'center' | 'start' | 'baseline' | 'stretch';
export type StackTag = 'div' | 'section' | 'header' | 'footer' | 'nav' | 'ul' | 'ol' | 'li' | 'form';

interface Props {
  direction?: 'row' | 'column';
  gap?: StackGap;
  align?: StackAlign;
  wrap?: boolean;
  justify?: 'end' | 'between';
  as?: StackTag;
  className?: string;
  testId?: string;
  children?: ReactNode;
}

export function Stack({
  direction = 'row',
  gap,
  align,
  wrap,
  justify,
  as: Tag = 'div',
  className,
  testId,
  children,
}: Props) {
  return (
    <Tag
      className={className ? `vb-stack ${className}` : 'vb-stack'}
      data-dir={direction === 'column' ? 'column' : undefined}
      data-gap={gap === undefined ? undefined : String(gap)}
      data-align={align}
      data-wrap={wrap ? '' : undefined}
      data-justify={justify}
      data-testid={testId}
    >
      {children}
    </Tag>
  );
}
