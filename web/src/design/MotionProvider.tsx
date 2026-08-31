import { LazyMotion, MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

// THE ONE PLACE MOTION IS CONFIGURED, mounted once at the root by `shell/App.tsx`.
//
// `reducedMotion="user"` IS THE WHOLE REASON THIS COMPONENT EXISTS, and it closes a hole that opens
// the moment a JS animation library enters the tree. `design/motion.css` guarantees reduced motion
// with a blanket `* { animation-duration: 0.01ms !important }` — that governs CSS animations and
// NOTHING ELSE. `motion` animates by writing inline styles and driving the Web Animations API, so it
// sails straight past that rule. Without this prop, a person who has asked their operating system for
// reduced motion gets every animation anyway, and nothing on screen or in a gate says so.
//
// `"user"` and not `"always"`: it reads the OS preference rather than deciding for everyone. Framer's
// rule under it is to suppress transform and layout animations while still allowing opacity and
// colour, which is the right line — the reduced-motion request is about vestibular movement, and a
// fade carries no movement. That is why the liveness pulse below can stay legible either way.
// `test/motion-reduced.test.tsx` holds this, and it was proved by removing this prop and watching it
// fail rather than by reading the documentation.
//
// `LazyMotion` + `domAnimation` IS A BUNDLE DECISION. Importing `motion.div` pulls every feature —
// drag, layout projection, scroll — into the entry chunk whether or not a single call site uses them.
// `LazyMotion` loads only the feature set named here, and `m.div` is the component that carries no
// features of its own. `domAnimation` covers animation, variants, exit and gestures; `domMax` adds
// drag and layout projection and roughly doubles the cost. Nothing in this app drags or projects yet,
// so the smaller bundle is the honest default — a call site that needs `domMax` should change this
// deliberately and record what it cost.
//
// `strict` MAKES THE MISTAKE LOUD. With it, rendering `motion.div` anywhere throws instead of quietly
// loading the full bundle at that call site and defeating the point of `LazyMotion`. The rule is: use
// `m.*` from `motion/react-m`, never `motion.*`.
const loadFeatures = () => import('./motion-features').then((mod) => mod.default);

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
