// @vitest-environment jsdom
//
// THE FOUR FAMILIES PHASE 5b MERGES, pinned before it merges them: the uppercase section labels, the
// empty-state lines, the tinted notice boxes and the two select triggers.
//
// A CHARACTERISATION suite, written and run green against the code as it was BEFORE any migration. It
// found two things, and the first is a live defect rather than an untidiness:
//
//   `.vb-label-caps` IS NAMED AT EIGHT CALL SITES AND DEFINED BY NO RULE. The skill editor's three rail
//   labels and the dispatch pane's five all write `className="vb-label vb-label-caps …"`, and no
//   stylesheet in the tree contains the string `label-caps`. Seven of the eight are uppercase anyway,
//   because `.vb-label-rail` carries the `text-transform` — but `DispatchPane.tsx:140`'s prompt label has
//   no rail, so it names a class for its caps and renders in lower case. Neither gate could see it: the
//   class-budget check reads CSS → code and this is a name that goes the other way, and every React test
//   runs in jsdom, which computes no cascade.
//   Pinned below as `it.fails`, which is how a known bug is written so that it FLIPS the moment it is
//   fixed rather than being quietly reworded.
//
//   `test/field-boxes.test.tsx`'s rail-label test was VACUOUS about the same thing. Its fixture is
//   `<span class="vb-label vb-label-caps vb-label-rail">` and it asserts `text-transform: uppercase` —
//   which `.vb-label-rail` supplies on its own, so the assertion is true of a fixture that could not have
//   contained the class it names. A fixture too thin to distinguish two outcomes tests neither.
//
// It asserts the BOX A CLASS LIST DRAWS, resolved out of the stylesheets by test/css-box.tsx, rather than
// the class name that draws it — so a declaration moving from a surface class into a primitive reads as
// the same value and the assertion survives the migration.
//
// WHAT IS DELIBERATELY NOT PINNED, family by family, because pinning a value the merge exists to
// normalise would make the suite a description of the old code:
//   - the labels' `letter-spacing`: it was five values across fourteen classes (0.06 / 0.08 / 0.1 /
//     0.12em) and is `var(--track)` everywhere as of the space-and-tracking sweep;
//   - the empty states' `font-style`: seven italic, ten not, with nothing distinguishing them;
//   - the notices' `line-height` (1.45 / 1.5 / 1.55) and the triggers' vertical padding.
// What IS pinned in each family is the thing a person can see and somebody chose: an ink, a hue, a size.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Surface } from '../web/src/atoms/Surface.js';
import { box } from './css-box.js';

afterEach(cleanup);

// `el.matches()` works on a detached tree, so there is nothing to mount. It throws rather than returning
// null because a descendant selector missing its ancestor would otherwise make every assertion pass on
// an empty object.
function at(html: string, selector: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  const el = host.querySelector(selector);
  if (!el) throw new Error(`no ${selector} in ${html}`);
  return el;
}

const label = (classes: string, tag = 'span') => at(`<${tag} class="${classes}">L</${tag}>`, tag);

