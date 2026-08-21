import { type StateName, stateClass } from './state-tones';

// THE INDICATOR. Three hand-rolled circles existed before this — `.ap-dot` (8px), `.conn` (12px) and
// `.ap-agent-dot` (7px) — each with its own `border-radius: 50%` and its own tone classes composed at
// run time from a prefix and a state word. Those composed names are why a literal grep for a class
// reported 36 of the stylesheet's 457 as dead when none of them was; see the *Risks* section of
// docs/design-system.md.
//
// THE `tone` PROP IS GONE AND A `state` TOOK ITS PLACE. Phase 13. It was one of the four separate
// mechanisms for showing a state, and it was the one that made a surface translate: AutopilotBar held
// its own `DOT_TONE` table mapping five transport states onto five tone names, so `complete` was `ok`
// there and `--accent` in the top bar's chip for the same loop in the same moment. A dot names the
// state now and ui/state-tones.ts decides what colour that is, exactly as a chip does.
export type DotSize = 7 | 8 | 12;

interface Props {
  // ABSENT IS NOT `neutral`, and it never was. Absent means the fill falls through to `--tone` inherited
  // from whatever wrapper knows the state, and then to `currentColor` — which is the idiom
  // `.ap-agent-dot-bad` used and stated its reason for: the tone colours the word, and a second colour
  // declaration is a second thing to keep in step. Three of the four call sites want exactly that.
  state?: StateName;
  size?: DotSize;
  // THE HALO, and it is emphasis rather than a tone: `--glow` is `none` in two of the three themes, and
  // the transport dot never had one while the connection light always did. Two call sites — the app's
  // health and the copilot's — and it used to be two `[data-state='online']` rules that each decided a
  // colour, which is what this phase removes.
  glow?: boolean;
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

export function Dot({ state, size = 8, glow, pulse, className, testId }: Props) {
  const classes = [
    'vb-dot',
    `vb-dot-${size}`,
    state && stateClass(state),
    glow && 'vb-dot-glow',
    pulse && 'vb-dot-pulse',
    className,
  ];
  // `aria-hidden` unconditionally: a dot is never the only statement of a state on this board — the
  // word beside it always says the same thing — so announcing it would read the state twice.
  return (
    <span
      className={classes.filter(Boolean).join(' ')}
      data-state={state}
      data-testid={testId}
      aria-hidden="true"
    />
  );
}
