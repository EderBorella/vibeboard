// @vitest-environment jsdom
//
// EVERY LITERAL CONTROL IN THE TREE, AND THE ONE BOX THEY ALL DRAW.
//
// A CHARACTERISATION suite for Phase 9 of docs/design-system.md. It was written and run green against the
// code as it was BEFORE any migration, pinning fifteen different boxes; the assertions below are the same
// claims with the values the merge moved them to, and the five findings that came out of writing it are
// recorded here rather than smoothed away. `git show` on this file is the before-and-after.
//
//   1. TWO CONTROLS DREW NO BOX AT ALL. `.raw-area` — a whole card's file, in the dock — declared a
//      monospaced face and nothing else, and the suggestions pane's level `<select>` declared nothing
//      whatever. Both rendered the browser's own control chrome beside a `.vb-input` in the same pane.
//      That is Phase 5's `.skill-input`/`.dispatch-prompt` finding one level along: not a box that
//      disagrees, a box that was never drawn. Both are the primitive's box now.
//   2. SIX DECLARED NO `:focus` RULE, so they fell through to the app's global ring where the eight boxes
//      Phase 5 took turn their border accent. Nothing chose between the two. All fifteen answer alike now,
//      and the exception is asserted below: a CHECKBOX keeps the ring, because it paints no border to turn.
//   3. A HAND-ROLLED `.vb-field` LABEL HAD NO CLASS AND THEREFORE NO TREATMENT. `<label class="vb-field">
//      <span>Location (parent folder)</span>` in the project gate, and the same shape on all five
//      auto-pilot caps: the label rendered at the value's own size and ink, so the name of the field and
//      the number in it looked identical. It is the mirror of Phase 5b's `.vb-label-caps`, which was named
//      at eight call sites and defined by no rule — this was a rule that existed and seven call sites that
//      never asked for it. `Field` asks for it.
//   4. `.link-option`'s `font-size: var(--t-body)` WAS DEAD — `body` already gave it, which is the defect
//      Phase 4 found on `.cv-link` and Phase 8 on `.tag-chip-count`. The class is gone.
//   5. THE SUGGESTIONS COMPOSER'S `--panel-2` GROUND NAMED A GROUND ITS PANE DOES NOT HAVE. Its recorded
//      reason was "it sits in a `--wash` pane where `--bg` would read as a hole" — and `.suggestions-pane`
//      declares no ground, so it takes the dock's `--panel`, exactly as `.modal` and `.gate-card` do, and
//      both of those put their boxes on `--bg`. `.diary` IS on `--wash`, and `.diary-compose`'s box is the
//      one that reason belongs to. Asserted as the pair below, so the difference stays a measurement.
//
// It asserts the BOX A CLASS LIST DRAWS, resolved out of the stylesheets by test/css-box.tsx, because
// jsdom loads no CSS. The paddings ARE pinned here, unlike test/field-boxes.test.tsx: this suite's whole
// subject was a set of boxes nobody chose, and six of the fifteen differences were the padding.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Field } from '../web/src/ui/Field.js';
import { box } from './css-box.js';

afterEach(cleanup);

// `el.matches()` works on a detached tree, so there is nothing to mount. Throws rather than returning
// null: several of these boxes are reached through a descendant selector, and a bare element with a class
// on it would match nothing and let every assertion pass on an empty object.
function at(html: string, selector: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  const el = host.querySelector(selector);
  if (!el) throw new Error(`no ${selector} in ${html}`);
  return el;
}

// THE FIELD AND THE CHECK ROW AS THE COMPONENT RENDERS THEM. No class list is hand-written for either,
// so renaming `vb-field-check` moves the fixture instead of quietly testing a dead class.
function inField(kind: 'input' | 'select' | 'textarea'): Element {
  const control = kind === 'select' ? <select /> : kind === 'textarea' ? <textarea /> : <input type="text" />;
  const { container } = render(<Field label="L">{control}</Field>);
  const el = container.querySelector(kind);
  if (!el) throw new Error(`Field rendered no ${kind}`);
  return el;
}