describe('the uppercase section labels', () => {
  // THE FOURTEEN, and the table is the argument for the merge as well as the argument against most of
  // it. Every one is uppercase; the ink is the column somebody chose and the tracking is the one nobody
  // did. `.mp-def-tag` is on the list in docs/design-system.md and is NOT one of these: it carries a
  // border and a pill radius, which makes it a Chip that happens to be uppercase.
  // `.ap-drawer-head` AND `.settings-section` HAVE LEFT THIS TABLE and are asserted on their own below:
  // both render a `Text caps` now, so the uppercase is the atom's and the accent is a data attribute
  // rather than a declaration — a class-only fixture cannot express either, and would report `undefined`
  // for both while the call sites draw exactly what this table claimed.
  const LABELS: [string, string][] = [
    // SEVEN ROWS LEFT THIS TABLE IN PHASE 8 AND THEY ARE ALL IN `MIGRATED` BELOW. Three groups migrated
    // these in parallel and each rewrote this table for its own two or three, which is what made the
    // merge conflict: `.ap-drawer-head` and `.settings-section`, `.links-group`, and `.diary-kind` /
    // `.filed-state` / `.tile-group`. A row here asserts what a hand-written CLASS LIST draws; once the
    // ink moves to `data-ink` a class list cannot express it, and the accent cases would have passed on
    // `.vb-text`'s muted default. One table, one fixture idiom, six rows — not three half-migrations.
    ['cv-group', 'var(--accent-2)'],
  ];

  it.each(LABELS)('.%s is uppercase', (cls) => {
    expect(box(label(cls))['text-transform']).toBe('uppercase');
  });

  it.each(LABELS)('.%s keeps its own ink, %s', (cls, ink) => {
    expect(box(label(cls)).color).toBe(ink);
  });

  // SIX OF THE EIGHT ARE A `Text` NOW, AND THE TABLE IS THE SAME TWO CLAIMS ABOUT THE SAME ELEMENT.
  // Phase 8's caps ruling is what moved them: `.vb-text-caps` carries `--font-display` as well as the
  // `text-transform` and the tracking — which is what these wrote by hand — and an ink that is nobody's
  // state is `data-ink`. So the fixture is the element AS RENDERED, class list and attribute, written out
  // here rather than reached through `label()` for the reason this file already gives: a fixture that
  // cannot carry the attribute cannot see the rule that draws the ink.
  // What each class still says is a STEP — `--t-micro` for five of the seven — except `.cs-head`, which
  // says the 2px UNDER its one line: a gap is uniform across a column, and one child wanting more room
  // below itself is the thing `Stack gap` cannot express.
  // AN EMPTY INK IS NOT A MISSING ROW: it is the two that keep the atom's muted default, and asserting
  // them here is what distinguishes "the default is right" from "the attribute was dropped".
  // AND FOUR OF THESE HAVE NO CLASS LEFT TO NAME, as of wave 2 — `.diary-kind`, `.filed-state`,
  // `.tile-group` and `.ap-drawer-head`. Each held ONE `font-size: var(--t-micro)` once the ink moved to
  // `data-ink`, and the step is `data-size` now, so there is nothing for a class column to hold. Leaving a
  // row here would be worse than deleting it: both of its assertions would be answered by `.vb-text-caps`
  // alone, so the row would pass whatever happened to the element. They are asserted below on the
  // attribute pair, plus a negative that says the classes are really gone.
  const MIGRATED: [string, string, string][] = [
    // `.cs-head` is here and `.ap-drawer-head` is NOT, and the difference is whether a class survives:
    // the skills head kept a `margin-bottom` so its face is still worth asserting against its class list,
    // while the drawer head kept nothing and is in `GONE` below.
    ['cs-head', '', 'var(--muted)'],
    ['links-group', '', 'var(--muted)'],
    ['settings-section', 'accent', 'var(--accent)'],
  ];
  const migrated = (cls: string, ink: string): Element =>
    at(`<span class="vb-text vb-text-caps ${cls}"${ink === '' ? '' : ` data-ink="${ink}"`}>L</span>`, 'span');

  it.each(MIGRATED)('.%s is uppercase, through the caps atom', (cls, ink) => {
    expect(box(migrated(cls, ink))['text-transform']).toBe('uppercase');
  });

  it.each(MIGRATED)('.%s keeps its own ink, %s → %s', (cls, ink, colour) => {
    expect(box(migrated(cls, ink)).color).toBe(colour);
  });

  // AND THE INK IS THE ATTRIBUTE'S RATHER THAN THE ATOM'S DEFAULT, asserted as the negative it replaces:
  // without `data-ink` the four that name one would render `--muted`, which is the silent change a class
  // list alone could not tell from a correct one.
  it('a caps line with no ink named takes the atom\u2019s muted default', () => {
    expect(box(label('vb-text vb-text-caps')).color).toBe('var(--muted)');
  });

  // THE THREE THAT KEPT NOTHING, and both halves of what they used to say are asserted together because
  // dropping either one is silent. `.diary-kind` and `.filed-state` were `--t-micro` in `--text`;
  // `.tile-group` was `--t-micro` in `--accent-2`. The STEP is the half a class held to the end, so it is
  // named as a resolved value rather than as the token \u2014 see test/css-box.tsx on why.
  const MICRO_EYEBROWS: [string, string, string][] = [
    ['.diary-kind and .filed-state', 'strong', 'var(--text)'],
    ['.tile-group', 'accent2', 'var(--accent-2)'],
  ];
  it.each(MICRO_EYEBROWS)('%s is a caps eyebrow at the micro step, ink %s', (_what, ink, colour) => {
    const el = at(`<span class="vb-text vb-text-caps" data-size="micro" data-ink="${ink}">L</span>`, 'span');
    const drawn = box(el);
    expect(drawn['text-transform']).toBe('uppercase');
    expect(drawn['font-size']).toBe('0.6875rem');
    expect(drawn.color).toBe(colour);
  });

  // AND THE THREE CLASSES ARE GONE, as a negative rather than deleted from the suite: a class quietly
  // coming back is how this family grew a second name for one face before.
  it.each([['diary-kind'], ['filed-state'], ['tile-group']])('.%s is gone', (cls) => {
    expect(box(label(cls))['font-size']).toBeUndefined();
  });

  // THE CAPS FACE INCLUDES THE FAMILY as of Phase 8, and eight classes wrote it beside the transform.
  // Asserted here because nothing else in the tree does: a `caps` that lost the family again would leave
  // every assertion above green while every eyebrow in the app rendered in the body face — which is how
  // `.control-group-head` lost it in the first place.
  it('.vb-text-caps carries the display family the eight wrote by hand', () => {
    expect(box(label('vb-text vb-text-caps'))['font-family']).toBe('var(--font-display)');
  });

  // The one that names NO ink and inherits one. Merging it onto a primitive that names `--muted` would
  // be a visible change to whatever it sits in, so it is named here rather than assumed.
  // `.report-prompt-label` WAS THE SECOND AND IS IN `GONE` BELOW, for `.ap-drawer-head`'s reason.
  it.each([['exec-head']])('.%s names no ink of its own', (cls) => {
    expect(box(label(cls)).color).toBeUndefined();
  });

  // THE TWO STEPS THAT BECAME `size=`, asserted as the negative they replace. Both classes held exactly
  // one `font-size` — `--t-micro` — and both are now an attribute on the `Text` that was already there.
  // Asserted rather than deleted from the suite because a class quietly coming back is how a step gets a
  // second spelling again, and because a live rule here would silently outrank `[data-size]` at equal
  // specificity from a later sheet.
  it.each([['ap-drawer-head'], ['report-prompt-label']])('.%s is gone, replaced by the step', (cls) => {
    expect(box(label(cls))['font-size']).toBeUndefined();
  });

  // THE DEFECT, NOW FIXED. It was written as the contract and marked `it.fails`, so it flipped the
  // moment the rule existed rather than being quietly reworded — which is the whole point of pinning a
  // known bug. `.vb-label-rail` is a width and nothing else now, so this is the only thing that says the
  // caps face is applied at all, at nine call sites.
  it('.vb-text-caps draws the caps face on its own', () => {
    expect(box(label('vb-text vb-text-caps'))['text-transform']).toBe('uppercase');
  });

  // THE RAIL IS A WIDTH AND NOTHING ELSE, which is the other half of the same repair and the reason
  // nobody noticed the first half: the rail used to supply the caps, so seven of the eight call sites
  // looked right while naming a class that decided nothing. Asserted as a negative, because a rail that
  // quietly took the `text-transform` back would make the class above vacuous again without failing.
  it('.vb-field-rail supplies a width and NOT the caps face', () => {
    const b = box(label('vb-text vb-field-rail'));
    expect(b['text-transform']).toBeUndefined();
    expect(b.width).toBe('6rem');
  });

  // THE TWO THAT DIED, and they died outright: `--t-small` muted uppercase with `margin: 0` is exactly
  // `.vb-label` plus `.vb-label-caps`, and there was no judgement in either of them.
  it.each([['reports-head'], ['options-head']])('.%s is gone, replaced by the pair', (cls) => {
    expect(box(label(cls))['text-transform']).toBeUndefined();
  });

  it('a section head is the pair, and reads as the two classes it replaced did', () => {
    const b = box(label('vb-text vb-text-caps', 'h4'));
    expect([b['text-transform'], b['font-size'], b.color, b.margin]).toEqual([
      'uppercase',
      '0.75rem',
      'var(--muted)',
      '0',
    ]);
  });
});

