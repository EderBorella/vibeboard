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
  const LABELS: [string, string][] = [
    ['cs-head', 'var(--muted)'],
    ['ap-drawer-head', 'var(--muted)'],
    ['control-group-head', 'var(--muted)'],
    ['links-group', 'var(--muted)'],
    ['settings-section', 'var(--accent)'],
    ['diary-kind', 'var(--text)'],
    ['filed-state', 'var(--text)'],
    ['tile-group', 'var(--accent-2)'],
    ['cv-group', 'var(--accent-2)'],
  ];

  it.each(LABELS)('.%s is uppercase', (cls) => {
    expect(box(label(cls))['text-transform']).toBe('uppercase');
  });

  it.each(LABELS)('.%s keeps its own ink, %s', (cls, ink) => {
    expect(box(label(cls)).color).toBe(ink);
  });

  // The two that name NO ink and inherit one. Merging them onto a primitive that names `--muted` would
  // be a visible change to whatever they sit in, so they are named here rather than assumed.
  it.each([['exec-head'], ['report-prompt-label']])('.%s names no ink of its own', (cls) => {
    expect(box(label(cls)).color).toBeUndefined();
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
    ['explorer-more', 'font-size'],
    ['cs-empty', 'font-size'],
  ])('.%s keeps only its %s', (cls, prop) => {
    const own = box(label(cls, 'p'));
    const shared = box(label('vb-text vb-text-quiet vb-text-lead', 'p'));
    // Everything it still declares beyond the primitive is positional or a size — never an ink or a face.
    const extra = Object.keys(own).filter((k) => own[k] !== shared[k]);
    expect(extra).toContain(prop);
    expect(extra).not.toContain('color');
    expect(extra).not.toContain('font-style');
  });

  it('the chat menu decides its own inset, and the line inside it decides nothing', () => {
    const el = at('<div class="chat-menu"><p class="vb-text vb-text-quiet">x</p></div>', 'p');
    expect(box(el).padding).toBe('8px');
  });

  // THE FOUR THAT ARE NOT IN THE FAMILY, each for a reason a person can see. Pinned so that "they are all
  // one thing" cannot quietly grow to cover them.
  it('.column-empty is a dashed drop target and not a line of prose', () => {
    expect(box(label('column-empty', 'p')).border).toBe('1px dashed var(--border)');
  });

  it.each([['empty'], ['control-blank']])('.%s is a margin:auto blank filling a pane', (cls) => {
    expect(box(label(cls, 'div')).margin).toBe('auto');
  });

  it('.diary-empty is a flex column, not a line', () => {
    expect(box(label('diary-empty', 'div')).display).toBe('flex');
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
    const lab = box(label('vb-trigger-label'));
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
  // `.vb-seg-cell` and `.vb-seg-cell-sm` declare 19, and the distinct sets are identical — nothing added,
  // nothing removed, nothing changed.
  it('the group owns the border and the corner', () => {
    const b = box(label('vb-seg', 'div'));
    expect(b.border).toBe('1px solid var(--border)');
    expect(b['border-radius']).toBe('6px');
    // The clip is what makes one box out of many cells, and without it the corners show through.
    expect(b.overflow).toBe('hidden');
  });

  // AND THE CELL OWNS NEITHER, which is the reason Phases 3 and 4 both refused to make these `Button`s:
  // every Button variant gives the cell its own border and radius, which puts a seam down the middle.
  it('a cell has no border and no corner of its own', () => {
    const b = box(label('vb-seg-cell', 'button'));
    expect(b.border).toBe('none');
    expect(b['border-radius']).toBeUndefined();
    expect(b['border-right']).toBe('1px solid var(--border)');
  });

  it('the last cell drops the divider', () => {
    expect(box(label('vb-seg-cell', 'button'), ':last-child')['border-right']).toBe('none');
  });

  it('the chosen cell is filled, not outlined', () => {
    const b = box(label('vb-seg-cell active', 'button'));
    expect(b.background).toBe('var(--accent-fill)');
    expect(b.color).toBe('var(--on-fill)');
  });

  // The `sm` step is the ONLY thing the four classes disagreed about, and `.backend-toggle-md .bt-btn`
  // is the file's own proof of that: it wrote `.mode-btn`'s two values out again.
  it('sm is the only difference between the two cells there ever was', () => {
    const md = box(label('vb-seg-cell', 'button'));
    const sm = box(label('vb-seg-cell vb-seg-cell-sm', 'button'));
    const moved = Object.keys(md).filter((k) => md[k] !== sm[k]);
    expect(moved.sort()).toEqual(['font-size', 'padding']);
  });

  // Asserted on the declarations that identified them rather than on an empty box: a `<button>` always
  // matches the type reset in design/reset.css, so its box is never empty and `toEqual([])` would be
  // a claim about that reset instead of about these classes.
  it.each([['mode-group'], ['backend-toggle'], ['backend-toggle-md'], ['mode-btn'], ['bt-btn']])(
    '.%s is gone',
    (cls) => {
      const b = box(label(cls, 'button'));
      expect(b.background).toBeUndefined();
      expect(b['border-right']).toBeUndefined();
      expect(b.overflow).toBeUndefined();
    },
  );
});

describe('the archived row', () => {
  // `.archive-title` is the one list row Phase 4's `Panel flat` could not take, and the recorded reason
  // is that its container pads itself. Both halves pinned, because the migration has to move the padding
  // from one to the other without the row's height changing.
  // THE ASSERTION SURVIVED PHASE 11 AND THE FIXTURE DID NOT. The padding is `.vb-surface-inset`'s now —
  // and `var(--s-3) var(--s-4)` is `.archive-item`'s OWN value, which is why `inset` took it out of the
  // eight the ten nested boxes were written with. So the row's height did not move, and the claim this
  // pins — the container pads itself, so `.archive-title` inside it must not — is unchanged.
  it('.archive-item pads itself', () => {
    const { container } = render(<Surface variant="inset" className="archive-item" />);
    const el = container.firstElementChild;
    if (!el) throw new Error('Panel rendered nothing');
    expect(box(el).padding).toBe('6px 8px');
  });

  it('.archive-title is a full-bleed borderless row inside it', () => {
    const b = box(label('archive-title', 'button'));
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