function checkRow(): { row: Element; label: Element; check: Element } {
  const { container } = render(
    <Field layout="check" label="L">
      <input type="checkbox" />
    </Field>,
  );
  const row = container.querySelector('.vb-field');
  const label = container.querySelector('.vb-label');
  const check = container.querySelector('input');
  if (!row || !label || !check) throw new Error('the check layout rendered no row, label or box');
  return { row, label, check };
}

// The fifteen controls the census counted outside a `<Field>` after Phase 5, named by where they live.
// Nine are `Field`s now and six carry `.vb-input` — the box primitives.css names for a control with no
// label to give — and this list does not distinguish them, deliberately: the claim is the BOX.
const CONTROLS: [name: string, el: () => Element][] = [
  [
    'the top bar theme select',
    () => at('<div class="topbar-right"><select class="vb-input"/></div>', 'select'),
  ],
  ['the dispatch effort select', () => inField('select')],
  ['a report column select', () => at('<div class="report-foot"><select class="vb-input"/></div>', 'select')],
  [
    'the archive restore-elsewhere select',
    () => at('<div class="archive-actions"><select class="vb-input archive-column"/></div>', 'select'),
  ],
  [
    'the model picker provider filter',
    () => at('<div class="mp-filters"><select class="vb-input push"/></div>', 'select'),
  ],
  [
    'the copilot effort select',
    () => at('<div class="copilot-selects"><select class="vb-input"/></div>', 'select'),
  ],
  [
    'the copilot composer',
    () => at('<div class="copilot-input"><textarea class="vb-input"></textarea></div>', 'textarea'),
  ],
  [
    'the diary composer',
    () => at('<div class="diary-compose"><textarea class="vb-input"></textarea></div>', 'textarea'),
  ],
  [
    'the control editor body',
    () => at('<textarea class="vb-input control-textarea"></textarea>', 'textarea'),
  ],
  [
    'a links registry cell',
    () => at('<div class="resource-row"><input class="vb-input res-title"/></div>', 'input'),
  ],
  [
    'the raw card file',
    () => at('<div class="raw-pane"><textarea class="vb-input raw-area"></textarea></div>', 'textarea'),
  ],
  [
    'the suggestions level select',
    () => at('<div class="suggestions-actions"><select class="vb-input"/></div>', 'select'),
  ],
  ['an auto-pilot cap', () => inField('input')],
  ['a skill name', () => inField('input')],
  ['the dispatch prompt', () => inField('textarea')],
];

const PRIMITIVE = {
  border: '1px solid var(--border)',
  radius: '6px',
  ground: 'var(--bg)',
  size: '0.8125rem',
  padding: '6px 8px',
};

describe('the fifteen controls Field had not taken draw one box', () => {
  it.each(CONTROLS)('%s has the same 1px border and button corner', (_name, el) => {
    expect(box(el()).border).toBe(PRIMITIVE.border);
    expect(box(el())['border-radius']).toBe(PRIMITIVE.radius);
  });

  // SIX PADDINGS BECAME ONE, and the arithmetic is the argument: 4/8, 3.2/8, 3.52/6, 4/6, 8, 12.8 and
  // 6/8 px for one kind of box, plus two boxes with no padding at all. `var(--s-3) var(--s-4)` — 6/8 —
  // is the primitive's, which is the one of the seven a person had chosen.
  it.each(CONTROLS)('%s is padded the primitive’s 6/8', (_name, el) => {
    expect(box(el()).padding).toBe(PRIMITIVE.padding);
  });

  // A CONTROL AT 12px BESIDE AN INPUT AT 13px IS THE SHAPE OF THE 10.88px INCIDENT, which is the reason
  // Phase 5b gives for putting the two select triggers at `--t-body`. Six of these were still at 12px.
  it.each(CONTROLS)('%s is set at the body step', (_name, el) => {
    expect(box(el())['font-size']).toBe(PRIMITIVE.size);
  });

  // FIVE GROUNDS BECAME ONE, and the one exception keeps its own case below rather than being excluded
  // from this list silently — which is what let two silent focus rules through in Phase 5.
  it.each(CONTROLS.filter(([name]) => name !== 'the diary composer'))(
    '%s sits on the app ground',
    (_name, el) => {
      expect(box(el()).background).toBe(PRIMITIVE.ground);
    },
  );
});