describe('the empty-state lines', () => {
  // SEVENTEEN NAMES BEFORE THIS COMMIT, and every single one of them said `color: var(--muted)`. That is
  // the whole family: muted prose where content would be. Thirteen now render `.vb-empty` and the
  // treatment is declared once.
  // THE ATOM LAYER MADE THE SIX NAMES FIVE AND `.vb-empty-small` THE ONE THAT DIED: `--t-small`, muted,
  // italic is `.vb-hint` declaration for declaration, so the pair that used to read
  // `vb-empty vb-empty-small` is now just the hint face. An empty state is `role="hint"` with `lead`.
  const MERGED = [
    'vb-text vb-text-quiet vb-text-lead',
    'vb-text vb-text-quiet',
    'mp-empty vb-text vb-text-quiet vb-text-lead',
    'cards-gone vb-text vb-text-quiet vb-text-lead',
    'cs-empty vb-text vb-text-quiet vb-text-lead',
    'control-empty vb-text vb-text-quiet',
    'explorer-more vb-text vb-text-quiet',
  ];

  it.each(MERGED)('.%s is muted italic prose', (cls) => {
    const b = box(label(cls, 'p'));
    expect(b.color).toBe('var(--muted)');
    expect(b['font-style']).toBe('italic');
  });

  // THE EIGHT THAT DIED, and they died outright: nothing was left of them once the shared treatment came
  // out. Asserted as a negative rather than deleted from the suite, because a class quietly coming back
  // is exactly how a family grows a second name again.
  it.each([
    ['archive-empty'],
    ['cv-nobody'],
    ['report-empty'],
    ['inline-empty'],
    ['copilot-empty'],
    ['ap-drawer-empty'],
    ['exec-empty'],
    ['chat-menu-empty'],
  ])('.%s is gone', (cls) => {
    expect(box(label(cls, 'p')).color).toBeUndefined();
  });

  // THE FIVE THAT SURVIVE CARRY ONLY WHAT THE SURFACE CAN DECIDE — an inset or a size — which is the
  // same result Phase 3 measured: 19 of its 27 migrated classes still had a real declaration left. A
  // survivor that still named an ink or a font-style would mean the merge had not actually happened.
  it.each([
    ['mp-empty', 'padding'],
    ['cards-gone', 'padding'],
    ['control-empty', 'padding'],
    // THESE TWO NO LONGER KEEP A STEP, and that is the wave that gave `Text` a `size`: both were one
    // `--t-micro`, which is `size="micro"` now. `.explorer-more`'s was DEAD where it was — the class is on
    // the wrapper and the words are in a `<Text>` inside it, so `.vb-text`'s `--t-small` won. What each
    // still says is where the line sits.
    ['explorer-more', 'padding'],
    ['cs-empty', 'margin-top'],
  ])('.%s keeps only its %s', (cls, prop) => {
    const own = box(label(cls, 'p'));
    const shared = box(label('vb-text vb-text-quiet vb-text-lead', 'p'));
    // Everything it still declares beyond the primitive is positional or a size — never an ink or a face.
    const extra = Object.keys(own).filter((k) => own[k] !== shared[k]);
    expect(extra).toContain(prop);
    expect(extra).not.toContain('color');
    expect(extra).not.toContain('font-style');
  });

  it('a menu list decides its own inset, and the line inside it decides nothing', () => {
    const el = at('<div class="vb-menu vb-menu-list"><p class="vb-text vb-text-quiet">x</p></div>', 'p');
    expect(box(el).padding).toBe('8px');
  });

  // THE FOUR THAT ARE NOT IN THE FAMILY, each for a reason a person can see. Pinned so that "they are all
  // one thing" cannot quietly grow to cover them.
  it('.column-empty is a dashed drop target and not a line of prose', () => {
    expect(box(label('column-empty', 'p')).border).toBe('1px dashed var(--border)');
  });

  it.each([['empty']])('.%s is a margin:auto blank filling a pane', (cls) => {
    expect(box(label(cls, 'div')).margin).toBe('auto');
  });

  // A `Stack direction="column"` draws it now, so the fixture carries `data-dir` — and the claim is
  // STRONGER than it was: the old version asserted `display: flex` alone, which a row satisfies too.
  it('.diary-empty is a flex column, not a line', () => {
    const b = box(at('<div class="vb-stack diary-empty" data-dir="column">L</div>', 'div'));
    expect([b.display, b['flex-direction']]).toEqual(['flex', 'column']);
  });
});

