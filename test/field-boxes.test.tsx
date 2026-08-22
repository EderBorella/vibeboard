// @vitest-environment jsdom
//
// THE BOXES `Field` TOOK OVER, pinned before it took them.
//
// A CHARACTERISATION suite for Phase 5b of docs/design-system.md, written and run green against the code
// as it was BEFORE any migration — which is the whole value of the practice: a test written afterwards
// describes the rewrite, and a test written first catches the bug you were about to move. Phases 3 and 4
// each found a real defect this way, and so did this one:
//
//   TWO OF THE TEN TEXT BOXES DECLARED NO `:focus` RULE AT ALL — `.skill-input` and `.dispatch-prompt` —
//   so eight inputs answered a focus by turning their border accent and two kept whatever the browser
//   drew. Nothing said so and nothing could check it, which is the same shape as Phase 3's
//   `.ap-dot-idle`. The primitive fixes it at the cause, and the fix is asserted below.
//
// A second, smaller finding: the first version of this suite guessed that `.resource-row input` was one
// of the silent ones. It answers. The premise was wrong and the code was right, so the test moved — the
// third time in three phases that has been the resolution.
//
// It asserts the BOX A CLASS LIST DRAWS, resolved out of the stylesheets by test/css-box.tsx, rather than
// the class name that draws it — so `.field input`'s ground and `.vb-ctl`'s ground read the same, which
// is what let every assertion here survive the migration unchanged.
//
// THE ASSERTIONS SURVIVED; THE FIXTURES DID NOT, and saying otherwise would be the dishonest version of
// this note — the same as Phase 4's. A settings field is now built by rendering `Field`, so the class
// list is never hand-written: rename `vb-label` and the fixture moves with it instead of quietly testing
// a dead class.
//
// WHAT IS DELIBERATELY NOT PINNED: the paddings. The ten boxes carried `var(--s-4) var(--s-4)`,
// `var(--s-3) var(--s-4)`, `var(--s-2) var(--s-4)`, `var(--s-4)` and `0.8rem` between them — five
// paddings nobody chose, the same pathology as Phase 4's eight list rows one level up — and pinning a
// value this phase exists to normalise would make the suite a description of the old code.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Field } from '../web/src/ui/Field.js';
import { box } from './css-box.js';

afterEach(cleanup);

// Several boxes are styled by a DESCENDANT selector (`.vb-field input`, `.gate .vb-ctl`,
// `.copilot-input textarea`), so a bare element with a class on it would match nothing and every
// assertion would pass on an empty object. `at` throws rather than returning null for exactly that
// reason. Built with the DOM directly: `el.matches()` works on a detached tree, so there is nothing to
// mount and nothing to clean up.
function at(html: string, selector: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  const el = host.querySelector(selector);
  if (!el) throw new Error(`no ${selector} in ${html}`);
  return el;
}

// THE FIELD AS THE COMPONENT RENDERS IT. No class list is written by hand here.
function field(): Element {
  const { container } = render(
    <Field label="L">
      <input />
    </Field>,
  );
  const el = container.querySelector('input');
  if (!el) throw new Error('Field rendered no input');
  return el;
}

// Every text box in the app, named by where it lives. The list IS the census: ten of them, written ten
// times before this phase, and all ten now the one primitive.
const BOXES: [name: string, el: () => Element][] = [
  ['a settings field', field],
  ['the project gate', () => at('<div class="gate"><input class="vb-ctl"/></div>', 'input')],
  ['a skill field', () => at('<input class="vb-ctl"/>', 'input')],
  [
    'the typed confirmation',
    () => at('<div class="confirm-require"><input class="vb-ctl"/></div>', 'input'),
  ],
  ['the model search', () => at('<div class="mp-modal"><input class="vb-ctl"/></div>', 'input')],
  [
    'the dispatch prompt',
    () => at('<div class="dispatch"><textarea class="vb-ctl"></textarea></div>', 'textarea'),
  ],
  // TWO FIXTURES MOVED IN PHASE 9 AND THE ASSERTIONS DID NOT, which is what Phase 4 recorded of
  // test/panel-boxes.test.tsx and Phase 8 of test/chip-boxes.test.tsx. Both of these drew their box from
  // a descendant rule of their container — `.resource-row input`, which was `.vb-ctl` declaration for
  // declaration, and `.copilot-input textarea` — and both rules are gone: the element carries
  // `vb-ctl` now, so the class list is the claim rather than the container.
  ['a links registry row', () => at('<div class="resource-row"><input class="vb-ctl"/></div>', 'input')],
  [
    'the copilot composer',
    () => at('<div class="copilot-input"><textarea class="vb-ctl"></textarea></div>', 'textarea'),
  ],
];

