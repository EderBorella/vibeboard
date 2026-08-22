// @vitest-environment jsdom
//
// THE BOXES CHIP IS ABOUT TO TAKE OVER, pinned before it takes them.
//
// Written as a CHARACTERISATION suite for Phase 8 of docs/design-system.md and run green against the
// code as it was, BEFORE any migration — the practice that has found a real defect in every phase that
// did it. It asserts the BOX A CLASS LIST DRAWS, resolved out of the stylesheets by test/css-box.tsx,
// rather than the class that draws it: after the migration `.tag`'s corner and padding are declared by
// `.vb-chip-pill` and `.vb-chip` in primitives.css instead of by `.tag` in styles.css, and every
// assertion here reads the same value either way.
//
// THE THREE TILE STATE WORDS ARE THE POINT OF THIS FILE, and they are the reason it exists at all.
// `.tile-setup`, `.tile-suggestions` and `.tile-problem` are one shape in three tones, and the tones are
// the MEANING: setup is the card the board is waiting on, a suggestion is work deliberately left behind,
// a problem is a real failure inside something that says it is finished. Three tones a refactor could
// collapse into one is exactly the defect this phase must not ship, so the distinction is measured in
// each theme's own palette rather than inferred from the token names — `--warn` and `--danger` are equal
// in two of the three themes and different in marshmallow, which themes.css argues by name, so "they
// name different tokens" is not the same claim as "they render differently".
//
// jsdom LOADS NO CSS and computes no cascade, so the sheets are read out of the source and
// `el.matches()` does the selector work — the construction test/panel-boxes.test.tsx,
// test/field-boxes.test.tsx and test/state-tones.test.tsx all use.
//
// WHAT IS DELIBERATELY NOT PINNED: the paddings. The ten chip classes carry seven values between them —
// `0 var(--s-2)`, `0 var(--s-3)`, `0.02rem var(--s-3)`, `0.05rem var(--s-2)`, `0.05rem var(--s-3)`,
// `0.1rem var(--s-4)` and `0.22rem var(--s-4)` — which is the same ladder nobody chose that the 27 font
// sizes were, and the thing this phase exists to collapse. Pinning it would make the suite a description
// of the old code. What IS pinned is that a chip HAS one, which is what says the box did not vanish.
import { cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CardTile } from '../web/src/board/CardTile.js';
import type { Card } from '../web/src/shared.js';
import { Chip } from '../web/src/ui/Chip.js';
import { box } from './css-box.js';
import { inkIn, inkToken, isColour, THEMES } from './state-ink.js';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

// THE ELEMENT IN A DOCUMENT, because half of these claims are descendant rules — `.markdown code` and
// the count inside a tag chip are only reachable through an ancestor, and `el.matches()` on a detached
// node answers about the node alone.
function mount(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  const el = host.querySelector('[data-probe]') ?? host.firstElementChild;
  if (!el) throw new Error(`nothing rendered for ${html}`);
  return el;
}

// ---------------------------------------------------------------------------------------------------
// THE PALETTE AND THE RESOLVER MOVED TO test/state-ink.tsx, where test/state-inks.test.tsx uses the
// same copy. Both had to grow one indirection in Phase 13: a toned chip's declaration is now
// `color: var(--tone)` on every surface and the token is a level below it, so a test comparing
// declaration strings is blind to the difference it exists to measure. `inkToken` reads that level.

// ---------------------------------------------------------------------------------------------------
// THE FIXTURES ASK `Chip` FOR ITS OWN MARKUP, and the same thing happened here that Phase 4 recorded of
// test/panel-boxes.test.tsx: THE ASSERTIONS SURVIVED THE MIGRATION AND THE FIXTURES DID NOT. Run first
// against the code as it was, every fixture below was a hand-written class list on the element the
// surface rendered — `<button class="board-archive">`, `<span class="tag">` — and all 25 assertions were
// green. Once the box moved to the primitive those class lists drew nothing, so 21 of them went red for
// the right reason: the element genuinely carries five more classes than it did.
//
// What rendering `Chip` buys is that the class list is never hand-written again — rename `vb-chip-pill`
// and every fixture moves with it instead of quietly testing a dead class — and that the PROPS here are
// the props the call site passes, so a chip that lost its `pill` in a refactor fails at the assertion
// rather than at the fixture.
const MICRO = '0.6875rem';
const SMALL = '0.75rem';
const PILL = '999px';
const SM = '4px';