describe('the tinted notice boxes', () => {
  // FIVE CLASSES DREW ONE BOX: `.vb-error-box`, `.settings-warn`, `.control-disclaimer` and
  // `.sandbox-state`, all with a `--r-md` corner, `var(--s-4) 0.7rem` of padding and a 1px border, and
  // differing only in hue. They are `.vb-notice` in three tones now.
  const TONES = [
    ['vb-notice vb-notice-bad', 'var(--danger)', 'danger'],
    ['vb-notice vb-notice-warn', 'var(--text)', 'warn'],
    ['vb-notice vb-notice-ok', 'var(--text)', 'accent'],
  ];

  it.each(TONES)('.%s is one 6px box', (cls) => {
    const b = box(label(cls, 'div'));
    expect(b['border-radius']).toBe('6px');
    expect(b.padding).toBe('8px 12px');
  });

  // THE INK IS PART OF THE TONE, and this is the assertion that says so: `bad` is danger ink because a
  // refusal IS the answer to what you just did, while `warn` and `ok` are prose ink.
  it.each(TONES)('.%s inks its prose %s', (cls, ink) => {
    expect(box(label(cls, 'div')).color).toBe(ink);
  });

  // The hue each tone is tinted with. `--warn` and `--danger` are not interchangeable — themes.css gives
  // them different values in marshmallow — so a tone that quietly took the other one would be a repaint.
  it.each(TONES)('.%s is tinted with its own hue', (cls, _ink, hue) => {
    expect(box(label(cls, 'div')).background).toContain(`var(--${hue}`);
  });

  // THE FIVE THAT DIED. Asserted as a negative so a name cannot creep back.
  it.each([['vb-error-box'], ['settings-warn'], ['sandbox-state'], ['sandbox-ok'], ['sandbox-off']])(
    '.%s is gone',
    (cls) => {
      expect(box(label(cls, 'div'))['border-radius']).toBeUndefined();
    },
  );

  // THE ONE SURVIVOR, and it keeps exactly two things the primitive cannot say: the shell's inset, and a
  // prose ink on the danger hue. That combination is deliberate and is `.control-disclaimer`'s own
  // argument — "set as prose rather than as status" — so it overrides the tone's ink at equal
  // specificity, which is the pattern the emergency stop's danger hover already established.
  it('.control-disclaimer keeps a prose ink on the danger hue, and nothing else', () => {
    const b = box(label('vb-notice vb-notice-bad control-disclaimer', 'div'));
    expect(b.color).toBe('var(--text)');
    expect(b.background).toContain('var(--danger');
    expect(b.margin).toBe('12px 16px 0');
    expect(b['border-radius']).toBe('6px');
  });

  it('two stacked notices are separated, which .sandbox-state + .sandbox-state used to say', () => {
    const el = at(
      '<div><p class="vb-notice vb-notice-ok">a</p><p class="vb-notice vb-notice-warn">b</p></div>',
      'p + p',
    );
    expect(box(el)['margin-top']).toBe('6px');
  });
});

