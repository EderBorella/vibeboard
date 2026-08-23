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
// THE OVERRIDE STRIP IS DELIBERATELY NOT IN THE LIST. It is a direct child of `.copilot` like the rest,
// and it pads itself by `--s-4` rather than by the gutter — it is the one strip that reads as an aside
// inside the dock rather than as a row of it. Naming the exclusion rather than widening the claim: a list
// that quietly included it would have to assert "some horizontal padding", which the broken row would
// have passed the moment anybody gave it any value at all. (It was `.copilot-override`; the class went in
// wave 2 with the five below, and its `pad={[2, 4]}` is what states the difference now.)
import { describe, expect, it } from 'vitest';
import { box } from './css-box.js';

// A DETACHED ELEMENT, because `el.matches()` works on one and `box()` does its selector work with it —
// the same fixture shape test/panel-twenty.test.tsx uses. Nothing is mounted and nothing is rendered.
//
// THE FIXTURE IS THE OPEN TAG AND NO LONGER A CLASS NAME, and that is what wave 2 of the atomic revamp
// changed here. Five of these seven rows have no class at all now: `Stack`'s `pad` and `edge` are
// attributes, so `.copilot-head` and its four siblings — each `padding: var(--s-N) var(--s-5)` plus one
// hairline, and nothing else — are `<Stack pad={[N, 5]} edge="bottom">` at the call site. A class-only
// fixture cannot express that and would report an EMPTY box for all five, which is precisely the vacuous
// pass this file exists to refuse. So each row is written out as the markup it renders.
function el(markup: string): Element {
  const host = document.createElement('div');
  host.innerHTML = markup;
  const found = host.firstElementChild;
  if (!found) throw new Error(`no element for ${markup}`);
  return found;
}

// The dock's own gutter, written once. Every row below is asserted against THIS rather than against each
// other: a mutual comparison passes when all seven drift together, which is the one change that would
// actually be deliberate and the one this test has no opinion about.
//
// `12px` AND NOT `'var(--s-5)'`, and the distinction is the whole reason test/css-box.tsx resolves tokens:
// the gutter was `0.75rem` until the space sweep and is `var(--s-5)` now, which is the SAME twelve pixels.
// Writing the token name here would make the assertion compare a literal to itself the moment the
// resolver stopped working, which is the dangerous repair that file's own header warns about.
const GUTTER = '12px';

// EVERY ROW OF THE DOCK, EACH AS IT ACTUALLY RENDERS. Two mechanisms and one claim: the five that lost
// their class carry the gutter as `data-pad-x="5"` on `.vb-stack`, and the two that kept one carry it in
// that class's own `padding` shorthand. Both resolve to the same twelve pixels, which is the point — a row
// is either padded by the dock gutter or it is a defect, and how it says so is not the claim.
//
// THE TWO THAT KEEP A CLASS KEEP IT FOR A REASON THAT IS NOT THE PADDING. `.copilot-selects` pads
// `0 var(--s-5) var(--s-4)` — asymmetric in the block axis, where `pad` is one value per axis — and both it
// and `.copilot-input` are the selector their `.vb-ctl` child's `flex`/`resize` is written against.
const ROWS: [name: string, markup: string][] = [
  ['copilot-head', '<div class="vb-stack" data-pad-y="4" data-pad-x="5" data-edge="bottom">x</div>'],
  ['copilot-chatbar', '<div class="vb-stack" data-pad-y="3" data-pad-x="5" data-edge="bottom">x</div>'],
  ['copilot-controls', '<div class="vb-stack" data-pad-y="4" data-pad-x="5" data-edge="bottom">x</div>'],
  ['copilot-selects', '<div class="copilot-selects">x</div>'],
  ['copilot-status', '<div class="vb-stack" data-pad-y="2" data-pad-x="5" data-edge="bottom">x</div>'],
  ['copilot-authority', '<div class="vb-stack" data-pad-y="4" data-pad-x="5" data-edge="bottom">x</div>'],
  ['copilot-input', '<div class="copilot-input">x</div>'],
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

// `padding-inline` FIRST, because that is what the atom declares and it is the more specific of the two:
// `.vb-stack[data-pad-x='5']` is (0,1,1) against a surface class's (0,1,0), which atoms/stack.css argues
// for by name. A row that declares neither has an empty box and fails on the emptiness below.
function horizontal(drawn: Record<string, string>): string[] {
  const inline = drawn['padding-inline'];
  return inline === undefined ? sides(drawn.padding) : sides(inline);
}

describe('the copilot dock', () => {
  it.each(ROWS)('%s pads itself to the dock gutter', (row, markup) => {
    const drawn = box(el(markup));
    const declared = drawn['padding-inline'] ?? drawn.padding;
    expect(declared, `${row} declares no horizontal padding at all`).toBeTruthy();
    const sideValues = horizontal(drawn);
    expect(sideValues.length, `${row}'s padding parsed to nothing: ${declared}`).toBeGreaterThan(0);
    for (const value of sideValues) expect(value).toBe(GUTTER);
  });

  // ANTI-VACUITY, and it is the failure this whole file is about: a row with no rule resolves to an empty
  // box, and an empty box passes every assertion written as "if it declares X then X is right". The list
  // is checked against the stylesheet in one direction — every fixture resolves — because the defect was a
  // MISSING rule, not a wrong one. It bites harder now than it did: five of the seven are matched by an
  // ATTRIBUTE selector, so a typo in `data-pad-x` or a `pad` prop dropped at a call site lands here as an
  // empty box rather than as a wrong number.
  it('every row in the list resolves to a rule', () => {
    for (const [row, markup] of ROWS) {
      const resolved = box(el(markup));
      expect(
        Object.keys(resolved).length,
        `${row} matched no rule in any sheet web/src/styles.ts loads`,
      ).toBeGreaterThan(0);
    }
  });

  // AND THE FIVE THAT MIGRATED REALLY DID LOSE THEIR CLASSES, asserted as the negative. Without this the
  // fixtures above would keep passing on the atom alone while five dead rules sat in copilot.css declaring
  // the same padding a second time — which is the half-finished migration atoms/stack.css warns about,
  // and at (0,1,0) against the atom's (0,1,1) it would be invisible in the browser too.
  it.each([
    ['copilot-head'],
    ['copilot-chatbar'],
    ['copilot-controls'],
    ['copilot-status'],
    ['copilot-authority'],
  ])('.%s is gone from the stylesheet', (cls) => {
    // AGAINST A NAME NOTHING DEFINES, not against `{}`: a bare `<div>` picks up design/reset.css's `*`
    // rule, so an empty box is not empty. The comparison is "this class list draws what a class list
    // drawing nothing draws", and it cannot pass vacuously — `.copilot-selects` and `.copilot-input`,
    // which really do still declare a box, differ from this baseline.
    const nothing = box(el('<div class="vb-no-such-class">x</div>'));
    expect(box(el(`<div class="${cls}">x</div>`))).toEqual(nothing);
  });
});