function chip(props: ComponentProps<typeof Chip>): Element {
  const { container } = render(<Chip {...props} />);
  const el = container.firstElementChild;
  if (!el) throw new Error('Chip rendered nothing');
  return el;
}

const chips: {
  name: string;
  props: ComponentProps<typeof Chip>;
  radius: string;
  font: string;
  ink?: RegExp;
  ground?: string;
}[] = [
  {
    name: '.board-archive — the archive toggle on a board head',
    props: { as: 'button', pill: true, fill: true, className: 'board-archive vb-readout' },
    radius: PILL,
    font: MICRO,
    ink: /--muted/,
    ground: 'var(--panel-2)',
  },
  {
    name: '.tag — a tag on a card tile',
    props: { pill: true, tone: 'neutral', className: 'tag' },
    radius: PILL,
    font: MICRO,
    ink: /--muted/,
    ground: 'var(--panel)',
  },
  {
    name: '.tag-chip — a tag in the filter bar',
    props: { as: 'button', pill: true, fill: true, className: 'tag-chip vb-readout' },
    radius: PILL,
    font: MICRO,
    ink: /--muted/,
    ground: 'var(--panel-2)',
  },
  {
    name: '.mp-chip — a filter in the model picker',
    props: { as: 'button', pill: true, fill: true, tone: 'neutral', className: 'mp-chip' },
    radius: PILL,
    // THE ONE ASSERTION THE MIGRATION MOVED, from `--t-small` to `--t-micro`. Ten chip classes carried
    // two sizes between them and nine of the ten were already micro, which is the scale's own name for
    // "chips, state words, dot labels, tags". Recorded in docs/design-system.md rather than smoothed
    // away: it is a visible change and the only rendering change of its kind in this phase.
    font: MICRO,
    ink: /--muted/,
    ground: 'var(--panel-2)',
  },
  {
    name: '.mp-def-tag — the backend default marker',
    props: { pill: true, tone: 'accent', className: 'mp-def-tag' },
    radius: PILL,
    font: MICRO,
    ink: /--accent\b/,
  },
  {
    name: '.control-tag — a managed file marker',
    props: { className: 'control-tag' },
    radius: SM,
    font: MICRO,
    ink: /--accent-2/,
  },
  {
    name: '.tab-badge — the count of runs waiting on you',
    props: { pill: true, className: 'tab-badge vb-readout' },
    radius: PILL,
    font: MICRO,
    // `--on-accent` retired: it aliased `--on-fill` in two of the three palettes and decided nothing.
    // The ink a count punched out of an `--accent-2` ground needs is the surface it is punched out of.
    ink: /--panel-2/,
    ground: 'var(--accent-2)',
  },
  {
    name: '.tile-setup — the project-level barrier',
    props: { tone: 'accent', className: 'tile-setup' },
    radius: SM,
    font: MICRO,
    ink: /--accent\b/,
  },
  {
    name: '.signin-this — which browser you are on',
    props: { pill: true, tone: 'neutral', className: 'signin-this' },
    radius: PILL,
    font: MICRO,
    ink: /--muted/,
  },
];

