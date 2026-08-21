// THE INDICATOR. Three hand-rolled circles existed before this — `.ap-dot` (8px), `.conn` (12px) and
// `.ap-agent-dot` (7px) — each with its own `border-radius: 50%` and its own tone classes composed at
// run time from a prefix and a state word. Those composed names are why a literal grep for a class
// reported 36 of the stylesheet's 457 as dead when none of them was; see the *Risks* section of
// docs/design-system.md. A `tone` prop maps to one of a CLOSED SET the component owns, so there is
// nothing left to compose and nothing left for a grep to miss.
export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad';
export type DotSize = 7 | 8 | 12;

interface Props {
  // ABSENT IS NOT `neutral`. Absent means `background: currentColor` — the dot takes the colour of the
  // word it belongs to, which is the idiom `.ap-agent-dot-bad` already used and stated its reason for:
  // the tone class colours the text, and a second colour declaration is a second thing to keep in step.
  // `neutral` is the explicit `--muted` pip, which is a different claim.
  tone?: Tone;
  size?: DotSize;
  // The transport dot pulses while the loop runs. Motion belongs to the primitive because the
  // `prefers-reduced-motion` override that switches it off has to live beside the keyframes.
  pulse?: boolean;
  // Layout only, as on Button.
  className?: string;
  // A dot carries no text, so a test that wants one has nothing to select on but its class — which is
  // the coupling this phase exists to remove. Named `testId` rather than taking the attribute directly
  // so it cannot become a hole for arbitrary props.
  testId?: string;
}

export function Dot({ tone, size = 8, pulse, className, testId }: Props) {
  const classes = ['vb-dot', `vb-dot-${size}`, tone && `vb-dot-${tone}`, pulse && 'vb-dot-pulse', className];
  // `aria-hidden` unconditionally: a dot is never the only statement of a state on this board — the
  // word beside it always says the same thing — so announcing it would read the state twice.
  return <span className={classes.filter(Boolean).join(' ')} data-testid={testId} aria-hidden="true" />;
}
