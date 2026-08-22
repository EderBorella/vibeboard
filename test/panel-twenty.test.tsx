// @vitest-environment jsdom
//
// THE TWENTY BOXES THE PANEL CENSUS STILL COUNTS, pinned before Phase 11 of docs/design-system.md
// touches any of them.
//
// A CHARACTERISATION suite, written and run green against the code as it was BEFORE any migration —
// the practice every phase here has followed, and the one that has found a real defect in each of the
// five phases that used it. It asserts the BOX A CLASS LIST DRAWS, resolved out of the stylesheets by
// test/css-box.tsx, rather than the class name that draws it: a ground moving from `.tile` in
// styles.css into `.vb-surface-inset` in primitives.css reads as the same value and the assertion
// survives the migration.
//
// WHAT IS DELIBERATELY NOT PINNED: the ten nested boxes' PADDINGS. They are nine distinct values
// across ten rules — `var(--s-4) var(--s-4)`, `var(--s-3) var(--s-4)`, `var(--s-4)`, `0.7rem`,
// `var(--s-4) 0.7rem`, `var(--s-4) 0.65rem`, `var(--s-2) var(--s-4)`, `0.2rem var(--s-4)`,
// `0.1rem var(--s-3)` — which is the 27-font-sizes pathology one level up and the thing this phase
// exists to remove. Pinning a value the phase normalises would make this suite a description of the
// old code. What IS pinned is the part that must survive: the ground, the border and the corner, which
// are what say the box is drawn and at what scale.
//
// THE TAB TABLE IS THE ONE THING HERE PINNED IN ORDER TO BE READ RATHER THAN KEPT. Phase 5b refused a
// `Tabs` primitive on a measurement of three candidates, two real; the census lists four boxes, and
// four is a different measurement. So the four are tabulated as data — resting box, face, selected
// state — and the refusal is re-taken against the table below rather than cited from the old one.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from '../web/src/atoms/Button.js';
import type { SurfaceVariant } from '../web/src/atoms/Surface.js';
import { Surface } from '../web/src/atoms/Surface.js';
import { box } from './css-box.js';

afterEach(cleanup);

// `el.matches()` works on a detached tree, so there is nothing to mount. It throws rather than
// returning null because a descendant selector missing its ancestor would otherwise make every
// assertion pass on an empty object — the fixture-too-thin failure this repository has recorded twice.
function at(html: string, selector: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  const el = host.querySelector(selector);
  if (!el) throw new Error(`no ${selector} in ${html}`);
  return el;
}

const el = (classes: string, tag = 'div') => at(`<${tag} class="${classes}">x</${tag}>`, tag);
const inside = (parent: string, tag: string) => at(`<div class="${parent}"><${tag}>x</${tag}></div>`, tag);

// A `Surface` AS THE PRIMITIVE RENDERS IT. THE ASSERTIONS BELOW SURVIVED THE MIGRATION AND THE FIXTURES
// DID NOT — which is what Phase 4 recorded of test/panel-boxes.test.tsx and Phase 8 of
// test/chip-boxes.test.tsx, and is honest to repeat rather than dress up: ten of these boxes are drawn
// by `.vb-surface-raised` or `.vb-surface-inset` now, so a hand-written class list would test a class that
// no longer draws anything. Asking the component for its own markup is what stops the fixture drifting:
// rename `vb-surface-inset` and every assertion moves with it.
function panel(variant: SurfaceVariant, className?: string, as?: 'button'): Element {
  const { container } = render(<Surface variant={variant} className={className} as={as} />);
  const it = container.firstElementChild;
  if (!it) throw new Error(`Panel rendered nothing for ${variant} ${className ?? ''}`);
  return it;
}

// THE THREE DECLARATIONS THAT MAKE A CENSUS FINDING, and the census's rule is exactly this trio:
// `panelFault` in tools/check-shape-coverage.mjs asks for a 1px border, a border-radius and a
// background TOGETHER. Reading them back through the resolver is what says a migration MOVED the box
// rather than deleted it.
//
// THE EDGE IS READ AS A PAIR, and that is the migration's own shape rather than a convenience: a hand-
// rolled box wrote `border: 1px solid var(--border)` in one shorthand, while the primitive writes
// `border: 1px solid transparent` on the shared rule and paints it with a later `border-color` — the
// construction `.vb-btn` has always used, so a variant that sets only a colour cannot change the box's
// width. Collapsing the two into one string would let a lost `border-color` read as a pass.
const drawn = (target: Element) => {
  const b = box(target);
  return {
    ground: b.background,
    edge: `${b.border} + ${b['border-color'] ?? 'no colour of its own'}`,
    radius: b['border-radius'],
  };
};

