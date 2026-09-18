import { expect, test } from '../support/fixtures.js';

// REDUCED MOTION, PROVED AS BEHAVIOUR RATHER THAN AS WIRING.
//
// What existed before this file was `test/motion-reduced.test.tsx`, which asserts that
// `MotionConfigContext` carries `"user"`. That is the right thing to assert and it cannot assert what
// HAPPENS: jsdom implements no Web Animations API and no `@media (prefers-reduced-motion)`. The entry
// that asked for this recorded how that bit once — an assertion about the guarantee was GREEN WITH THE
// GUARANTEE DELETED, and only its paired "and it moves when NOT reduced" case failed. A browser is the
// only thing that can tell the difference, which is why this lives here and not beside that test.
//
// IT READS THE RULE THROUGH A PROBE ELEMENT, NOT THROUGH THE APP, and that is a deliberate narrowing
// rather than a convenience. `.vb-dot-pulse` is applied only while auto-pilot is RUNNING
// (`AutopilotBar`: `pulse={model.state === 'running'}`), and the harness cannot hold that state — a
// `running` state on disk is reconciled to `stopped`/`interrupted` the moment the server opens the
// project, because its children died with whatever wrote it. The harness's own fixture says so. So the
// probe carries the real class, the page carries the real stylesheet, and the context carries the real
// media query; what is NOT asserted here is that the class reaches the element in the right state, which
// is a different claim and is `autopilot-bar.test.tsx`'s.
//
// WHAT IS COVERED AND WHAT IS NOT, stated so the gap is not rediscovered as a finding.
//
// COVERED: the CSS half, which is the half that exists. `design/motion.css` shortens every animation and
// transition to 0.01ms under the preference; `molecules/status-chip.css` additionally names
// `.vb-dot-pulse` and sets `animation: none` — the blanket for whatever is added later, the named rule so
// the one animation there is today does not cost a compositor layer per frame for nothing.
//
// NOT COVERED: the transform half, and it cannot be until there is a transform. `motion` writes inline
// styles and drives the WAAPI, straight past the CSS rule, which is exactly why
// `design/MotionProvider.tsx` sets `reducedMotion="user"`. But the app's only `motion` animation is
// `Pulse`, and it animates OPACITY on purpose — Framer suppresses transforms under the preference and
// allows opacity, so a dot that translated would vanish for those users and the thinking indicator would
// go silent precisely where it matters most. There is nothing on screen whose suppression could be
// observed. **The trigger stands: the first `x`, `y`, `scale` or `rotate` animation added anywhere is the
// commit that owes this file a third check.** Inventing a transform fixture to have something to assert
// would test Framer rather than us, and would pass forever whatever the provider did.

// Mounted, measured and removed. A detached element gets no computed style, so it has to be in the tree.
async function probe(board: import('@playwright/test').Page) {
  return await board.evaluate(() => {
    const el = document.createElement('span');
    el.className = 'vb-dot vb-dot-pulse';
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const seen = { name: cs.animationName, duration: cs.animationDuration };
    el.remove();
    return seen;
  });
}

test.describe('17. reduced motion, unset', () => {
  test('the liveness pulse animates', async ({ board, theme }) => {
    const seen = await probe(board);
    // THE CONTROL CASE, and it is here rather than assumed: without it, "the animation is off under
    // reduce" is equally satisfied by an animation that is off ALWAYS — a deleted keyframe, a renamed
    // class, a sheet that stopped being loaded — which is the exact shape that made the jsdom assertion
    // green over a deleted guarantee.
    expect(seen.name, 'the pulse has no animation at all, reduced or not').not.toBe('none');
    expect(seen.duration, 'the pulse animates for no time even without the preference').not.toBe('0s');
    console.log(`[${theme}] motion unset: ${seen.name} ${seen.duration}`);
  });
});

test.describe('17. reduced motion, reduce', () => {
  // `emulateMedia` ON THE PAGE, not `test.use` on the context. The harness's `test` is extended with its
  // own fixtures and its `use` no longer accepts Playwright's context options; this is the direct API for
  // the same thing, and it flips the preference on the page the `board` fixture has already proved is
  // showing the board — so the stylesheet under test is the one the app actually loaded.
  test('the pulse is stopped by name, and everything else is shortened to nothing', async ({
    board,
    theme,
  }) => {
    await board.emulateMedia({ reducedMotion: 'reduce' });
    const seen = await probe(board);
    // The NAMED rule in molecules/status-chip.css.
    expect(seen.name, 'the pulse still animates under prefers-reduced-motion').toBe('none');

    // AND THE BLANKET RULE in design/motion.css, which is the one that catches whatever is added next.
    //
    // THE FIRST VERSION OF THIS ASSERTION PROVED NOTHING, and the plant is what said so. It scanned every
    // element on the page for the longest animation or transition and required it to be ~0 — which passes
    // identically whether the blanket exists or not, because nothing on the board declares one except the
    // pulse, and the pulse is already off by name. Deleting `animation-duration: 0.01ms !important`
    // planted a defect the whole harness stayed green over: a gate that cannot answer no.
    //
    // So the probe declares one INLINE instead. `!important` in an author sheet outranks a normal inline
    // declaration, so the blanket must flatten a five-second animation and a five-second transition to
    // nothing; without the blanket the inline values survive verbatim, and both assertions below fail.
    const blanket = await board.evaluate(() => {
      const el = document.createElement('span');
      el.style.animation = 'vb-dot-pulse 5s ease-in-out infinite';
      el.style.transitionDuration = '5s';
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      // MILLISECONDS, NOT THE STRING. One duration serialises two ways depending on where it came from —
      // `0.01ms` out of the sheet, `1e-05s` off the shorthand this probe sets — and the first version of
      // this compared the text, so it failed on a rule that was working perfectly.
      const ms = (v: string) =>
        v.trim().endsWith('ms') ? Number.parseFloat(v) : Number.parseFloat(v) * 1000;
      const seen = { animation: ms(cs.animationDuration), transition: ms(cs.transitionDuration) };
      el.remove();
      return seen;
    });
    expect(
      blanket.animation,
      'the blanket rule does not shorten an animation it did not name',
    ).toBeLessThanOrEqual(1);
    expect(
      blanket.transition,
      'the blanket rule does not shorten a transition it did not name',
    ).toBeLessThanOrEqual(1);
    console.log(
      `[${theme}] motion reduce: pulse ${seen.name}, blanket ${blanket.animation}ms/${blanket.transition}ms`,
    );
  });
});