describe('the two select triggers', () => {
  // THEY ARE `.vb-ctl`'s BOX WITH A CARET, which is what docs/design-system.md called them in Phase 3
  // and again in Phase 4 — "an `<input>` that happens to be a button" — without either of them becoming
  // one. `.vb-trigger` is that box plus a click.
  it('a trigger is the input box, declaration for declaration', () => {
    const trigger = box(label('vb-trigger', 'button'));
    const input = box(label('vb-ctl', 'input'));
    for (const prop of ['background', 'border', 'border-radius', 'padding', 'font-size', 'color']) {
      expect([prop, trigger[prop]]).toEqual([prop, input[prop]]);
    }
  });

  it('a trigger turns its border accent on hover, as an input does on focus', () => {
    expect(box(label('vb-trigger', 'button'), ':hover')['border-color']).toBe('var(--accent)');
    expect(box(label('vb-ctl', 'input'), ':focus')['border-color']).toBe('var(--accent)');
  });

  it('a trigger dims when disabled', () => {
    expect(box(label('vb-trigger', 'button'), ':disabled').opacity).toBe('0.5');
  });

  it('the label takes the slack and ellipsises; the caret does not shrink', () => {
    const lab = box(label('vb-clip'));
    expect(lab.flex).toBe('1');
    expect(lab['text-overflow']).toBe('ellipsis');
    expect(box(label('vb-caret')).flex).toBe('none');
  });

  // ONE CARET, AND IT WAS TWO — `.mp-caret` muted at the trigger's size, `.chat-caret` accent at
  // `--t-micro`, same glyph, same role, nothing choosing between them.
  it.each([['mp-caret'], ['chat-caret']])('.%s is gone', (cls) => {
    expect(box(label(cls)).color).toBeUndefined();
  });

  // THE THREE THAT DIED, and the two differences that went with them were not chosen by anybody: the
  // chat switcher's `--panel-2` ground against the model picker's `--bg` (nine of the ten boxes Field
  // took chose `--bg`), and two pixels of vertical padding.
  it.each([['chat-current'], ['chat-current-title'], ['mp-trigger']])('.%s is gone', (cls) => {
    expect(box(label(cls, 'button'))['border-radius']).toBeUndefined();
  });

  // A trigger sits in a row with real inputs, so it is sized like one. It was `--t-small` against their
  // `--t-body`, which is the shape of the 10.88px incident: a control two thirds of a pixel off its
  // neighbours, that nobody could name and so nobody could see disagreed.
  it('a trigger is sized like the inputs it shares a row with', () => {
    expect(box(label('vb-trigger', 'button'))['font-size']).toBe('0.8125rem');
  });
});