// What `.vb-surface-inset` paints, and every migrated box has to read back as exactly this.
const INSET_EDGE = '1px solid transparent + var(--border)';

describe('the raised surfaces — a --panel ground, a --border edge and a 10px corner', () => {
  // Five of the twenty declare `raised`'s own trio. Two of them ALSO stack a head over a scrolling
  // body, which is the argument `.vb-surface-raised` is a flex column at all; the other three do not,
  // and that difference is what Phase 11's refusals rest on, so both halves are pinned.
  const RAISED: [string, string][] = [
    ['modal', 'var(--panel)'],
    ['mp-modal', 'var(--panel)'],
    ['chat-menu', 'var(--panel)'],
    ['gate-card', 'var(--panel)'],
    // The one floating surface that chose the second panel step, and nothing chose it: `.chat-menu` is
    // the same kind of object on `var(--panel)`.
    ['popover', 'var(--panel-2)'],
  ];

  // The two that are NOT `Surface`s are still written as class lists, because that is what they are.
  const MIGRATED = new Set(['modal', 'mp-modal', 'chat-menu']);

  for (const [name, ground] of RAISED) {
    it(`.${name} draws a 10px corner on ${ground}`, () => {
      const b = drawn(MIGRATED.has(name) ? panel('raised', name) : el(name));
      expect(b.ground).toBe(ground);
      // `.mp-modal` is the one with a colour of its own — see below.
      expect(b.edge).toBe(
        name === 'mp-modal'
          ? '1px solid var(--border) + var(--accent)'
          : '1px solid var(--border) + no colour of its own',
      );
      expect(b.radius).toBe('10px');
    });
  }

  // THIS SUITE'S FIRST PREMISE WAS WRONG AND THE CODE IS WHAT IT IS: `.mp-modal`'s accent edge is not a
  // `border-color` override on a shared box, it is the whole `border` shorthand written out with a
  // different colour in it. The distinction matters to a migration — a shorthand at equal specificity
  // replaces the primitive's WIDTH and STYLE as well as its colour, so a primitive that later moved to a
  // 2px edge would be silently overruled here. It becomes a `border-color` in this phase, which is the
  // form the emergency stop's danger hover and `.control-disclaimer`'s prose ink already use.
  it('.mp-modal decides a colour and nothing else about its edge', () => {
    const b = box(panel('raised', 'mp-modal'));
    expect(b['border-color']).toBe('var(--accent)');
    expect(b.border).toBe('1px solid var(--border)');
  });

  // A CLASS NAMED AT A CALL SITE AND DEFINED BY NO RULE — the third of these, after `.vb-label-caps`
  // (named eight times, defined never) and `--ink`. Neither gate can see this direction, because
  // `check-class-budget.mjs` reads CSS → code and this runs the other way. `ConnectionLight` passed
  // `className="conn-pop"` to `Popover` and no stylesheet contained the string; the call site is
  // removed now, and this stays as the guard that would catch a rule appearing for a name nothing uses.
  it('.conn-pop decides nothing about the popover it is passed to', () => {
    expect(box(el('popover conn-pop'))).toEqual(box(el('popover')));
  });

  // THE POPOVER'S HALF OF THAT REASON IS GONE, and the status-indicator merge is what removed it. There
  // were two copies of this balloon's prose — `.conn-pop-{head,detail,next}` and
  // `.ap-agent-{heading,detail,next}` — and they disagreed: the connection light gave the head a bottom
  // margin and the detail none, while the auto-pilot bar gave both 0.35rem, which is 0.35rem of gap in
  // block flow and 0.7rem inside a flex column. `.vb-status-*` keeps the light's values, so no two
  // adjacent children of a popover now carry a margin at the same boundary and there is nothing left to
  // collapse. Pinned as bytes rather than as a substring for exactly that reason: which of the two sets
  // survived IS the behaviour, and `toContain` cannot tell 0 from 0.35rem.
  //
  // `.gate-card` below is the surviving reason `raised` is not simply applied to both — 1rem against
  // 1.5rem collapses to 1.5rem in block flow and stacks to 2.5rem in a flex column.
  it('a popover stacks prose whose margins no longer meet', () => {
    // The SHORTHAND, because that is what the rule writes: `box()` resolves the cascade but does not
    // expand `margin` into its four sides, so asking for `margin-bottom` here answers `undefined` — which
    // is the same value a deleted declaration would answer, and would have passed as `not.toBe`.
    expect(box(el('vb-status-head', 'strong')).margin).toBe('0 0 6px');
    expect(box(el('vb-status-detail', 'p')).margin).toBe('0');
    // The one boundary that still has a margin on it, and it is on the LOWER of the two elements.
    expect(box(el('vb-status-next', 'p'))['margin-top']).toBe('8px');
  });

  it('the gate card stacks headings whose margins meet', () => {
    expect(box(at('<div class="gate-card"><ul class="gate-list"></ul></div>', 'ul')).margin).toBe('0 0 16px');
    expect(box(at('<div class="gate-card"><h3>h</h3></div>', 'h3')).margin).toBe('24px 0 8px');
  });
});

