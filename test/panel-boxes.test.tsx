// @vitest-environment jsdom
//
// THE BOXES PANEL IS ABOUT TO TAKE OVER, pinned before it takes them.
//
// Written as a CHARACTERISATION suite for Phase 4 of docs/design-system.md and run green against the
// code as it was, BEFORE any migration — which is the whole value of the practice: a test written
// afterwards describes the rewrite, and a test written first catches the bug you were about to move.
// Phase 3 found two real defects this way.
//
// It asserts the BOX A CLASS LIST DRAWS, resolved out of the stylesheets, rather than the class name
// that draws it: after Phase 4 `.column`'s ground, border and corner are declared by
// `.vb-panel-raised` in primitives.css instead of by `.column` in styles.css, and every assertion
// below reads the same value either way.
//
// THE ASSERTIONS SURVIVED THE MIGRATION; THE FIXTURES DID NOT, and pretending otherwise would be the
// dishonest version of this note. A row is now built by rendering `Panel` rather than by writing
// `<button class="report-open">`, because the element genuinely carries two more classes than it did.
// What that buys is that the class list is never hand-written: rename `vb-panel-flat` and the fixture
// moves with it instead of quietly testing a dead class.
//
// jsdom LOADS NO CSS and computes no cascade — `getComputedStyle` answers '' whatever the rule says —
// so the sheets are read out of the source and `el.matches()` does the selector work, the same
// construction test/state-tones.test.tsx uses and for the same reason.
//
// WHAT IS DELIBERATELY NOT PINNED: the paddings of the eight list rows. Phase 4 normalises them onto
// one value (they were `0.1rem var(--s-2)`, `0.15rem var(--s-3)`, `var(--s-3) var(--s-4)` and
// `var(--s-4) var(--s-4)` — four paddings nobody chose, which is the same pathology as the 27 font
// sizes one level up), and pinning a value the phase exists to change would make this suite a
// description of the old code rather than a guard on what must survive it. What IS pinned for those
// rows is the part that must survive: no ground at rest, a marker that appears on hover or selection,
// and left-aligned inherited type.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BoardsView } from '../web/src/board/BoardsView.js';
import type { BoardName, Card, ProjectConfig, ProjectSnapshot } from '../web/src/shared.js';
import { Panel } from '../web/src/ui/Panel.js';

afterEach(cleanup);

const WEB = join(process.cwd(), 'web', 'src');
// PRIMITIVES FIRST, exactly as main.tsx imports them: a surface may override a primitive's colour at
// equal specificity, so source order is what decides. Reading them the other way round would report
// the primitive's value where the surface's is what renders.
const SHEETS = ['ui/primitives.css', 'styles.css'].map((f) => readFileSync(join(WEB, f), 'utf8'));

// The scale tokens, resolved to the pixel values themes.css gives them, so a rule that moves from
// `var(--radius)` to `var(--r-lg)` reads as the same 10px it renders as. Colour tokens are left as
// names: `--panel` is a different colour in each theme and the token IS the claim.
const TOKENS = new Map(
  [...readFileSync(join(WEB, 'themes.css'), 'utf8').matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)]
    .filter(([, name]) => /^--(t|s|r)-|^--radius$/.test(name))
    .map(([, name, value]) => [name, value.trim()]),
);

interface Rule {
  selector: string;
  body: string;
}

// Brace-matched rather than regex-split, because @media/@container/@supports nest and a flat regex
// reads their prelude as a selector — the same reason tools/check-radius-scale.mjs matches braces.
function rules(text: string): Rule[] {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const stack: { selector: string; start: number }[] = [];
  let from = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const c = clean[i];
    if (c === '{') stack.push({ selector: clean.slice(from, i).trim(), start: i + 1 });
    else if (c === '}') {
      const open = stack.pop();
      if (open) out.push({ selector: open.selector, body: clean.slice(open.start, i) });
      from = i + 1;
    } else if (c === ';') from = Math.max(from, i + 1);
  }
  // At-rule preludes are not selectors; their inner rules are already in `out` from the brace scan.
  return out.filter((r) => r.selector !== '' && !r.selector.startsWith('@'));
}

const ALL = SHEETS.flatMap(rules);

function resolve(value: string): string {
  return value.replace(/var\((--[\w-]+)\)/g, (whole, name: string) => TOKENS.get(name) ?? whole);
}

