import type { ReactNode } from 'react';

// A LINE OF FIGURES — the two ledgers, a card's meta row, a diary entry's and a filed finding's. Five
// surfaces each wrote their own version and agreed on everything except a gap nobody chose (8/8px,
// 3.2/14.4px and 8/8px), so the row is shared and what the surfaces keep is only where it sits.
//
// IT WAS `ReadoutLine` IN atoms/Readout.tsx, WHICH IS THE WRONG LAYER AND SAID SO. A `Readout` is a
// TREATMENT applied to one fact; this is a ROW of them with a wrap and a baseline — a composition, which
// is what a molecule is. The atom sheet carried its rule with a comment saying the phase that moved the
// molecules would move it, and this is that phase.
export function FigureRow({
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
