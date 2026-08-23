import { forwardRef, type ReactNode, type Ref } from 'react';

// A flex row or column with a gap, a padding and an edge, all on the space scale. See `atoms/stack.css`
// for the census that says why this had to exist, and why every option below is an attribute rather than a
// class.
//
// THE TAG SET, THE REF AND THE TITLE ARE HERE BECAUSE THEIR ABSENCE BLOCKED REAL DELETIONS. The first cut
// took `div | section | header | footer | nav | ul | ol | li | form` and forwarded no ref, and that alone
// kept four classes alive on the first surface migrated: `.copilot` is an `<aside>`, `.cardview` an
// `<article>`, `.ctx` a `<span>` whose `title` carries the context-window figures, and `.copilot-body`
// needs a ref because it autoscrolls. None of those is a design decision about layout — they are all the
// atom being narrower than the DOM.

export type StackGap = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type StackAlign = 'center' | 'start' | 'baseline' | 'stretch';
export type StackTag =
  | 'div'
  | 'span'
  | 'section'
  | 'article'
  | 'aside'
  | 'header'
  | 'footer'
  | 'main'
  | 'nav'
  | 'ul'
  | 'ol'
  | 'li'
  | 'dl'
  | 'p'
  | 'label'
  | 'form'
  | 'fieldset';

interface Props {
  direction?: 'row' | 'column';
  gap?: StackGap;
  align?: StackAlign;
  wrap?: boolean;
  justify?: 'end' | 'between';
  // ONE VALUE IS BOTH AXES, a pair is `[block, inline]` — the spelling CSS itself uses, and the shape 26
  // of the tree's paddings already had.
  pad?: StackGap | [StackGap, StackGap];
  // The single hairline that separates one row from the next. Four borders is a `Surface`.
  edge?: 'top' | 'bottom';
  as?: StackTag;
  title?: string;
  className?: string;
  testId?: string;
  children?: ReactNode;
}

export const Stack = forwardRef<HTMLElement, Props>(function Stack(
  {
    direction = 'row',
    gap,
    align,
    wrap,
    justify,
    pad,
    edge,
    as: Tag = 'div',
    title,
    className,
    testId,
    children,
  },
  ref,
) {
  const [padY, padX] = Array.isArray(pad) ? pad : [pad, pad];
  // ONE NARROW CAST, AND NOT `any`, and the two attempts before it are worth recording because both were
  // worse. `ref as any` suppresses a lint rule that is usually pointing at something real. Widening the tag
  // to `ElementType` fails outright: TypeScript then requires the ref to satisfy EVERY tag in the union at
  // once, so `Ref<HTMLElement>` is rejected as not being `Ref<HTMLFormElement>`. Pinning the JSX element to
  // one concrete tag and casting only the ref keeps every prop below checked and states exactly what is
  // being asserted — that the caller's `HTMLElement` ref will receive whichever tag `as` selected.
  const El = Tag as 'div';
  return (
    <El
      ref={ref as Ref<HTMLDivElement>}
      className={className ? `vb-stack ${className}` : 'vb-stack'}
      data-dir={direction === 'column' ? 'column' : undefined}
      data-gap={gap === undefined ? undefined : String(gap)}
      data-align={align}
      data-wrap={wrap ? '' : undefined}
      data-justify={justify}
      data-pad-y={padY === undefined ? undefined : String(padY)}
      data-pad-x={padX === undefined ? undefined : String(padX)}
      data-edge={edge}
      title={title}
      data-testid={testId}
    >
      {children}
    </El>
  );
});