describe('the chip family draws one box', () => {
  for (const { name, props, radius, font, ink, ground } of chips) {
    it(`${name} is a chip's box`, () => {
      const el = chip(props);
      const drawn = box(el);
      expect(drawn['border-radius']).toBe(radius);
      expect(drawn['font-size']).toBe(font);
      // A padding, not a value: the ten classes carried seven of them and collapsing them is the job.
      expect(drawn.padding ?? drawn['padding-left']).toBeDefined();
      // `inkToken` AND NOT `drawn.color`, which is now `var(--tone)` on every toned chip: the token the
      // surface reaches is one level below the declaration. See test/state-ink.tsx.
      if (ink) expect(inkToken(el)).toMatch(ink);
      if (ground) expect(drawn.background ?? drawn['background-color']).toBe(ground);
    });
  }

  // THE ONE MEMBER OF THE CENSUS THAT MAY LEGITIMATELY NEVER BE A CHIP, pinned so the phase that
  // exempts it by name cannot also move it by accident. It is an inline code span in rendered prose: it
  // means "this is code", it sits mid-sentence, and it is not a discrete labelled thing. Hand-written
  // here BECAUSE it is not a `Chip` — this is the one fixture that must not go through the primitive.
  it('.markdown code keeps its own box, because it is prose and not a chip', () => {
    const drawn = box(mount('<div class="markdown"><p>a <code data-probe>x</code> b</p></div>'));
    expect(drawn['font-family']).toBe('var(--font-mono)');
    expect(drawn['font-size']).toBe(SMALL);
    expect(drawn['border-radius']).toBe(SM);
    expect(drawn.padding).toBe('2px 4px');
    expect(drawn.background).toBe('var(--panel-2)');
  });

  // THE MONOSPACED CHIPS. A mono face is the Readout's claim that the machine measured the figure, so a
  // chip carrying it is borrowing the treatment — and after the migration it borrows it by NAMING
  // `vb-readout` on the `<Chip>` rather than by restating `font-family` in its own rule, which is what
  // took three rules off the mono census. The assertion is unchanged either way.
  it.each([
    ['.board-archive', { as: 'button', pill: true, fill: true, className: 'board-archive vb-readout' }],
    ['.tag-chip', { as: 'button', pill: true, fill: true, className: 'tag-chip vb-readout' }],
    ['.tab-badge', { pill: true, className: 'tab-badge vb-readout' }],
    // A FOURTH, added by Phase 12: a run's status is machine vocabulary, and `.report-chip` restated
    // `font-family` in its own rule until it named the primitive instead. Its uppercase tracking is
    // still the surface's, which is why the class survives the migration.
    ['.report-chip', { pill: true, state: 'failed', className: 'report-chip vb-readout' }],
  ] as [string, ComponentProps<typeof Chip>][])('%s is set in the monospaced face', (_name, props) => {
    expect(box(chip(props))['font-family']).toBe('var(--font-mono)');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('a chip that takes a click is still a chip', () => {
  // THE BUTTON RESET IS LOAD-BEARING AND IT IS EASY TO LOSE. A `<button>` takes the UA's own font family
  // and line-height, so a tag rendered as a button renders in the control face beside an identical
  // neighbour rendered as a span unless something says `inherit`. `.tag-btn` was that something for one
  // of the four clickable chips; `button.vb-chip` is it for all four.
  it('a clickable chip inherits the surrounding face rather than the UA control face', () => {
    const drawn = box(chip({ as: 'button', pill: true, tone: 'neutral', className: 'tag tag-btn' }));
    expect(drawn['font-family']).toBe('inherit');
    expect(drawn['line-height']).toBe('inherit');
    expect(drawn.cursor).toBe('pointer');
  });

  it('a clickable tag is the same box as a plain one', () => {
    const clickable = box(chip({ as: 'button', pill: true, tone: 'neutral', className: 'tag tag-btn' }));
    const plain = box(chip({ pill: true, tone: 'neutral', className: 'tag' }));
    expect(clickable['border-radius']).toBe(plain['border-radius']);
    expect(clickable['font-size']).toBe(plain['font-size']);
    expect(clickable.padding).toBe(plain.padding);
    expect(clickable.background).toBe(plain.background);
  });

  // A FILLED CHIP THAT IS A `<button>` KEEPS ITS GROUND, and this is the cascade trap the base rule was
  // written to avoid: `button.vb-chip { background: none }` is (0,1,1) and would have outranked
  // `.vb-chip-fill` at (0,1,0), silently un-filling three of the four clickable chips.
  it('a filled chip keeps its ground when it is a button', () => {
    expect(box(chip({ as: 'button', pill: true, fill: true })).background).toBe('var(--panel-2)');
  });

  it('an active filter chip is filled rather than outlined', () => {
    const drawn = box(chip({ as: 'button', pill: true, fill: true, className: 'tag-chip active' }));
    expect(drawn.background).toBe('var(--accent-fill)');
    expect(drawn.color).toBe('var(--on-fill)');
  });

  it('the count inside a filter chip is quieter than the tag it counts', () => {
    render(
      <Chip as="button" pill fill className="tag-chip vb-readout">
        bug<span data-probe>3</span>
      </Chip>,
    );
    const count = document.querySelector('[data-probe]');
    if (!count) throw new Error('no count rendered');
    expect(Number(box(count).opacity)).toBeLessThan(1);
  });

  it('a selected model-picker filter is filled rather than outlined', () => {
    const drawn = box(
      chip({ as: 'button', pill: true, fill: true, tone: 'neutral', className: 'mp-chip on' }),
    );
    expect(drawn.background).toBe('var(--accent-fill)');
    expect(drawn.color).toBe('var(--on-fill)');
  });
});

// ---------------------------------------------------------------------------------------------------
// THE THREE TONES, AND THIS IS THE PHASE'S OWN GATE. A shape census counts a drawn box, so it could
// never see two of these three: `.tile-suggestions` and `.tile-problem` declared a size, an ink and a
// `white-space` and nothing else. What holds them apart is this suite and the named list in
// tools/check-shape-coverage.mjs, and nothing else in the repository.
//
// RENDERED THROUGH `CardTile` AND NOT THROUGH A CLASS LIST, deliberately: the tone is a PROP now, so a
// refactor that dropped `tone="warn"` would leave `.tile-suggestions` in place and every class-list
// fixture green while the board rendered two identical grey words. The board's own component is the only
// fixture that can fail on that.
const card = (over: Partial<Card> = {}): Card =>
  ({
    id: 'E-001',
    title: 'A card',
    board: 'engineering',
    columnSlug: 'done',
    order: 10,
    tags: [],
    links: [],
    created: '2026-07-25',
    body: '',
    filePath: '/tmp/E-001.md',
    ...over,
  }) as Card;

// One tile carrying all three states at once, which is also the case a person most needs to tell apart.
function tileStates(): { name: string; token: string; el: Element }[] {
  render(
    <CardTile
      card={card({ setup: true })}
      miniatureChars={40}
      openSuggestions={2}
      carryingAProblem={['E-002']}
    />,
  );
  return [
    { name: '.tile-setup', token: '--accent', testId: 'tile-setup' },
    { name: '.tile-suggestions', token: '--warn', testId: 'tile-suggestions' },
    { name: '.tile-problem', token: '--danger', testId: 'tile-problem' },
  ].map(({ name, token, testId }) => {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (!el) throw new Error(`CardTile rendered no ${testId}`);
    return { name, token, el };
  });
}

describe('the three tile state words stay three', () => {
  it('takes each ink from its own token', () => {
    // Asserted as a group rather than one `it` per tone: the claim is about the three together, and
    // three separate passes cannot say that a tile carrying all three shows all three.
    expect(tileStates().map(({ name, token, el }) => `${name} ${inkToken(el).includes(token)}`)).toEqual([
      '.tile-setup true',
      '.tile-suggestions true',
      '.tile-problem true',
    ]);
  });

  // MEASURED PER THEME, NOT INFERRED FROM THE TOKEN NAMES. `--warn` and `--danger` are the SAME value in
  // cyberpunk and classic-dark and DIFFERENT in marshmallow, which themes.css argues by name — so "they
  // name different tokens" is not the claim. The claim is that a person looking at a tile can tell the
  // three apart, and that is a claim about resolved colour in a particular palette.
  it.each(THEMES)('renders the three as three distinct colours in %s', (theme) => {
    const inks = tileStates().map(({ el }) => inkIn(el, theme));
    // ANTI-VACUITY FIRST: an unresolved `var(--x)` compares unequal to another unresolved one, so a
    // resolver that silently stopped working would report three "distinct" colours and pass. It has one
    // more level to get through since Phase 13 — `color: var(--tone)` then `--tone: var(--warn)` — so
    // this guard is doing more work than it was.
    expect(inks.every(isColour)).toBe(true);
    expect(new Set(inks).size).toBe(3);
  });

  // THE BORDER IS PART OF THE TONE and it is a second axis a collapse could flatten on its own: the
  // three inks could stay distinct while the three edges became one.
  // The three edges are now ONE DECLARATION — `color-mix(in srgb, var(--tone) 50%, var(--border))` on
  // `.vb-chip.vb-chip-tone`, where they were three rules each naming a token. Resolving `--tone` per
  // element is what keeps this claim about three colours rather than about three strings, and it is
  // exactly the collapse the assertion is here to refuse.
  it.each(THEMES)('renders the three edges as three in %s', (theme) => {
    const edges = tileStates().map(({ el }) => inkIn(el, theme, 'border-color'));
    expect(edges.every((edge) => edge.includes('#'))).toBe(true);
    expect(new Set(edges).size).toBe(3);
  });

  // The three are ONE SHAPE, which is what makes them a tone axis rather than three surfaces. Same
  // size, same corner, same nowrap: only the ink and the edge differ.
  it('renders the three at one size, one corner and never wrapped', () => {
    for (const { el } of tileStates()) {
      const drawn = box(el);
      expect(drawn['font-size']).toBe(MICRO);
      expect(drawn['border-radius']).toBe(SM);
      expect(drawn['white-space']).toBe('nowrap');
    }
  });
});
