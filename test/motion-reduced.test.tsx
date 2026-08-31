// @vitest-environment jsdom
//
// THE HOLE A JS ANIMATION LIBRARY OPENS, AND THE ONE LINE THAT CLOSES IT.
//
// `web/src/design/motion.css` guarantees reduced motion with a blanket
// `* { animation-duration: 0.01ms !important }`. That governs CSS animations and NOTHING ELSE.
// `motion` animates by writing inline styles and driving the Web Animations API, so it sails straight
// past that rule — the guarantee this app has had since the design system landed stopped covering
// everything animated the moment the dependency arrived. `MotionProvider` closes it with
// `reducedMotion="user"`, and this file is what keeps that prop from being deleted.
//
// WHAT THIS TEST DELIBERATELY DOES NOT DO, because the first version of it did and was worthless:
// assert that a transform is suppressed. jsdom implements no Web Animations API, so `motion` writes
// `transform: none` and animates nothing at all — measured, not assumed. A suppression assertion was
// therefore GREEN with the guarantee removed, for the same reason a layout assertion is green in
// jsdom whatever the CSS says. It was caught only because the paired "and it moves when NOT reduced"
// case failed, which is the whole reason that half was written.
//
// SO THE CLAIM IS THE WIRING, ASSERTED AT THE CONTEXT. `MotionConfigContext` is what every `m.*`
// component below the provider actually reads to decide whether to honour the preference, so a
// consumer reading `reducedMotion` out of it is asserting the same value the library will act on —
// not a re-render of the prop we just passed. What it cannot prove is the BROWSER's behaviour under
// the real media query; that belongs in `npm run visual`, where animations run, and it is the phase-3
// item in the plan rather than something this environment could ever answer.
//
// Proved by plant: delete `reducedMotion="user"` from design/MotionProvider.tsx and the first test
// fails with `undefined`. Restored.
import { cleanup, render, screen } from '@testing-library/react';
import { MotionConfigContext } from 'motion/react';
import { useContext } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { MotionProvider } from '../web/src/design/MotionProvider.js';

afterEach(cleanup);

function ReadsConfig() {
  const config = useContext(MotionConfigContext);
  return <span data-testid="reduced">{String(config.reducedMotion)}</span>;
}

describe('reduced motion reaches the JS animations', () => {
  it('the provider puts reducedMotion="user" on the context every m.* reads', () => {
    render(
      <MotionProvider>
        <ReadsConfig />
      </MotionProvider>,
    );
    expect(screen.getByTestId('reduced').textContent).toBe('user');
  });

  // ANTI-VACUITY, and it is not decoration: the assertion above is a string comparison against a
  // context that has a DEFAULT. Framer's default `reducedMotion` is "never", so a provider that
  // silently stopped rendering `MotionConfig` at all would hand back "never" rather than throw — a
  // different string, and the test would catch it. This proves that is the value being distinguished
  // FROM, so "user" means the provider acted rather than the default happening to agree.
  it('the bare context defaults to never, which is what "user" is distinguished from', () => {
    render(<ReadsConfig />);
    expect(screen.getByTestId('reduced').textContent).toBe('never');
  });
});
