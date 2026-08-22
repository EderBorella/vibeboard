// @vitest-environment jsdom
//
// THE COPILOT DOCK'S GUTTER, and it exists because one row did not have one.
//
// The Authorise button — the single control that grants the copilot write access to the project — sat in
// a bare `<div>` with no class, while its six siblings each padded themselves by `0.75rem`. So it was
// flush against the dock's left edge, touching the board behind it. Nobody decided that; the row simply
// never got a class, and nothing in 4,465 tests or 99 browser checks could see it: the harness never opens
// the copilot dock, and jsdom loads no CSS.
//
// READ OUT OF THE STYLESHEET, through the same resolver test/panel-boxes.test.tsx uses. That is the only
// instrument available here — `getComputedStyle` in jsdom answers '' whatever the rule says, so a test
// written that way would pass with the declaration deleted, which is worse than no test.
//
// `.copilot-override` IS DELIBERATELY NOT IN THE LIST. It is a direct child of `.copilot` like the rest,
// and it pads itself by `--s-4` rather than by the gutter — it is the one strip that reads as an aside
// inside the dock rather than as a row of it. Naming the exclusion rather than widening the claim: a list
// that quietly included it would have to assert "some horizontal padding", which the broken row would
// have passed the moment anybody gave it any value at all.
import { describe, expect, it } from 'vitest';
import { box } from './css-box.js';

// A DETACHED ELEMENT, because `el.matches()` works on one and `box()` does its selector work with it —
// the same fixture shape test/panel-twenty.test.tsx uses. Nothing is mounted and nothing is rendered.
function el(classes: string): Element {
  const host = document.createElement('div');
  host.innerHTML = `<div class="${classes}">x</div>`;
  const found = host.firstElementChild;
  if (!found) throw new Error(`no element for ${classes}`);
  return found;
}

// The dock's own gutter, written once. Every row below is asserted against THIS rather than against each
// other: a mutual comparison passes when all seven drift together, which is the one change that would
// actually be deliberate and the one this test has no opinion about.
const GUTTER = '0.75rem';

const ROWS = [
  'copilot-head',
  'copilot-chatbar',
  'copilot-controls',
  'copilot-selects',
  'copilot-status',
  'copilot-authority',
  'copilot-input',
];

// The horizontal component of a `padding` shorthand. One value applies to all four sides; two and three
// put the horizontal one second; four give left and right separately and are asserted as a pair.
function sides(shorthand: string | undefined): string[] {
  const parts = (shorthand ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  if (parts.length === 1) return [parts[0] as string];
  if (parts.length === 4) return [parts[1] as string, parts[3] as string];
  return [parts[1] as string];
}

describe('the copilot dock', () => {
  it.each(ROWS)('%s pads itself to the dock gutter', (row) => {
    const padding = box(el(row)).padding;
    expect(padding, `.${row} declares no padding at all`).toBeTruthy();
    const horizontal = sides(padding);
    expect(horizontal.length, `.${row}'s padding parsed to nothing: ${padding}`).toBeGreaterThan(0);
    for (const value of horizontal) expect(value).toBe(GUTTER);
  });

  // ANTI-VACUITY, and it is the failure this whole file is about: a row with no rule resolves to an empty
  // box, and an empty box passes every assertion written as "if it declares X then X is right". The list
  // is checked against the stylesheet in one direction — every name resolves — because the defect was a
  // MISSING rule, not a wrong one.
  it('every row in the list resolves to a rule', () => {
    for (const row of ROWS) {
      const resolved = box(el(row));
      expect(
        Object.keys(resolved).length,
        `.${row} matched no rule in any sheet web/src/styles.ts loads`,
      ).toBeGreaterThan(0);
    }
  });
});