describe('the nested boxes — a drawn edge and the smaller 6px corner', () => {
  // TEN RULES, ONE BOX, AND EIGHT PADDINGS — the measurement `inset` was built on, taken on the tree
  // before this phase touched it and recorded here because the code can no longer be asked for it:
  //   .tile 8px 8px | .archive-item 6px 8px | .markdown pre 0.7rem | .msg-assistant 6px 8px
  //   .gate-list button 8px 0.7rem | .copilot-actions button 4px 8px | .control-tabs button 0.2rem 8px
  //   .exec-run 8px 8px | .links-list 8px | .signin-label 8px 0.65rem
  // Eight values for one property on one box is the 27-font-sizes pathology, and the third time this
  // document has met it. They disagreed on the ground too — six `--panel-2` against four `--bg`, with
  // `.tile` and `.exec-run` both a record in a column on a `--panel` parent and answering differently.
  //
  // SIX OF THE TEN ARE `inset` NOW; three are survivors with a reason and one is gone. What is asserted
  // is that the six read back as ONE box, and that each survivor still says the thing that kept it out.
  const MIGRATED: [string, Element][] = [
    ['tile', panel('inset', 'tile')],
    ['archive-item', panel('inset', 'archive-item')],
    ['exec-run', panel('inset', 'exec-run')],
    ['links-list', panel('inset', 'links-list')],
    ['signin-label', panel('inset', 'signin-label')],
    ['gate-list button', panel('inset', undefined, 'button')],
  ];

  for (const [name, target] of MIGRATED) {
    it(`.${name} takes the primitive's inset box`, () => {
      const b = drawn(target);
      expect(b.ground).toBe('var(--panel-2)');
      expect(b.edge).toBe(INSET_EDGE);
      expect(b.radius).toBe('6px');
      expect(box(target).padding).toBe('6px 8px');
    });
  }

  it('the six are one box and not six', () => {
    const boxes = MIGRATED.map(([, target]) => JSON.stringify(drawn(target)));
    expect(new Set(boxes).size).toBe(1);
  });

  // `.tile`'s ACCENT LEFT EDGE is not part of the box: it is `--rule` where the primitive's is 1px, and it
  // is the one thing that says which board a card is on. It has to beat `.vb-surface-inset`'s
  // `border-color`, which it does on source order — the surface sheets load after the atoms — and the
  // hover that lights the whole box accent has to survive with it.
  //
  // 2px → 3px IS THE TOKEN BEING SPENT. `--rule` is the edge that MEANS something as against the 1px one
  // that merely separates, and the eleven rails that did that job split 6:5 between 3px and 2px by
  // nothing at all. Resolved to `3px` here rather than written as `var(--rule)`, for Phase 1's reason:
  // an expectation rewritten into the token name asserts nothing.
  it('.tile keeps a 3px accent left edge over the 1px box, and its hover', () => {
    const tile = panel('inset', 'tile');
    expect(box(tile)['border-left']).toBe('3px solid var(--accent)');
    expect(box(tile, ':hover')['border-color']).toBe('var(--accent)');
    // A `role="group"` is not a `<button>`, so `button.vb-surface`'s pointer does not reach it.
    expect(box(tile).cursor).toBe('pointer');
  });

  // THE THREE SURVIVORS AMONG THE NESTED BOXES, each with the thing that keeps it out of `inset`.
  it('.markdown pre keeps its own box, because there is no element to put a Panel on', () => {
    // The `<pre>` is emitted by the markdown renderer from a card's own text; no JSX names it.
    const b = drawn(inside('markdown', 'pre'));
    expect(b.ground).toBe('var(--panel-2)');
    expect(b.edge).toBe('1px solid var(--border) + no colour of its own');
    expect(box(inside('markdown', 'pre')).padding).toBe('12px');
  });

  it('.msg-assistant keeps FOUR corners and a tail, which Panel has no way to say', () => {
    expect(drawn(el('msg-assistant')).radius).toBe('10px 10px 10px 4px');
  });

  it(".control-tabs button keeps a tab's padding, and it is a tab", () => {
    expect(box(inside('control-tabs', 'button')).padding).toBe('4px 8px');
  });

  // `.copilot-actions button` WAS `Button` `default` `sm` DECLARATION FOR DECLARATION, which is the whole
  // argument for the migration: it wrote out the primitive's own six values by hand. The class is gone, so
  // what is pinned now is the six values themselves — if any of them moved, the claim of equality that
  // licensed deleting the rule would have been false.
  //
  // AND ONE OF THEM HAS MOVED, deliberately: the vertical padding is `--s-1` where the deleted rule wrote
  // `4px`. Measured in a browser, `--s-2` made a `sm` button 24px tall around 14px of ink — over a third of
  // the control empty above and below a 12px word — and the owner asked for it back. Recorded here rather
  // than quietly updated, because this test's SUBJECT is a historical equality: five of the six values are
  // still what that rule wrote, and this one is now a decision taken after it.
  it('the Compact button is default/sm, with the vertical padding the owner tightened', () => {
    const { container } = render(<Button size="sm">Compact</Button>);
    const b = box(container.firstElementChild as Element);
    expect(b.background).toBe('var(--panel-2)');
    expect(b.color).toBe('var(--text)');
    expect(b['border-color']).toBe('var(--border)');
    expect(b['border-radius']).toBe('6px');
    // `0 8px` AND A DECLARED 28px. The owner's second pass took the vertical padding from `--s-2` to
    // `--s-1`; the atom layer took it to nothing at all and gave the box a height instead, which is the
    // same argument carried to its end — a control whose height is padding plus a line box is a control
    // whose height changes when its label does. The horizontal half is untouched.
    expect(b.padding).toBe('0 8px');
    expect(b.height).toBe('28px');
    expect(b['font-size']).toBe('0.75rem');
  });
});