describe('the segmented control', () => {
  // FOUR CLASSES SAID ONE THING, and the proof is mechanical rather than argued: `.mode-group` and
  // `.backend-toggle` were byte-identical, `.mode-btn` and `.bt-btn` were identical apart from one size
  // step, and `.backend-toggle-md .bt-btn` restated `.mode-btn`'s padding and font-size verbatim. Taken
  // as multisets, the four classes declared 36 things with 19 distinct values; `.vb-seg`,
  // `.vb-seg-cell` and `.vb-seg-cell-sm` declared 19, and the distinct sets were identical — nothing
  // added, nothing removed, nothing changed.
  //
  // THE VALUES BELOW ARE UNCHANGED AND THE SELECTORS ARE NOT, and that distinction is the whole of what
  // the molecule phase did to this family. `.vb-seg` / `.vb-seg-cell` are `Tabs grouped`:
  // `.vb-tabs-grouped` and `.vb-tabs-grouped .vb-tab`. Every expectation here survived the migration
  // verbatim — which is the claim that says the group really is the same shape under a different name,
  // and it is a claim a rewritten expectation could not have made. Not one of them was rewritten into a
  // `var(...)` string: `box()` resolves through the sheets, so `6px` is `6px`.
  //
  // THE FIXTURE IS `at()` AND NOT `label()`, because the cell's rules are DESCENDANT rules now. A
  // detached `<button class="vb-tab">` reaches the base cell and nothing else, so every assertion about
  // what the GROUP takes away from a cell would read as absent and pass — the fixture-too-thin failure
  // this file's own header records twice.
  const group = () => label('vb-tabs vb-tabs-grouped', 'div');
  const cell = (state = '') =>
    at(`<div class="vb-tabs vb-tabs-grouped"><button class="vb-tab${state}">x</button></div>`, 'button');

  it('the group owns the border and the corner', () => {
    const b = box(group());
    expect(b.border).toBe('1px solid var(--border)');
    expect(b['border-radius']).toBe('6px');
    // The clip is what makes one box out of many cells, and without it the corners show through.
    expect(b.overflow).toBe('hidden');
  });

  // AND THE CELL OWNS NEITHER, which is the reason Phases 3 and 4 both refused to make these `Button`s:
  // every Button variant gives the cell its own border and radius, which puts a seam down the middle.
  it('a cell has no border and no corner of its own', () => {
    const b = box(cell());
    expect(b.border).toBe('none');
    expect(b['border-radius']).toBeUndefined();
    expect(b['border-right']).toBe('1px solid var(--border)');
  });

  it('the last cell drops the divider', () => {
    expect(box(cell(), ':last-child')['border-right']).toBe('none');
  });

  it('the chosen cell is filled, not outlined', () => {
    const b = box(cell(' active'));
    expect(b.background).toBe('var(--accent-fill)');
    expect(b.color).toBe('var(--on-fill)');
  });

  // THE SUBJECT OF THIS TEST WAS DELETED ON PURPOSE, so it is the mirror claim rather than a rewrite.
  // `sm` was the only thing the four classes disagreed about, and after the atom phase it was one
  // property rather than two: the group declared `--ctl-h` and the cells stretched to fill it, so the
  // vertical padding went, which left `.vb-seg-cell-sm`'s horizontal half restating the base cell's
  // `0 var(--s-4)` value for value. What remained was an 11px label in a 12px row — the 10.88px incident
  // this design system has ruled on twice — and `Tabs` drops it. So what is pinned is that the STEP IS
  // GONE AND CANNOT RETURN: exactly one `font-size` is declared anywhere in the cell's sheet, and it is
  // the row's own. A second one is how a `sm` cell comes back, whatever it is called.
  //
  // Read from the source rather than from a resolved box on purpose: a box can only be asked about a
  // fixture, and a `.vb-tab-sm` nobody wrote a fixture for would be invisible to it.
  it('the sm step is gone from the cell, and there is no second font-size to bring it back', () => {
    const sheet = readFileSync(join(process.cwd(), 'web', 'src', 'molecules', 'tabs.css'), 'utf8');
    const sizes = [...sheet.matchAll(/font-size\s*:\s*([^;}]+)/g)].map(([, v]) => v.trim());
    expect(sizes).toEqual(['var(--t-small)']);
    // And it resolves to the row's step and not to the micro one the `sm` cell wore.
    expect(box(cell())['font-size']).toBe('0.75rem');
  });

  // Asserted on the declarations that identified them rather than on an empty box: a `<button>` always
  // matches the type reset in design/reset.css, so its box is never empty and `toEqual([])` would be
  // a claim about that reset instead of about these classes.
  // `.vb-seg`, `.vb-seg-cell` and `.vb-seg-cell-sm` join the list: the three primitive names died with
  // the four surface ones, and a negative is what stops any of the seven creeping back.
  it.each([
    ['mode-group'],
    ['backend-toggle'],
    ['backend-toggle-md'],
    ['mode-btn'],
    ['bt-btn'],
    ['vb-seg'],
    ['vb-seg-cell'],
    ['vb-seg-cell-sm'],
  ])('.%s is gone', (cls) => {
    const b = box(label(cls, 'button'));
    expect(b.background).toBeUndefined();
    expect(b['border-right']).toBeUndefined();
    expect(b.overflow).toBeUndefined();
  });
});

