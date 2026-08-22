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
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from '../web/src/atoms/Button.js';
import type { SurfaceVariant } from '../web/src/atoms/Surface.js';
import { Surface } from '../web/src/atoms/Surface.js';
import { Menu } from '../web/src/molecules/Menu.js';
import { Tabs } from '../web/src/molecules/Tabs.js';
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
    ['vb-modal', 'var(--panel)'],
    ['chat-menu', 'var(--panel)'],
    ['gate-card', 'var(--panel)'],
    // The one floating surface that chose the second panel step, and nothing chose it: `.chat-menu` is
    // the same kind of object on `var(--panel)`.
    ['popover', 'var(--panel-2)'],
  ];

  // The two that are NOT `Surface`s are still written as class lists, because that is what they are.
  const MIGRATED = new Set(['modal', 'vb-modal', 'chat-menu']);

  for (const [name, ground] of RAISED) {
    it(`.${name} draws a 10px corner on ${ground}`, () => {
      const b = drawn(MIGRATED.has(name) ? panel('raised', name) : el(name));
      expect(b.ground).toBe(ground);
      // The model picker's modal is the one with a colour of its own — see below.
      expect(b.edge).toBe(
        name === 'vb-modal'
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
  it('a tone="accent" modal decides a colour and nothing else about its edge', () => {
    const b = box(panel('raised', 'vb-modal'));
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
  // SIX OF THE TEN ARE `inset` NOW; TWO are survivors with a reason, one is gone and one became a `Tabs`
  // cell. What is asserted is that the six read back as ONE box, that each survivor still says the thing
  // that kept it out, and that the one that left took the cell's box rather than keeping its own.
  const MIGRATED: [string, Element][] = [
    ['tile', panel('inset', 'tile')],
    ['an archived row', panel('inset', 'vb-row')],
    ['a run record', panel('inset', 'vb-list')],
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

  // IT WAS A SURVIVOR BECAUSE IT WAS A TAB, AND BEING A TAB IS WHY IT IS NO LONGER ONE. The reason
  // recorded for keeping `.control-tabs button` out of `inset` was that it kept a tab's padding — and the
  // molecule phase gave the editor's three views to `Tabs`, so the class is gone and the padding is the
  // strip's. The vertical half went the way `Button`'s and `Control`'s did: `0.2rem 8px` became `0 8px`
  // with a declared 28px, because a box whose height is padding plus a line box is a box whose height
  // changes when its label does. Pinned as the pair, so the class coming back would be as visible as the
  // cell's box moving.
  it(".control-tabs button became a Tabs cell, so the box is the strip's and not its own", () => {
    expect(box(inside('control-tabs', 'button')).padding).toBeUndefined();
    const cell = at('<div class="vb-tabs"><button class="vb-tab">x</button></div>', 'button');
    expect(box(cell).padding).toBe('0 8px');
    expect(box(cell).height).toBe('28px');
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
  // THE EDITOR CARRIES `.vb-ctl` NOW, and the fixture has to say so: `Field inline` renders a `<Control>`,
  // so `.inline-edit` alone reaches none of the box. A one-class fixture here would ask about a class that
  // draws almost nothing and pass on whatever it answered — the same fixture-too-thin failure the atom
  // phase found on `inField()`/`field()` in this suite's neighbours.
  const view = () => el('inline-view', 'button');
  const edit = () => el('vb-ctl inline-edit', 'textarea');

  // THE PAIR'S PADDING IS THE POINT AND THE MOLECULE PHASE BROKE IT. A field that looks like text until it
  // is clicked must not move when it becomes an input, so the view and the edit declare the SAME padding on
  // purpose. `.inline-edit` lost its own padding when the box moved to the atom and took `.vb-ctl`'s
  // `0 var(--s-4)` and its 28px floor instead — so the value slid 4px sideways and the row grew 3px on
  // click, which is the exact geometric objection `Field inline` claims to have answered. Restored on
  // `.inline-edit` as the two declarations it carried before the merge; asserted as an EQUALITY of both
  // halves, because either one alone still moves the text.
  it('the view and the edit declare one padding', () => {
    expect(box(view()).padding).toBe(box(edit()).padding);
    expect(box(view()).padding).toBe('2px 6px');
    // The height floor is the other half of "one box": `.vb-ctl`'s 28px against a read-only view with none.
    expect(box(edit())['min-height']).toBe('0');
    expect(box(view())['min-height']).toBeUndefined();
  });

  // THE EDGE IS READ AS A PAIR for `drawn()`'s reason: the atom writes the width and the style and
  // `.inline-edit` writes only the colour, so collapsing the two would let a lost `border-color` pass.
  it('only the edit draws its edge, and it draws it accent', () => {
    expect(drawn(view()).edge).toBe('1px solid transparent + no colour of its own');
    expect(drawn(edit()).edge).toBe('1px solid var(--border) + var(--accent)');
    expect(box(view()).background).toBe('transparent');
  });
});

// ---------------------------------------------------------------------------------------------------
// THE TABS. THIS SUITE PINNED A DISAGREEMENT, AND THE DISAGREEMENT IS WHAT THE MOLECULE PHASE DELETED.
//
// The four tests here asserted that four tab classes answered every decision a `Tabs` primitive would own
// differently — three resting boxes, four faces, four selected states — and the refusal to build one was
// re-taken on that table. The table was right and the POPULATION was wrong: there were never four, there
// were six, and six classes disagreeing six ways is not "a primitive that would carry one variant each",
// it is nineteen classes for one shape. `Tabs` and `Menu` are what replaced them.
//
// SO THE TESTS ARE NOT MIGRATED, THEY ARE INVERTED. Rewriting them as "the same values, on `.vb-tab`"
// would make them a description of the new code, which is the one thing this suite's own header forbids —
// so what stands here is the MIRROR CLAIM, which is the acceptance test for the reversal: each thing the
// four disagreed about now has ONE answer, and the line between `Tabs` and `Menu` is where the second
// answer is allowed to live. A test that reads `undefined / undefined` because a rule is gone asserts
// nothing; a test that says "one answer, and here is the only exception" asserts the merge.
//
// THE FIXTURES ARE THE COMPONENTS. `.vb-tab`'s rules are DESCENDANT rules — `.vb-tabs:not(.vb-tabs-grouped)
// .vb-tab`, `.vb-tabs-grouped .vb-tab` — so a hand-written class list would reach the base cell and
// nothing else, and every claim about what the group takes away would read as absent and pass. Rendering
// `Tabs` also means the class list is never hand-written: rename `vb-tab` and every assertion moves.
describe('the four tabs became one, and each decision they disagreed about has one answer', () => {
  // `value={null}` IS A REAL STATE and it is the one wanted here: the cards pane opens with no card
  // selected, and a resting box measured on a selected cell would be measuring `.active`.
  function cellIn(props: Partial<ComponentProps<typeof Tabs>> = {}): Element {
    const { container } = render(
      <Tabs
        label="View"
        items={[
          { value: 'a', label: 'one' },
          { value: 'b', label: 'two' },
        ]}
        value={null}
        onChange={() => {}}
        {...props}
      />,
    );
    const cell = container.querySelector('.vb-tab');
    if (!cell) throw new Error('Tabs rendered no cell');
    return cell;
  }

  function destination(selected: boolean): Element {
    const { container } = render(
      <Menu
        label="View"
        items={[
          { value: 'a', label: 'Boards' },
          { value: 'b', label: 'Execution' },
        ]}
        value={selected ? 'a' : null}
        onChange={() => {}}
      />,
    );
    const item = container.querySelector('.vb-menu-item');
    if (!item) throw new Error('Menu rendered no item');
    return item;
  }

  // The four shapes a cell can be in. A badge and a `✕` are DOM changes rather than class changes, which
  // is exactly the claim: no rule keys off either, so all three ungrouped cells are one box.
  const SHAPES: [string, Partial<ComponentProps<typeof Tabs>>][] = [
    ['plain', {}],
    ['badged', { items: [{ value: 'a', label: 'one', badge: 3 }] }],
    ['closable', { closable: true, onClose: () => {} }],
    ['grouped', { grouped: true }],
  ];

  // THE FULL BOX AND NOT JUST THE GROUND AND THE EDGE, because the four disagreed about the height too —
  // 22.4px, 24px, 25.8px badged and 17.75px — and a signature that omitted it would call two of them equal.
  const signature = (target: Element): string => {
    const b = box(target);
    return [b.background, b.border, b['border-radius'] ?? 'no corner', b.height, b.padding].join(' / ');
  };

  it('the RESTING box is ONE answer', () => {
    const resting = SHAPES.map(([, props]) => signature(cellIn(props)));
    // TWO AND NOT ONE, and the second is by design: inside a group the cell gives its box up, which is the
    // one shape variant the segmented control earned. Every other difference is gone.
    expect(new Set(resting).size).toBe(2);
    const [plain, badged, closable, grouped] = resting;
    expect([badged, closable]).toEqual([plain, plain]);
    expect(plain).toBe('transparent / 1px solid transparent / 6px / 28px / 0 8px');
    expect(grouped).toBe('var(--panel-2) / none / no corner / auto / 0 8px');
  });

  // THE FACE WAS THE WIDEST OF THE FOUR DISAGREEMENTS — one uppercase display, one sentence-case display,
  // two declining a face in two different places — and it is the one thing the merge deleted outright
  // rather than picked a winner for. A cell inherits the app's face and says nothing else: `--font-display`
  // on a 12px cell was a treatment two of the four had and two did not, and the tracking made the dock's
  // row wider than the words in it.
  //
  // AND THE EXCEPTION IS THE LINE BETWEEN THE TWO COMPONENTS, asserted rather than described. A DESTINATION
  // is a NAME — the app's own vocabulary for its five places — so `--font-display` and `--track` survive on
  // `.vb-menu-item` and nowhere else. Both halves in one test, because "it went from every tab" is only a
  // claim about the merge if the place it survives is named.
  it('the FACE is ONE answer, and the display face lives only on a destination', () => {
    const face = (target: Element): string => {
      const b = box(target);
      return `${b['font-family'] ?? '—'} / ${b['text-transform'] ?? '—'} / ${b['letter-spacing'] ?? '—'}`;
    };
    // `inherit` AND NOT `undefined`: the cell declares it, which is the stronger claim. A `<button>` takes
    // the UA control face, so a cell that said nothing would render in it — the defect `button.vb-chip`
    // exists to have fixed once.
    expect(SHAPES.map(([, props]) => face(cellIn(props)))).toEqual([
      'inherit / — / —',
      'inherit / — / —',
      'inherit / — / —',
      'inherit / — / —',
    ]);
    expect(face(destination(false))).toBe('var(--font-display) / — / 0.08em');
  });

  // ONE SELECTED STATE, AND IT IS THE DOCK'S — `--text` ink on `--panel-2` with a visible edge, which was
  // the only one of the four that read as "selected" without also reading as "primary". The top row's
  // `--glow` is gone with it: a halo on a destination made the header's current tab the brightest thing on
  // a board with work running on it.
  //
  // AND THE INK IS THE CELL'S OWN, which is the second thing the four could not agree on: `.cards-tab`
  // changed no ink at all and put the selected colour on its CHILD, so a primitive owning "selected" had to
  // decide which ELEMENT the state colours. It colours the cell. Asserted as an EQUALITY between the label
  // inside a selected cell and the label inside a resting one — a negative on one fixture could not tell a
  // missing rule from a rule that never matched.
  it('the SELECTED state is ONE answer, and the ink is the cell’s own', () => {
    // THE GROUND IS IN THE SIGNATURE AND IT WAS NOT AT FIRST, which is worth recording because the omission
    // made this test pass a planted defect: deleting `.vb-tab.active`'s `background` exited green. The four
    // disagreed about the ground as much as the ink — `.cards-tab` sat on `--bg`, the segmented cell
    // inverted to `--accent-fill` — so a "selected state" that does not name it is not the claim.
    const state = (target: Element): string => {
      const b = box(target);
      return [
        b.color ?? 'no ink of its own',
        b.background,
        b['border-color'],
        b['box-shadow'] ?? 'no glow',
      ].join(' / ');
    };
    expect(state(cellIn({ value: 'a' }))).toBe('var(--text) / var(--panel-2) / var(--border) / no glow');
    // A destination differs in the INK and in nothing else — accent says "you are here" where `--text` on
    // `--panel-2` says "this is the view you are reading".
    expect(state(destination(true))).toBe('var(--accent) / var(--panel-2) / var(--border) / no glow');

    const labelIn = (selected: boolean): Record<string, string> => {
      const { container } = render(
        <Tabs
          label="View"
          items={[{ value: 'a', label: 'one' }]}
          value={selected ? 'a' : null}
          onChange={() => {}}
        />,
      );
      const clip = container.querySelector('.vb-clip');
      if (!clip) throw new Error('Tabs rendered no label');
      return box(clip);
    };
    expect(labelIn(true)).toEqual(labelIn(false));
  });

  // THE GROUP OWNS THE BOX AND THE CELL GIVES ITS OWN UP, which is the one shape variant that survived the
  // cull and the reason a segmented picker was never a row of `Button`s: every button variant gives its
  // cell an edge and a corner, and that puts a seam down the middle of the group.
  //
  // The five value assertions this claim used to be made with live in test/label-notice-boxes.test.tsx,
  // migrated onto `.vb-tabs-grouped` verbatim — the group IS the segmented control now. What is asserted
  // here is the HANDOVER, which is the part neither file said: every one of the four things the cell
  // declares for itself outside a group is declared by the group instead.
  it('the group owns the box and the cell gives its own up', () => {
    const { container } = render(
      <Tabs
        grouped
        label="Mode"
        items={[
          { value: 'a', label: 'one' },
          { value: 'b', label: 'two' },
        ]}
        value={null}
        onChange={() => {}}
      />,
    );
    const group = container.querySelector('.vb-tabs-grouped');
    const cell = container.querySelector('.vb-tab');
    if (!group || !cell) throw new Error('Tabs grouped rendered nothing');
    const g = box(group);
    const c = box(cell);
    // The four the group takes: the edge, the corner, the height and the clip that makes them one box.
    expect([g.border, g['border-radius'], g.height, g.overflow]).toEqual([
      '1px solid var(--border)',
      '6px',
      '28px',
      'hidden',
    ]);
    // And the four the cell gives up. `height: auto` rather than a number is what makes the harness's
    // "a cell is exactly 2px shorter than its group" derivable from the page instead of asserted here.
    expect([c.border, c['border-radius'] ?? 'no corner', c.height, c['max-width']]).toEqual([
      'none',
      'no corner',
      'auto',
      'none',
    ]);
    // The divider between cells is all that is left of the cell's edge, and the last one drops it.
    expect(c['border-right']).toBe('1px solid var(--border)');
    expect(box(cell, ':last-child')['border-right']).toBe('none');
  });

  // THE `✕`'s PULL BELONGS TO A TAB AND NOT TO WHATEVER FOLLOWS ONE, and this is here because the first
  // spelling of it did not say that. `.vb-tab + .vb-btn-bare` matched ANY bare `Button` after a cell, and
  // `dock/UtilityDock.tsx` renders exactly one — its collapse toggle, passed as `children`, which lands
  // immediately after the last cell in a strip that is not `closable` at all. So a strip-level control took
  // a −4px pull meant for a per-tab close glyph. `[data-tab-close]` is what makes the rule say what it
  // means, and it costs nothing on the class budget.
  //
  // BOTH DIRECTIONS, because the positive alone passes under either selector: the pull is what the old one
  // got right and the ABSENCE of it on a trailing child is the whole of what it got wrong.
  it('the close glyph is pulled against its own tab, and a strip-level control is not', () => {
    const closable = render(
      <Tabs
        label="Open cards"
        closable
        onClose={() => {}}
        items={[{ value: 'E-001', label: 'one' }]}
        value="E-001"
        onChange={() => {}}
      />,
    );
    const cross = closable.container.querySelector('[data-tab-close]');
    if (!cross) throw new Error('a closable Tabs rendered no close control');
    // `calc(-1 * 4px)` and not `calc(-1 * var(--s-2))`: the resolver spends the token, so a value moved
    // off the scale would read as a different string here.
    expect(box(cross)['margin-left']).toBe('calc(-1 * 4px)');

    // The dock's shape: NOT closable, and a bare `Button` as `children`. It is the immediate next sibling
    // of the last cell, which is exactly what the old selector could not tell apart from a close glyph.
    const dock = render(
      <Tabs
        label="Utilities"
        items={[
          { value: 'cards', label: 'Cards' },
          { value: 'logs', label: 'Logs' },
        ]}
        value="cards"
        onChange={() => {}}
      >
        <Button variant="bare">x</Button>
      </Tabs>,
    );
    const cells = dock.container.querySelectorAll('.vb-tab');
    const trailing = cells[cells.length - 1]?.nextElementSibling;
    if (!trailing) throw new Error('the dock shape rendered no trailing control');
    expect(trailing.className).toContain('vb-btn-bare');
    expect(trailing.hasAttribute('data-tab-close')).toBe(false);
    expect(box(trailing)['margin-left']).toBeUndefined();
  });
});
