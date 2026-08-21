import type { ReactNode } from 'react';
import type { Tone } from './Dot';

// THE CHIP. Tags, state words, counts and badges — the same bordered pill rebuilt by hand at a dozen
// sites, each with its own radius, padding and font-size.
//
// `tone` AND `state` ARE TWO DIFFERENT THINGS, and collapsing them is what would have made this
// primitive a liar. `tone` is a visual weight from the closed five, and the chip owns the colour.
// `state` is a surface's OWN vocabulary — a run status, a socket state, a backend name — rendered as
// `data-state` so the surface can still colour it. Three of those vocabularies do not fit the five
// tones and must not be forced into them: `--accent-2` is every theme's secondary and equals `--warn`
// in two of the three themes but NOT in marshmallow (#8a6420 against #9a5b12), so mapping "attention"
// or "connecting" onto `warn` would silently repaint the light theme. themes.css argues that
// distinction by name at `.conn-failing`; a primitive is not the place to overrule it.
//
// What the attribute buys even so: the class is no longer composed at run time, so it is visible to a
// literal grep. That is the whole defect the *Risks* section of docs/design-system.md describes.
interface Props {
  tone?: Tone;
  // `--r-pill` rather than `--r-sm`. A state word is a pill; a tag on a tile is a pill; a count is a
  // pill. A square-ish chip is the exception, which is why the flag turns it on rather than off.
  pill?: boolean;
  // The surface's own state vocabulary. See above.
  state?: string;
  title?: string;
  // Layout, and a surface's own non-geometry treatment (mono, uppercase, letter-spacing).
  className?: string;
  // So a test can find the chip without selecting on the class this phase exists to stop it selecting
  // on. Named rather than taking the attribute directly, so it cannot become a hole for arbitrary props.
  testId?: string;
  children?: ReactNode;
}

export function Chip({ tone, pill, state, title, className, testId, children }: Props) {
  const classes = ['vb-chip', pill && 'vb-chip-pill', tone && `vb-chip-${tone}`, className];
  return (
    <span className={classes.filter(Boolean).join(' ')} data-state={state} data-testid={testId} title={title}>
      {children}
    </span>
  );
}
