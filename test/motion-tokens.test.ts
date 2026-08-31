// @vitest-environment jsdom
//
// THE MOTION VALUE IS WRITTEN TWICE, AND THIS IS WHY THAT IS SAFE.
//
// `web/src/design/motion.ts` is the source: a JS animation needs a number it can read without asking
// the DOM, and `motion` takes milliseconds. A CSS animation cannot read that constant at all, so any
// duration a CSS rule spends has to be spelled again as a custom property. Two spellings of one value
// is exactly the drift this repository has been deleting for fourteen phases — the only thing that
// makes it acceptable is a test that fails when they disagree.
//
// RESOLVED OUT OF THE STYLESHEET, through the same resolver test/copilot-rows.test.tsx uses.
// `getComputedStyle` in jsdom answers '' whatever the rule says, so a test written that way would
// pass with the declaration deleted — which is worse than no test.
//
// ONE NAME TODAY, AND THAT IS THE DESIGN. The plan said mirror all five; `check:tokens` refused,
// because four are read only from JS and would have been properties no rule references. A name is
// mirrored when a CSS rule spends it. If that list grows, add the row here in the same commit — a
// mirrored name with no row is the case this file exists to catch.
import { describe, expect, it } from 'vitest';
import { DURATION } from '../web/src/design/motion.js';
import { resolve } from './css-box.js';

// [custom property, the JS constant it must equal, the rule that spends it]
const MIRRORED: [property: string, expected: number, spentBy: string][] = [
  ['--motion-duration-slow', DURATION.slow, '.vb-dot-pulse in molecules/status-chip.css'],
];

describe('motion tokens', () => {
  it.each(MIRRORED)('%s equals the JS constant', (property, expected) => {
    const resolved = resolve(`var(${property})`);
    expect(resolved, `${property} resolved to nothing — is it defined in design/tokens.css?`).toBeTruthy();
    expect(resolved).toBe(`${expected}ms`);
  });

  // ANTI-VACUITY. `resolve` answers the input string back when it cannot find the property, so a typo
  // in the name above would compare `var(--typo)` to `1600ms` and fail loudly — but a property that
  // resolved to an EMPTY string would slip past a `toBe` written the other way round. Asserted here
  // as the negative: a name nothing defines must not look like a name that resolves.
  it('a property nothing defines does not resolve to a value', () => {
    expect(resolve('var(--motion-no-such-name)')).not.toMatch(/^\d+ms$/);
  });
});