// Every declaration that reaches `el` through a selector that matches it, in source order, flattened
// so the LAST value for a property wins. An approximation of the cascade — it ignores specificity —
// and it is honest about that: everything asserted below is either a single-class rule or a state
// rule written after the base, which is the order this stylesheet is maintained in anyway.
function box(el: Element, state = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of ALL) {
    const matches = rule.selector.split(',').some((sel) => applies(el, sel.trim(), state));
    if (!matches) continue;
    for (const decl of rule.body.split(';')) {
      const at = decl.indexOf(':');
      if (at < 0) continue;
      out[decl.slice(0, at).trim()] = resolve(decl.slice(at + 1).trim());
    }
  }
  return out;
}

// `:hover` and `:disabled` cannot be asked of an element that is not under a pointer, so the state
// is named instead: `box(el, ':hover')` takes the base rules PLUS the `:hover` ones and nothing else.
//
// A RULE'S STATES MUST BE A SUBSET OF THE ONE ASKED FOR, and that is the part that has to be exact.
// The first version stripped the pseudo-class out and matched what was left, so every `:hover` rule
// applied at rest: `.control-item`'s hover ground read as its RESTING ground and "a list row has no
// ground" went red, while the same bug made the identical claim pass on `.report-open` for the wrong
// reason. Both answers were wrong and only one of them was red — see the helper's own case below.
const STATES = /:(hover|disabled|focus-visible|focus|first-child|last-child)/g;

function applies(el: Element, selector: string, state: string): boolean {
  // `:not(...)` goes first, or the `:disabled` inside `:hover:not(:disabled)` counts as a second
  // state and the rule would apply to nothing at all.
  const outer = selector.replace(/:not\([^)]*\)/g, '');
  if ([...outer.matchAll(STATES)].some((m) => m[0] !== state)) return false;
  return safeMatches(el, outer.replace(STATES, '').trim());
}