describe('every text box in the app draws one box', () => {
  it.each(BOXES)('%s sits on the app ground', (_name, el) => {
    // The suggestions composer is the one that does not, and it is asserted separately below rather
    // than excluded silently.
    expect(box(el()).background).toBe('var(--bg)');
  });

  it.each(BOXES)('%s has the same 1px border', (_name, el) => {
    expect(box(el()).border).toBe('1px solid var(--border)');
  });

  it.each(BOXES)('%s has the button corner', (_name, el) => {
    // 6px resolved, so a rule moving between `var(--r-md)` and the literal reads the same.
    expect(box(el())['border-radius']).toBe('6px');
  });

  it.each(BOXES)('%s is set at the body step', (_name, el) => {
    expect(box(el())['font-size']).toBe('0.8125rem');
  });
});

describe('the boxes that differ, and why', () => {
  // WITHDRAWN IN PHASE 9, AND THE REASON IS WHY. This read "a reason box inside a `--wash` pane, where
  // `--bg` would read as a hole" — and `.suggestions-pane` declares no ground at all, so it takes the
  // dock's `--panel`, which is what `.modal` and `.gate-card` are; both of those put their boxes on
  // `--bg`. The pane the argument describes is `.diary`, which really does declare `--wash`, and the
  // claim is asserted on `.diary-compose`'s box below and in test/control-boxes.test.tsx.
  it('the suggestions composer is on the app ground like every other box', () => {
    const el = at('<div class="suggestions-actions"><input class="vb-ctl"/></div>', 'input');
    expect(box(el).background).toBe('var(--bg)');
    expect(box(el).border).toBe('1px solid var(--border)');
  });

  it('the diary composer is the one that is not, because its pane is the wash', () => {
    const el = at('<div class="diary-compose"><textarea class="vb-ctl"></textarea></div>', 'textarea');
    expect(box(el).background).toBe('var(--panel-2)');
    expect(box(at('<section class="diary"></section>', 'section')).background).toBe('var(--wash)');
  });

  it('an inline rename is already accent-bordered, because it is already active', () => {
    const el = at('<div class="control-list"><input class="vb-ctl"/></div>', 'input');
    expect(box(el)['border-color']).toBe('var(--accent)');
  });

  it('the control editor keeps the monospace face a file is read in', () => {
    const el = at('<textarea class="control-textarea"></textarea>', 'textarea');
    expect(box(el)['font-family']).toBe('var(--font-mono)');
  });
});

describe('every box answers a focus, including the two that did not', () => {
  // THE FIX. `.skill-input` and `.dispatch-prompt` declared no `:focus` rule before this phase; the
  // primitive answers for all of them, so this is `BOXES` and not a subset — a list with an exception
  // in it is exactly what let two slip.
  it.each(BOXES)('%s drops the UA outline and turns its border accent', (_name, el) => {
    const focused = box(el(), ':focus');
    expect(focused.outline).toBe('none');
    expect(focused['border-color']).toBe('var(--accent)');
  });
});

describe('a label, a hint and an error', () => {
  it('a field label is the small step, muted', () => {
    const { container } = render(
      <Field label="L">
        <input />
      </Field>,
    );
    const label = container.querySelector('.vb-text');
    if (!label) throw new Error('Field rendered no label');
    expect(box(label)['font-size']).toBe('0.75rem');
    expect(box(label).color).toBe('var(--muted)');
  });

  it('a rail label is the same, plus uppercase and a fixed width', () => {
    // `.skill-label` and `.dispatch-label` were this, twice, differing only in that width — 6rem
    // against 5.5rem, half a rem apart and nobody chose either.
    const el = at('<span class="vb-text vb-text-caps vb-field-rail">L</span>', 'span');
    expect(box(el)['font-size']).toBe('0.75rem');
    expect(box(el).color).toBe('var(--muted)');
    expect(box(el)['text-transform']).toBe('uppercase');
    expect(box(el).width).toBe('6rem');
  });

  it('a hint is muted and italic, where six classes managed four italics and three sizes', () => {
    const el = at('<p class="vb-text vb-text-quiet">h</p>', 'p');
    expect(box(el).color).toBe('var(--muted)');
    expect(box(el)['font-style']).toBe('italic');
    expect(box(el)['font-size']).toBe('0.75rem');
  });

  it('an error is either danger ink or a danger-tinted box, and both are real', () => {
    // Nine classes said the first and three said the second. Both shapes survive because both are
    // used: a line beside the thing that refused, and a box that IS the answer to a submit.
    const line = box(at('<p class="vb-text vb-text-error">e</p>', 'p'));
    expect(line.color).toBe('var(--danger)');
    expect(line.border).toBeUndefined();

    // The box half is `.vb-notice-bad` since the tinted-notice merge: `.vb-error-box`, `.settings-warn`,
    // `.control-disclaimer` and `.sandbox-state` were one box in three hues. The border is now declared
    // as a `border-color` over the notice's transparent 1px, which is the same rendered edge.
    const boxed = box(at('<p class="vb-notice vb-notice-bad">e</p>', 'p'));
    expect(boxed.color).toBe('var(--danger)');
    expect(boxed['border-color']).toBe('color-mix(in srgb, var(--danger) 35%, transparent)');
    expect(boxed['border-radius']).toBe('6px');
  });
});
