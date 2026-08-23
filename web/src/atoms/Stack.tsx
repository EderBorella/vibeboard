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
  | 'h2'
  | 'h3'
  | 'h4'
  | 'label'
  | 'form'
  | 'fieldset';

interface Props {
  direction?: 'row' | 'column';
  gap?: StackGap;
  align?: StackAlign;
  wrap?: boolean;
  justify?: 'end' | 'between' | 'center';
  // CSS'S OWN THREE SHAPES, and no more props: `N` is every edge, `[block, inline]` is the pair 26 of the
  // tree's paddings already had, and `[top, inline, bottom]` is the three-value shorthand. The first cut
  // wrote `padding-block` for the pair, which sets BOTH block edges — so a `padding-top` on its own could
  // not be said at all, and that single gap kept six classes alive.
  pad?: StackGap | [StackGap, StackGap] | [StackGap, StackGap, StackGap];
  // The single hairline that separates one row from the next. Four borders is a `Surface`.
  edge?: 'top' | 'bottom';
  // TAKE THE SPACE THE PARENT HAS, and shrink below your content when asked — `flex: 1` with both
  // `min-*: 0`, which is the trio that makes a scroller actually scroll. Six classes were exactly this.
  // THE ATTRIBUTE IS `data-grow` AND NOT `data-fill`, AND THAT IS A COLLISION I WALKED INTO. `data-fill`
  // was already taken, by a SEMANTIC flag meaning "this pane exists to be filled": `dock.css` reads
  // `.dock-body:has([data-fill]) { height: 38vh }` and `visual/support/audit.ts` resolves the open pane
  // with `querySelector('[data-fill]')` and reports its first class name. Three surfaces write it by hand.
  // So a `Stack fill` on any always-mounted box inside the dock would have pinned the dock body to 38vh at
  // rest — the exact fault check 10's first assertion exists to measure — and shadowed the real pane in the
  // harness. Two meanings, one attribute name, and only one of them is layout.
  fill?: boolean;
  // A pane that scrolls. Four classes were `overflow-y: auto` and nothing else.
  scroll?: boolean;
  as?: StackTag;
  // THE ACCESSIBLE NAME, and three of the four surfaces migrated onto this atom reported its absence as
  // the reason a class survived. `.reports`, `.options`, `.report`, `.dispatch`, `.card-skills` and `.dock`
  // are all `<section aria-label>` or `<aside aria-label>` landmarks whose only other content was a column
  // and a gap — and `screen.getByLabelText('What next')` is a live test contract, so the name could not
  // simply be dropped. A layout atom that cannot be a named region forces a class per region.
  label?: string;
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
    fill,
    scroll,
    as: Tag = 'div',
    label,
    title,
    className,
    testId,
    children,
  },
  ref,
) {
  const [padT, padX, padB] = Array.isArray(pad)
    ? pad.length === 3
      ? pad
      : [pad[0], pad[1], pad[0]]
    : [pad, pad, pad];
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
      data-pad-t={padT === undefined ? undefined : String(padT)}
      data-pad-b={padB === undefined ? undefined : String(padB)}
      data-pad-x={padX === undefined ? undefined : String(padX)}
      data-edge={edge}
      data-grow={fill ? '' : undefined}
      data-scroll={scroll ? '' : undefined}
      aria-label={label}
      title={title}
      data-testid={testId}
    >
      {children}
    </El>
  );
});
