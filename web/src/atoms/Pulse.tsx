// A NAMESPACE IMPORT because `motion/react-m` exports the elements themselves — `span`, `div` — and
// not an `m` object. Importing the object from 'motion/react' instead would pull the eager entry
// point back in and defeat the split in design/motion-features.ts.
import * as m from 'motion/react-m';
import { DURATION, EASE } from '../design/motion';
import { Stack } from './Stack';

// THREE DOTS THAT BREATHE — the app's liveness mark, and the first thing `motion` is spent on.
//
// WHY THIS IS NOT `.vb-dot-pulse`. That one is a single pip fading in place, and it says "this thing
// has a state". This says "something is happening and has not finished", which is a different claim
// and wants a different shape: a travelling wave reads as progress, where one fading dot reads as a
// heartbeat. The two coexist deliberately and neither replaces the other.
//
// WHY IT IS AN ATOM AND NOT PART OF THE INDICATOR. The tutorial and the new-project wizard are both
// carded and both wait on something that says "working". Building this inside the copilot would mean
// building it again twice — which is the argument the owner made about icons, applied before rather
// than after.
//
// STAGGERED BY INDEX, so the wave travels rather than the three blinking together. A third of the
// cycle between neighbours is what makes it read as motion instead of as a flash.
//
// OPACITY AND NOT MOVEMENT, AND THAT IS A REDUCED-MOTION DECISION. Framer suppresses transforms under
// `prefers-reduced-motion` and allows opacity, because the preference is about vestibular movement.
// So a dot that TRANSLATED would vanish entirely for those users and the indicator would go silent
// exactly where it matters most. Fading keeps the signal in both modes — see design/MotionProvider.tsx.
//
// `m` FROM `motion/react-m`, never `motion.*`. The provider runs `LazyMotion` in `strict` mode, so a
// `motion.*` here throws rather than quietly pulling the full bundle into the entry chunk.
const DOTS = [0, 1, 2];

export function Pulse() {
  return (
    // PURELY DECORATIVE, AND THE LIVE REGION IS NOT HERE. The first cut put `role="status"` and an
    // aria-label on this wrapper, which would have announced the sentence twice — once from the dots
    // and once from the caption beside them that says the same words. The caption is the thing that
    // CHANGES, so it carries the live region; three dots are not information and each is aria-hidden.
    //
    // NO CLASSES OF ITS OWN, AND TWO GATES TAUGHT US THAT. The first cut declared `.vb-pulse`
    // (inline-flex, a gap) and `.vb-pulse-dot` (an 8px circle). `check:shape-coverage`'s dot census
    // BLOCKS AT ZERO and caught the second immediately: `.vb-dot` in molecules/status-chip.css is
    // already that circle, already `flex: none`, already tone-aware, and its 8px is allowed BY NAME
    // in check:box-scale — where my `calc(var(--mark-h) / 2)` was a third box height, which is what
    // four phases of this design system went to delete. The wrapper was `Stack` written out longhand.
    // Hand-rolling a shape the primitive layer already owns is the same mistake as spelling an icon
    // with a text glyph; the gate saw it and I did not.
    <Stack gap={2}>
      {DOTS.map((i) => (
        <m.span
          key={i}
          className="vb-dot"
          aria-hidden="true"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{
            duration: DURATION.slow / 1000,
            ease: EASE.standard,
            repeat: Number.POSITIVE_INFINITY,
            // A third of the cycle per dot. `delay` and not `repeatDelay`: the latter pauses between
            // repeats and would make the wave stutter rather than travel.
            delay: (i * DURATION.slow) / 1000 / DOTS.length,
          }}
        />
      ))}
    </Stack>
  );
}