function safeMatches(el: Element, selector: string): boolean {
  if (selector === '') return false;
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

// THE ELEMENT AS THE COMPONENT RENDERS IT, and the class list is not hand-written anywhere. Before
// Phase 4 these were plain `<button class="report-open">`; after it they are `Panel`s, so the fixture
// asks `Panel` for its own markup. That is what stops the fixture drifting from the primitive: rename
// `vb-panel-flat` and every assertion below moves with it rather than quietly testing a dead class.
//
// The surfaces themselves are not mounted here — several need a page of mocked api — and each is
// covered by its own suite. What is under test is the BOX, which is a property of the class list.
function row(className: string): Element {
  const { container } = render(<Panel as="button" variant="flat" className={className} />);
  const el = container.firstElementChild;
  if (!el) throw new Error(`Panel rendered nothing for ${className}`);
  return el;
}

function raised(className: string): Element {
  const { container } = render(<Panel variant="raised" className={className} />);
  const el = container.firstElementChild;
  if (!el) throw new Error(`Panel rendered nothing for ${className}`);
  return el;
}

const config: ProjectConfig = {
  name: 'T',
  boards: {
    features: { columns: ['Backlog', 'Todo', 'Done'] },
    product: { columns: ['Backlog', 'Todo', 'Blocked', 'Done'] },
    engineering: { columns: ['Todo', 'Done'] },
  },
  miniatureChars: 40,
  idPadding: 3,
  keepChats: 20,
  contextBudget: 200_000,
  maxConcurrentRuns: 3,
  copilot: { backend: 'claude-code', backends: {} },
};

const snapshot = {
  root: '/tmp/p',
  name: 'Demo',
  config,
  boards: { features: [], product: [], engineering: [] },
  archivedCounts: { features: 0, product: 0, engineering: 0 },
} as ProjectSnapshot;

function boards(): HTMLElement {
  const { container } = render(
    <BoardsView
      snapshot={snapshot}
      tags={[]}
      activeTags={[]}
      collapsed={new Set<BoardName>()}
      onToggleBoard={() => {}}
      onTag={() => {}}
      onClearTags={() => {}}
      onAdd={() => {}}
      onOpen={() => {}}
      onArchive={(_c: Card) => {}}
      onDragStart={(_c: Card) => {}}
      onDrop={() => {}}
    />,
  );
  return container;
}

// THE HELPER'S OWN CASE. Every assertion below is only as good as `applies`, and its first version
// was wrong in a way that produced one red test and one green one from the same fault. So the two
// directions are asserted directly, on a rule that declares the same property at rest and on hover.
describe('the cascade helper separates a state from the resting style', () => {
  it('keeps a :hover rule out of the resting box, and in the hover one', () => {
    const el = row('control-item');
    expect(box(el).background).toBe('transparent');
    expect(box(el, ':hover').background).toBe('var(--panel-2)');
  });

  it('does not let :not(:disabled) count as a second state', () => {
    // `.exec-card:hover:not(:disabled)` is the shape that broke the first version.
    const card = row('exec-card');
    expect(box(card, ':hover')['border-color']).toBe('var(--accent)');
    expect(box(card)['border-color']).toBeUndefined();
  });
});

describe('the shared column grid', () => {
  // THE ONE INVARIANT THE SHARED GRID RESTS ON, and the only part of it jsdom can see. The three
  // boards are stacked and read as one table, so every row lays out on the same tracks — and the
  // track count comes from the CONFIG's widest board while the columns come from `columnSlugs`. If a
  // board could ever render more columns than `--max-cols` claims, the extras would land in implicit
  // `auto` tracks and that row alone would have a different geometry, which is the fault this phase
  // exists to close. Measured in the browser by visual/checks/board.spec.ts check 9; this pins the
  // structure the measurement depends on.
  it('never renders more columns in a row than --max-cols declares', () => {
    const container = boards();
    const main = container.querySelector('main.boards');
    const declared = Number((main as HTMLElement).style.getPropertyValue('--max-cols'));
    expect(declared).toBe(4);
    const rows = [...container.querySelectorAll('.board-columns')];
    expect(rows).toHaveLength(3);
    // Not merely "≤": one row must actually REACH the count, or a bug that dropped every column
    // would pass. Features has 3, product 4, engineering 2.
    expect(rows.map((r) => r.children.length)).toEqual([3, 4, 2]);
    for (const row of rows) expect(row.children.length).toBeLessThanOrEqual(declared);
  });

  // THE TWO CLASS SELECTORS LEFT IN THIS FILE ARE THE SUBJECT, not an oversight. `.board-columns` is
  // the grid row whose tracks are the claim, and `.column-head, .vb-panel-head` asserts that the
  // header slot's class MOVED to the primitive — a `data-testid` would answer neither question. The
  // rest of the file goes through test ids, which is why the standing count moved 126 → 127 rather
  // than 126 → 129.
  it('gives every column a head and a body, in that order', () => {
    const column = boards().querySelector('[data-testid="column"]');
    expect(column).not.toBeNull();
    const kids = [...(column as Element).children];
    // The head is the panel's header slot after Phase 4; before it, `.column-head`. Either way it
    // comes first and the scrolling body second, which is what makes the column head stay put.
    expect(kids).toHaveLength(2);
    expect(kids[1].className).toContain('column-body');
  });
});

// THE RAISED SURFACES — a box that sits above its ground and says where it ends. All four are
// `--radius`'s consumers, which Phase 1 ruled would be deleted in the phase where a surface
// primitive owns them: that is this one, so all four now spell the same 10px as `--r-lg`.
describe('a raised surface draws a panel ground, a border and a 10px corner', () => {
  const cases: [string, string, string][] = [
    ['a board column', 'column', '1px solid var(--border)'],
    // The dash is the drawer's own treatment. A border STYLE cannot shift the row, which is why it is
    // allowed through `className` where a width or a padding is not.
    ['the archive drawer', 'archive-drawer', 'dashed'],
    ['an execution column', 'exec-column', '1px solid var(--border)'],
    ['the halt overlay card', 'halt', '1px solid var(--border)'],
  ];
  for (const [what, cls, border] of cases) {
    it(what, () => {
      const drawn = box(raised(cls));
      expect(drawn.background).toBe('var(--panel)');
      expect(drawn['border-style'] ?? drawn.border).toBe(border);
      expect(drawn['border-radius']).toBe('10px');
      // A raised surface stacks a head over a body, and every one of the four did so by hand.
      expect(drawn.display).toBe('flex');
      expect(drawn['flex-direction']).toBe('column');
    });
  }

  it('the halt card keeps its danger border, which is a colour and not a box', () => {
    expect(box(raised('halt'))['border-color']).toBe('var(--danger)');
  });

  it("the column head is a bordered row above the column's body", () => {
    // Off the real component, not off a class list: the header SLOT is the part of Panel a caller
    // cannot see, so this is where it has to be read from the render.
    const head = boards().querySelector('.column-head, .vb-panel-head');
    expect(head).not.toBeNull();
    const drawn = box(head as Element);
    expect(drawn['border-bottom']).toBe('1px solid var(--border)');
    expect(drawn.display).toBe('flex');
    expect(drawn['align-items']).toBe('center');
    expect(drawn.padding).toBe('8px 0.65rem');
  });
});

// THE LIST ROWS — full-bleed, left-aligned, inherited type, and NO GROUND AT REST. That last one is
// the whole reason they were not made `Button`s in Phase 3: "`default`'s panel-2 fill would draw a
// box round every row of every list". It is the claim that must survive Phase 4, and the one a wrong
// variant would break invisibly — a list looks fine until you notice every row is boxed.
describe('a list row draws no box until the surface lights it', () => {
  const rows: [string, string][] = [
    ['a report row', 'report-open'],
    ['an execution card', 'exec-card'],
    ['a control file row', 'control-item'],
    ['an explorer row', 'control-item explorer-item'],
    ['a card link', 'cv-link cv-link-btn'],
    ['a model pick', 'mp-pick'],
    ['a chat pick', 'chat-menu-open'],
    ['a suggestion pick', 'suggestions-pick'],
  ];
  for (const [what, cls] of rows) {
    it(`${what} has no ground and no ink of its own`, () => {
      const drawn = box(row(cls));
      // `transparent`, `none` and the shorthand `background: none` are one claim: nothing is drawn.
      expect(['transparent', 'none', undefined]).toContain(drawn.background);
      expect(drawn['text-align']).toBe('left');
      expect(drawn.cursor).toBe('pointer');
      // THE BORDER IS THERE AND INVISIBLE, which is the point of the variant: a row that grew a
      // border only on hover would move 2px under the pointer. Three of these eight had
      // `border: none` and now do not.
      expect(drawn.border).toBe('1px solid transparent');
      expect(drawn['border-radius']).toBe('6px');
      // Inherited, not restated. Four of the eight carried a `font-size: var(--t-body)` that only
      // ever repeated what they inherited, and on `.cv-link` it was DEAD — `.cv-link-btn`'s
      // `font: inherit` is written later at the same specificity and reset it.
      expect(drawn.font).toBe('inherit');
    });
  }

  // AND THE MARKER APPEARS. A row with no resting box needs something to say it is under the pointer
  // or selected, and each surface chose its own — a border colour or a ground. Asserted per row
  // rather than as "some rule exists", because a fixture that cannot tell two outcomes apart tests
  // neither: the point is that the marker CHANGES something.
  const marked: [string, string, string][] = [
    ['a report row', 'report-open', 'border-color'],
    ['an execution card', 'exec-card', 'border-color'],
    ['a control file row', 'control-item', 'background'],
    ['a card link', 'cv-link cv-link-btn', 'border-color'],
  ];
  for (const [what, cls, prop] of marked) {
    it(`${what} marks :hover with ${prop}`, () => {
      const rest = box(row(cls));
      const under = box(row(cls), ':hover');
      expect(under[prop]).toBeDefined();
      expect(under[prop]).not.toBe(rest[prop]);
    });
  }

  it('a selected control row takes the accent on all three of border, ground and ink', () => {
    const drawn = box(row('control-item active'));
    expect(drawn['border-color']).toBe('var(--accent)');
    expect(drawn.background).toBe('var(--panel-2)');
    expect(drawn.color).toBe('var(--accent)');
  });

  it('a selected chat pick keeps its accent left edge', () => {
    const { container } = render(
      <div className="chat-menu-item active">
        <Panel as="button" variant="flat" className="chat-menu-open" data-testid="chat-pick" />
      </div>,
    );
    const pick = container.querySelector('[data-testid="chat-pick"]');
    expect(box(pick as Element)['border-left']).toBe('2px solid var(--accent)');
  });

  it('a disabled execution card stops being a control without losing its box', () => {
    const drawn = box(row('exec-card'), ':disabled');
    expect(drawn.cursor).toBe('default');
    expect(drawn.opacity).toBe('0.7');
  });
});