describe('the survivors that differ, and what each one still says', () => {
  it('the diary composer keeps the panel ground, because its pane is the wash', () => {
    // `--wash` is `none` in classic-dark, so `--bg` on `--bg` would render as no box at all.
    expect(box(at('<section class="diary"></section>', 'section')).background).toBe('var(--wash)');
    const el = at('<div class="diary-compose"><textarea class="vb-input"></textarea></div>', 'textarea');
    expect(box(el).background).toBe('var(--panel-2)');
  });

  it('the suggestions composer does not, and its pane is why', () => {
    // No ground of its own, so it takes the dock's `--panel` — which is what `.modal` and `.gate-card`
    // are, and both of those put their boxes on `--bg`.
    expect(box(at('<div class="suggestions-pane"></div>', 'div')).background).toBeUndefined();
    expect(box(at('<div class="dock"></div>', 'div')).background).toBe('var(--panel)');
    expect(box(at('<div class="modal"></div>', 'div')).background).toBe('var(--panel)');
    expect(box(at('<div class="gate-card"></div>', 'div')).background).toBe('var(--panel)');
    const el = at('<div class="suggestions-actions"><input class="vb-input"/></div>', 'input');
    expect(box(el).background).toBe(PRIMITIVE.ground);
  });

  it('the archive restore-elsewhere select keeps a muted ink', () => {
    // A secondary restore must not read as loudly as the Restore button beside it. An ink somebody
    // chose is the accepted survivor reason; a padding of its own is not.
    const el = at('<div class="archive-actions"><select class="vb-input archive-column"/></div>', 'select');
    expect(box(el).color).toBe('var(--muted)');
  });

  it.each([
    ['the control editor body', '<textarea class="vb-input control-textarea"></textarea>', 'textarea'],
    [
      'the raw card file',
      '<div class="raw-pane"><textarea class="vb-input raw-area"></textarea></div>',
      'textarea',
    ],
  ])('%s keeps the monospaced face a file is read in', (_name, html, sel) => {
    // The CONTENT is machine text, which is not the same claim as `Readout`'s — that a figure was
    // measured — so these are not readouts and the mono census keeps them.
    expect(box(at(html, sel))['font-family']).toBe('var(--font-mono)');
  });
});

describe('every control answers a focus the same way, and the checkbox is the stated exception', () => {
  it.each(CONTROLS)('%s drops the UA outline and turns its border accent', (_name, el) => {
    expect(box(el(), ':focus').outline).toBe('none');
    expect(box(el(), ':focus')['border-color']).toBe('var(--accent)');
  });

  it('a checkbox in a Field keeps the app ring, because it paints no border to turn', () => {
    // PHASE 6'S FINDING AND PHASE 6'S FIX, pinned here because Phase 9 adds five more of them:
    // `.vb-field input:focus` traded the app's `:focus-visible` ring for an accent border, and a native
    // checkbox paints none — so it removed the ring and replaced it with nothing. Two controls in
    // Settings and one in Diagnostics were focusable with no visible focus at all.
    const { check } = checkRow();
    expect(box(check, ':focus').outline).toBeUndefined();
    expect(box(check, ':focus')['border-color']).toBeUndefined();
  });

  it('and a select answers the pointer as well, which five of seven said by hand', () => {
    // `.theme-select` carried `cursor: pointer` and an accent hover at four call sites and
    // `.archive-column` carried the cursor; `.mp-prov` and `.copilot-selects select` had neither.
    const el = at('<select class="vb-input"/>', 'select');
    expect(box(el).cursor).toBe('pointer');
    expect(box(el, ':hover')['border-color']).toBe('var(--accent)');
  });
});

