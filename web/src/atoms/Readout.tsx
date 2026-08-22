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
// IT IS A TREATMENT AND NOT A BOX, AND SO IT HAS NO OPTIONS AT ALL. Nine classes — four sizes, four
// tones and `quiet` — became one, and the census is what settled it rather than taste: `size="plain"`,
// which inherits both the step and the ink, was already 17 of 53 call sites; `tone="text"` had ONE
// consumer; `size="body"` and `tone="accent2"` had two each. A readout sits inside a chip, a row, a
// label or a heading that has already declared its step and its ink, so it should take both — which is
// what `plain` was, said once instead of at every site that remembered to ask for it.
//
// AND IT DELETES A SPECIFICITY DEFECT WITH THE OPTIONS. The default declared `color: var(--muted)` at
// (0,1,0), which beat `.vb-chip-tone` at (0,1,0) from later in the cascade: every report chip rendered
// grey in all seven of its statuses, a board that had failed nothing looking perfectly correct. The
// repair at the time lifted the chip's rule to (0,2,0); the cause is gone here.
//
// `className` IS FOR LAYOUT, as it is on Button and Surface — where the figure sits, never how it is set.
interface Props {
  title?: string;
  // Layout only. See above.
  className?: string;
  // So a test can find the figure without selecting on a class this layer exists to stop it selecting on.
  testId?: string;
  children?: ReactNode;
}

// A LINE of figures rather than one — the two ledgers, a card's meta row, a diary entry's meta row. It is
// the `block` half of the treatment: `Readout` is a fact, `ReadoutLine` is the row a handful of them are
// read across, and it carries the wrap and the gap so five surfaces stop each choosing their own.
//
// IT IS A MOLECULE WEARING AN ATOM'S SHEET until Phase 5 gives `FigureRow` a file of its own. Moving the
// rule now would move it in the cascade, which is a change rather than a move.
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

export function Readout({ title, className, testId, children }: Props) {
  return (
    <span
      className={['vb-readout', className].filter(Boolean).join(' ')}
      title={title}
      data-testid={testId}
    >
      {children}
    </span>
  );
}
