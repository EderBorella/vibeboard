import type { ReactNode } from 'react';

// THE SIGNATURE. Every machine-measured fact is set in tabular monospace; everything a person wrote is
// not. If it is monospaced, the machine measured it; if it is not, a person wrote it — a distinction the
// eye reads with no label attached to it, on a board whose cards are human prose and whose runs are
// telemetry.
//
// It is also the thing this product needed most and had least of. A duration, a cost, a token count and
// a run id were each set in proportional type at whatever size the surrounding surface had chosen, so a
// column of them did not align and `449ms` beside `300.8s` was not comparable at a glance — which is
// literally the diagnosis in a failure that cost an afternoon. `font-variant-numeric: tabular-nums` is
// what makes a column line up on the digit; the monospace face is what says why it should.
//
// TWENTY-TWO CLASSES SAID THIS BY HAND before it existed, and eleven of them said exactly the same
// thing — `font-family: var(--font-mono); font-size: var(--t-micro); color: var(--muted)` — under eleven
// names: `.archive-when`, `.mp-count`, `.mp-id`, `.mp-ctx`, `.copilot-model`, `.chat-menu-meta`,
// `.explorer-size`, `.report-cost`, `.report-when`, `.exec-cost`, `.exec-when`. That combination is
// therefore the DEFAULT here and not a variant: eleven identical answers is one thing under eleven
// names, which is what docs/design-system.md's sweep exists to find.
//
// `className` IS FOR LAYOUT, as it is on Button and Panel — where the figure sits, never how it is set.
export type ReadoutSize = 'micro' | 'small' | 'body' | 'plain';
// `plain` inherits both size and colour, for a figure inside a line of prose that has already decided
// them. The three colours are the ones the palette already names and a person can already tell apart: an
// id is the accent, a price is the secondary, a total is full-strength ink against its muted neighbours.
export type ReadoutTone = 'muted' | 'accent' | 'accent2' | 'text';

interface Props {
  size?: ReadoutSize;
  tone?: ReadoutTone;
  // Dimmed rather than recoloured: a cap, a spent-attempt tally and a forgiven count are facts you read
  // after the one beside them, and three classes said this with `opacity: 0.85`.
  quiet?: boolean;
  title?: string;
  // Layout only. See above.
  className?: string;
  // So a test can find the figure without selecting on a class this phase deletes.
  testId?: string;
  children?: ReactNode;
}

// A LINE of figures rather than one — the two ledgers, a card's meta row, a diary entry's meta row. It is
// the `block` half of the primitive: `Readout` is a fact, `ReadoutLine` is the row a handful of them are
// read across, and it carries the wrap and the gap so five surfaces stop each choosing their own.
export function ReadoutLine({
  className,
  testId,
  children,
  as = 'div',
}: {
  className?: string;
  testId?: string;
  children?: ReactNode;
  // `p` where the line really is a paragraph of the document, which two of the five are.
  as?: 'div' | 'p';
}) {
  const Tag = as;
  return (
    <Tag className={['vb-readout-block', className].filter(Boolean).join(' ')} data-testid={testId}>
      {children}
    </Tag>
  );
}

export function Readout({
  size = 'micro',
  tone = 'muted',
  quiet,
  title,
  className,
  testId,
  children,
}: Props) {
  const classes = [
    'vb-readout',
    size !== 'micro' && `vb-readout-${size}`,
    tone !== 'muted' && `vb-readout-${tone}`,
    quiet && 'vb-readout-quiet',
    className,
  ];
  return (
    <span className={classes.filter(Boolean).join(' ')} title={title} data-testid={testId}>
      {children}
    </span>
  );
}
