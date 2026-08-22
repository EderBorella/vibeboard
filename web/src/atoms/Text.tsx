import type { ReactNode } from 'react';

// A LINE OF SECONDARY TEXT. The smallest atom in the set: one element, no box, and its whole job is the
// face of the words the interface says about itself.
//
// SIX CLASSES AND 87 HAND-APPLIED `className`s, AND THEY WERE NOT SIX DECISIONS. `.vb-label`,
// `.vb-label-caps`, `.vb-hint`, `.vb-error`, `.vb-empty` and `.vb-empty-small` all set `--t-small` and
// `--muted` and differed in three ways a person can see: is it italic, is it danger ink, is it a step up.
// That is `role` × `caps` × `lead`, and it is five classes instead of six because `.vb-empty-small` was
// `.vb-hint` declaration for declaration under a second name, on six call sites.
//
// `role` AND NOT A TONE, and the distinction is the one `Chip` draws between `tone` and `state`: these
// three are not three colours, they are three things the interface is DOING. A label names a control; a
// hint says how something works; an error says what was refused. Danger ink follows from the third
// rather than being asked for beside it, which is what stopped a refusal being written in muted grey at
// two of the nine sites that had one.
export type TextRole = 'label' | 'hint' | 'error';

interface Props {
  role?: TextRole;
  // THE CAPS FACE, AND IT IS A FACE RATHER THAN A LAYOUT. It was written at eight call sites before any
  // stylesheet contained the name, because the `text-transform` and the tracking sat on the fixed-width
  // RAIL a label sits in — so seven of the eight looked right by accident and the one caps label with no
  // rail rendered in lower case. The rail is a width and lives on `Field`.
  caps?: boolean;
  // ONE STEP UP, and it earns its name on the empty states: an empty pane is the only thing on the
  // surface, and reading it at a field label's step made it furniture.
  lead?: boolean;
  title?: string;
  // Layout only — where the line sits, never how it is set.
  className?: string;
  // So a test can find the line without selecting on a class this layer exists to stop it selecting on.
  // Named rather than spread, for `Chip`'s reason: a `{...rest}` here would let a caller pass `style` and
  // put a margin back on a box the atom owns.
  testId?: string;
  children?: ReactNode;
}

// A `<span>`, ALWAYS, and that is why `margin: 0` is on the base class. Half the lines this replaces were
// `<p>`s or headings taking the UA's paragraph margins — which nobody chose, and which is exactly the
// hand-written space the scale exists to remove. A span carries no margins of its own and inherits its
// display from the row it is dropped into, so a caller that wants a block puts it in one.
export function Text({ role = 'label', caps, lead, title, className, testId, children }: Props) {
  const classes = [
    'vb-text',
    // `label` is the base face and names no class of its own: it is what the other two are a variation
    // ON, and a `.vb-text-label` that declared nothing would be a name that decides nothing.
    role === 'hint' && 'vb-text-quiet',
    role === 'error' && 'vb-text-error',
    caps && 'vb-text-caps',
    lead && 'vb-text-lead',
    className,
  ];
  return (
    <span className={classes.filter(Boolean).join(' ')} title={title} data-testid={testId}>
      {children}
    </span>
  );
}