describe('InlineField is one control in two states, and the two share one box', () => {
  // THE PAIR'S PADDING IS THE POINT. A field that looks like text until it is clicked must not move
  // when it becomes an input, so the view and the edit declare the SAME padding on purpose — and the
  // control box `Field` owns is `var(--s-3) var(--s-4)`, which would make the text jump 4px on click.
  it('the view and the edit declare one padding', () => {
    expect(box(el('inline-view', 'button')).padding).toBe(box(el('inline-edit', 'textarea')).padding);
  });

  it('only the edit draws its edge, and it draws it accent', () => {
    expect(box(el('inline-view', 'button')).border).toBe('1px solid transparent');
    expect(box(el('inline-edit', 'textarea')).border).toBe('1px solid var(--accent)');
    expect(box(el('inline-view', 'button')).background).toBe('transparent');
  });
});

// ---------------------------------------------------------------------------------------------------
// THE TABS, AND THE MEASUREMENT THE REFUSAL IS RE-TAKEN ON.
//
// Phase 5b declined a `Tabs` primitive on three candidates of which two were real, because the two
// disagreed about both things such a primitive would own. The census lists FOUR tab boxes, so the
// measurement is different and the decision has to be taken again rather than restated. This is the
// table, asserted so that it cannot rot: if a tab's face or selected state changes, the refusal has to
// be re-read rather than inherited.
describe('the four tabs disagree about every decision a Tabs primitive would own', () => {
  const TABS = {
    'dock-tab': el('dock-tab', 'button'),
    'tab-btn': el('tab-btn', 'button'),
    'control-tabs button': inside('control-tabs', 'button'),
    'cards-tab': el('cards-tab'),
  };
  const selected = {
    'dock-tab': box(el('dock-tab active', 'button')),
    'tab-btn': box(el('tab-btn active', 'button')),
    'control-tabs button': box(
      at('<div class="control-tabs"><button class="active">x</button></div>', 'button'),
    ),
    'cards-tab': box(el('cards-tab active')),
  };

  it('the RESTING box is three answers across four tabs', () => {
    const resting = Object.entries(TABS).map(([, target]) => {
      const b = box(target);
      return `${b.background} / ${b.border}`;
    });
    expect(resting).toEqual([
      'transparent / 1px solid transparent',
      'transparent / 1px solid transparent',
      'var(--panel-2) / 1px solid var(--border)',
      'var(--bg) / 1px solid var(--border)',
    ]);
    expect(new Set(resting).size).toBe(3);
  });

  // THE TRACKING STOPPED BEING PART OF THE DISAGREEMENT, and that narrows this claim by exactly one
  // property: `.dock-tab` was 0.08em against `.tab-btn`'s 0.04em, and both are `var(--track)` now. What
  // the four still disagree about is the FAMILY and the CASE — one uppercase display, one sentence-case
  // display, two declining a face in two different places — which is the part the Tabs refusal rests on.
  it('the FACE is four answers across four tabs', () => {
    const face = Object.entries(TABS).map(([, target]) => {
      const b = box(target);
      return `${b['font-family'] ?? '—'} / ${b['text-transform'] ?? '—'} / ${b['letter-spacing'] ?? '—'}`;
    });
    expect(face).toEqual([
      'var(--font-display) / uppercase / 0.08em',
      'var(--font-display) / — / 0.08em',
      '— / — / —',
      '— / — / —',
    ]);
    // Two of the four declare no face at all, and they do not decline it in the same place:
    // `.control-tabs button` inherits the app's, while `.cards-tab`'s face is on the LABEL inside it.
    expect(box(el('cards-tab-label', 'button'))['font-size']).toBe('0.75rem');
  });

  // THE SECOND PREMISE THIS SUITE GOT WRONG, and it makes the disagreement WIDER rather than narrower:
  // `.cards-tab.active` changes no ink at all. The selected ink is `.cards-tab.active .cards-tab-label`,
  // one level down on the control inside the box — so a `Tabs` primitive owning "selected" would have to
  // decide which ELEMENT the state colours, and the four candidates answer that in two ways as well.
  it('the SELECTED state is four answers across four tabs', () => {
    const state = Object.entries(selected).map(
      ([, b]) => `${b.color ?? 'no ink of its own'} / ${b['border-color']} / ${b['box-shadow'] ?? 'no glow'}`,
    );
    expect(state).toEqual([
      'var(--text) / var(--border) / no glow',
      'var(--accent) / var(--border) / var(--glow)',
      'var(--text) / var(--accent) / no glow',
      'no ink of its own / var(--accent) / var(--glow)',
    ]);
    expect(new Set(state).size).toBe(4);
    // …and the fourth's ink is on its child, which is the second answer to "what does selected colour?"
    expect(
      box(at('<div class="cards-tab active"><button class="cards-tab-label">x</button></div>', 'button'))
        .color,
    ).toBe('var(--text)');
  });

  // `.cards-tab` IS NOT A TAB BUTTON AT ALL, which is the mirror of Phase 5b's reading of
  // `.cards-tab-label`: that was the label inside a tab, and this is the box around one. It contains
  // two controls — the label and a close `✕` — so it declares no padding and takes no click itself.
  it('.cards-tab declares no padding, because the controls inside it do', () => {
    expect(box(el('cards-tab')).padding).toBeUndefined();
    expect(box(el('cards-tab-label', 'button')).padding).toBe('2px 2px 2px 8px');
  });
});