describe('a field label has a treatment now, because Field asks for one', () => {
  it('a stacked label is the small step, muted', () => {
    const { container } = render(
      <Field label="L">
        <input />
      </Field>,
    );
    const label = container.querySelector('.vb-label');
    if (!label) throw new Error('Field rendered no label');
    expect(box(label)['font-size']).toBe('0.75rem');
    expect(box(label).color).toBe('var(--muted)');
  });

  it('a caps label is that face without the rail’s width, which two labels wrote by hand', () => {
    // THE FACE AND THE WIDTH ARE SEPARATE AXES — Phase 5b's ruling, and this is its second consumer.
    // `SkillEditor`'s prompt label and `DispatchPane`'s each wrote `vb-label vb-label-caps` over a
    // control too tall to sit beside them; the skill editor's also named `vb-label-rail`, whose 6rem
    // was doing nothing on a full-width label.
    const { container } = render(
      <Field caps label="L">
        <textarea />
      </Field>,
    );
    const label = container.querySelector('.vb-label');
    if (!label) throw new Error('Field rendered no label');
    expect(box(label)['text-transform']).toBe('uppercase');
    expect(box(label)['letter-spacing']).toBe('0.06em');
    expect(box(label).width).toBeUndefined();
  });

  it('a rail label is the same face plus the fixed width', () => {
    const { container } = render(
      <Field layout="rail" label="L">
        <input />
      </Field>,
    );
    const label = container.querySelector('.vb-label');
    if (!label) throw new Error('Field rendered no label');
    expect(box(label)['text-transform']).toBe('uppercase');
    expect(box(label).width).toBe('6rem');
  });
});

describe('a decision’s label is content, not a field name', () => {
  // MEASURED, NOT CHOSEN: five checkbox rows in the tree labelled themselves at the surrounding size
  // and ink — `.link-option` at four sites and Diagnostics' bare span — against one at `.vb-label`'s
  // muted 12px. A card title or a file path shrunk to 12px muted reads as furniture, and it is the
  // thing being chosen. One site changed: Settings' `Enforce 1-to-many relations on boards`.
  it('is set at the surrounding size and ink', () => {
    const { label } = checkRow();
    expect(box(label)['font-size']).toBe(PRIMITIVE.size);
    expect(box(label).color).toBe('var(--text)');
  });

  it('is a row, because a decision’s label is often more than one part', () => {
    // `.link-option` laid out an id and a title itself, while both were its own children; the label
    // holds them now, so the gap moved onto the label. The value is `.link-option`'s.
    const { label } = checkRow();
    expect(box(label).display).toBe('flex');
    expect(box(label)['align-items']).toBe('center');
    expect(box(label).gap).toBe('8px');
  });

  it('and the whole row is a pointer, which is what a wrapping label already means', () => {
    const { row, check } = checkRow();
    expect(box(row).cursor).toBe('pointer');
    expect(box(check).cursor).toBe('pointer');
  });
});

describe('the model picker filter row, resolved', () => {
  // Phase 8 moved `.mp-chip` from `--t-small` to `--t-micro` deliberately: nine of the ten chip classes
  // were already there and it is the scale's own name for "chips, state words, dot labels, tags". The
  // select beside it stayed at `--t-small`, which nothing chose — and it is `--t-body` now.
  // A CONTROL IS 13px AND A CHIP IS 11px. The row holds both and now says so, which is the same ruling
  // Phase 5b made putting the two select triggers at `--t-body` beside the inputs they share a row with.
  it('sets the chips at the chip step and the select at the control step', () => {
    const chip = at('<div class="mp-filters"><button class="vb-chip vb-chip-pill mp-chip"/></div>', 'button');
    const select = at('<div class="mp-filters"><select class="vb-input push"/></div>', 'select');
    expect(box(chip)['font-size']).toBe('0.6875rem');
    expect(box(select)['font-size']).toBe(PRIMITIVE.size);
    // And the select's box is the same box as the search input above it in the same modal, which is
    // what the two steps are distinguishing: two controls at 13px, three chips at 11px.
    const search = at('<div class="mp-modal"><input class="vb-input"/></div>', 'input');
    expect(box(select).padding).toBe(box(search).padding);
    expect(box(select)['border-radius']).toBe(box(search)['border-radius']);
  });
});