describe('the archived row', () => {
  // `.archive-title` is the one list row Phase 4's `Panel flat` could not take, and the recorded reason
  // is that its container pads itself. Both halves pinned, because the migration has to move the padding
  // from one to the other without the row's height changing.
  // THE ASSERTION SURVIVED PHASE 11 AND THE FIXTURE DID NOT. The padding is `.vb-surface-inset`'s now —
  // and `var(--s-3) var(--s-4)` is `.archive-item`'s OWN value, which is why `inset` took it out of the
  // eight the ten nested boxes were written with. So the row's height did not move, and the claim this
  // pins — the container pads itself, so `.archive-title` inside it must not — is unchanged.
  it('an archived row pads itself', () => {
    const { container } = render(<Surface variant="inset" className="vb-row" />);
    const el = container.firstElementChild;
    if (!el) throw new Error('Panel rendered nothing');
    expect(box(el).padding).toBe('6px 8px');
  });

  // AND THE FIXTURE MOVED AGAIN IN PHASE 8, FOR THE SAME REASON THE ASSERTION DID NOT: the row's `flex: 1`,
  // its `min-width: 0`, its three overflow declarations and its `text-align: left` are `.vb-clip` — that
  // utility declaration for declaration — so the class list at the call site is what changed and what the
  // box draws is not. What `.archive-title` still says on its own is the UA button reset.
  it('.archive-title is a full-bleed borderless row inside it', () => {
    const b = box(label('archive-title vb-clip', 'button'));
    expect(b.border).toBe('none');
    expect(b.flex).toBe('1');
    expect(b['text-align']).toBe('left');
  });

  // IT DECLARED A `font-size` THAT ONLY RESTATED WHAT IT INHERITED — `var(--t-body)`, which `body` gives
  // it — so removing it took the class off the geometry ratchet with no rendering change at all. The same
  // dead declaration Phase 4 found on `.cv-link`. It is NOT a `Panel flat`: see the note in
  // docs/design-system.md, which measures that migration at zero classes saved.
  // The premise here was wrong first time and the code was right: the class names no size, and what the
  // button then gets is `inherit` from the type reset at the top of styles.css — which is exactly why
  // `OFF_SCALE_ON_PURPOSE` records `inherit` as on the scale BY CONSTRUCTION, with the chain terminating
  // at `body`. So the assertion is `inherit`, and it is a stronger claim than "undefined": it says the
  // reset is what answers, not the UA's 13.3333px.
  it('.archive-title names no size of its own; the reset hands it inherit', () => {
    expect(box(label('archive-title', 'button'))['font-size']).toBe('inherit');
    expect(box(document.body)['font-size']).toBe('0.8125rem');
  });
});
