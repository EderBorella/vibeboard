#!/usr/bin/env node
//
// SIX COVERAGE CENSUSES, ONE PER PRIMITIVE SHAPE — chip, panel, mono-fact, dot, segmented control and
// control — PLUS ONE NAMED LIST. Each census asks the single question `tools/check-radius-scale.mjs`
// asks of buttons: *how much of this shape is still hand-rolled?* The named list asks the question no
// census can — see THE BOX-LESS CHIPS below, which is the half of Phase 8 that a shape rule could never
// have found.
//
// WHY IT EXISTS. Part Two of docs/design-system.md opens with the reason, and it is a real miss rather
// than a hypothetical one: `check-radius-scale.mjs`'s claim 2 was the ONLY gate asking that question,
// and it only inspects button-shaped elements. So the remaining backlog of every other primitive was
// invisible to every check and to every review that trusted the checks — nine un-migrated chip classes
// were found by the owner looking at the board, after six phases in which every gate was green. Most of
// those nine are `<span>`s, which a button census cannot see by construction.
//
// A NUMBER NOBODY PRINTS IS A NUMBER NOBODY REDUCES. That is the whole of this file's job: Phases 8, 9
// and 10 each drive one of these counts, and a phase that reports its intention rather than its
// measurement is what this page exists to stop. Phase 8 drove the chip census from 10 to ZERO, which is
// what this instrument was built for and the first time one of these numbers has moved.
//
// A CENSUS RATCHETS UNTIL IT REACHES ZERO, AND THEN IT BLOCKS. Three backlogs are left — panel 10, mono
// 7 and control 2 — and a gate pointed at a backlog has to be bypassed on every commit, which teaches
// everyone to ignore it, so each of those prints its FULL list on a passing run and fails only on an
// increase. Chip, dot, segmented control, the control-geometry arm and the box-less list are AT ZERO and
// therefore block outright: the commit that reaches zero is the commit that sets the ceiling to zero.
// Never raise one. Phase 9 drove control 35 -> 2, and the two that are left are one component.
//
// FIVE CENSUSES READ THE STYLESHEETS AND ONE READS THE JSX, and that split is what makes them
// migration-proof — the Phase 3 defect this file was written not to repeat. That defect: the geometry
// ratchet read literal `<button>` only, so moving 27 classes onto `<Button>` took its population from 50
// to 23 and a planted `padding` exited 0. The count kept falling while the geometry moved out of sight.
//   - chip, panel, mono, dot and seg are detected in the CSS, by the declarations that DRAW the shape. A
//     shape can only be hand-rolled in one place, so moving the element onto `<Chip>`, `<Surface>` or
//     `<Readout>` cannot hide it: the rule is still there and still counted. Each finding names a call
//     site read out of the JSX — ANY tag, the primitive's own included — so the finding follows the class
//     onto the primitive rather than losing sight of it.
//   - control is detected in the JSX, because a raw `<input>` is not a class at all. Its population is
//     EVERY control in the tree and its finding count is the controls that get their box from neither a
//     `<Field>` nor `.vb-ctl`, both printed: migration moves a control from one to the other and leaves
//     the population where it was. A census whose population shrinks as the migration succeeds is the
//     Phase 3 defect wearing a new hat, and the coverage test is per-ELEMENT and not per-file for the same
//     reason — a file-level test would silence every remaining control in a file the moment one of them
//     was migrated. It has a SECOND ARM for the other direction, exactly as the chip census does; see
//     THE CONTROL CENSUS below.
//
// NO COUNT FLOORS, ANYWHERE. A floor on a number the sweep exists to reduce fails the run for SUCCEEDING
// and says "this check is vacuous" while doing it — that has now happened twice in this repository
// (`check-radius-scale.mjs`'s button population at 30 against 23, and its radius floor at 60 against 59).
// The anti-vacuity instrument here is `cssSelfTest`, `controlSelfTest`, `siteSelfTest` and
// `boxlessSelfTest` below, over fixtures the tree cannot move, and all four go through the census's OWN
// functions: a self-test that carries its own copy of the regex it is meant to test has no opinion about
// the code under test at all, which is what happened to the first one written in this repository.
//
// WHAT THESE CENSUSES DO NOT CATCH, stated so nobody mistakes a ratchet for a proof:
//   - A CHIP WITH NO BOX. A census reads the box — a small font-size, a pill-or-`--r-sm` corner and a
//     padding — so a chip that draws none is invisible to it, and four were: `.tile-suggestions` and
//     `.tile-problem` were a size, an ink and `white-space: nowrap`; `.tag-btn` was a cursor on `.tag`
//     and `.tag-chip-count` an opacity inside `.tag-chip`. Those four are why this census read 10 where
//     the owner's family list read 9. No shape rule can separate a state word from any other coloured
//     word "without becoming a list of names" — so BOXLESS_CHIPS below is that list of names, and it
//     covers those four and nothing else. A FIFTH one, under a name nobody adds there, is still
//     invisible: that limit is structural and is the reason the tones are also asserted in
//     test/chip-boxes.test.tsx, which resolves them per theme.
//   - A SHAPE BUILT BY MORE THAN ONE RULE. `.a { border-radius } .a { padding }` is two rules and each is
//     short of the pattern. Every shape in the tree today is declared in one rule.
//   - GEOMETRY FROM AN INLINE STYLE, or from a `style={{…}}` prop. Nothing in `web/src` draws one of
//     these six shapes that way, and a census over the stylesheets cannot see it if it did.
//   - A CONTROL THAT IS NOT A `<input>`/`<textarea>`/`<select>` literal — a control rendered by a
//     component of its own, or reached through a variable. `.vb-trigger` is the deliberate case: two
//     select triggers that are `<button>`s.
//   - WHETHER THE SHAPE IS RIGHT. It counts hand-rolled shapes, not wrong ones. Values are still the
//     type and radius checks' business.
//
// THE CENSUSES OVERLAP AND THAT IS NOT DOUBLE-COUNTING, because they answer per-shape questions and one
// rule can be two shapes: `.tag`, `.tag-chip`, `.mp-chip` and `.board-archive` were in both the chip and
// the panel census (a chip IS a small panel with a corner and a ground), and `.board-archive`, `.tag-chip`
// and `.tab-badge` were in the mono census too. Phase 8 taking the chips moved three numbers, which is
// why panel and mono fell to 28 and 11 without a panel or a readout being touched.
//
// A CENSUS AT ZERO IS STILL WORTH ITS LINES, which is the judgement Phase 7 made the other way and
// Phase 8 reverses on the evidence. Phase 7 left `Dot` and `SegmentedControl` ungated because "a census
// for zero is a gate blocking at zero with nothing to ratchet" — but the argument against that is the
// whole reason this file exists: the shape nobody counts is the shape that gets hand-rolled back in, and
// a coverage table with a hole in it is exactly what let nine chip classes accumulate unseen through six
// green phases. Both read ZERO today and both block an increase, so they are cheap insurance rather than
// a backlog: every one of the seven rows in the table in docs/design-system.md now has a gate.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classesOf, rulesOf, shapedRules } from './lib/css.mjs';
import { classesInTag, classSites as classSitesOf, openTagEnd, openTagsOf as tagsIn } from './lib/jsx.mjs';
import { codeOf, lineOf, walk as walkFiles } from './lib/source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = 'web/src';
// The primitive stylesheet: the ONE place any of these six shapes may be declared.
// THE PRIMITIVE LAYER, AND IT IS SEVEN SHEETS RATHER THAN ONE: the atom phase gave each of the six atoms
// its own file. LISTED AND NOT A DIRECTORY GLOB — `web/src/atoms/prose.css` sits in the same directory and
// is the markdown SURFACE, and a glob would have excused every declaration in it, including two of the
// mono census's own named survivors.
const ATOM_SHEETS = ['button', 'chip', 'control', 'readout', 'surface', 'text', 'stack'].map((name) =>
  join('web', 'src', 'atoms', `${name}.css`),
);
// FOURTEEN SHEETS AS OF THE MOLECULE LAYER, and `ui/primitives.css` is not one of them because it is
// gone: what was left of it WAS this layer — the tone table, the pip, the status chip, the segmented
// control, the field and its trigger, the notice — and it is seven files beside the six atoms now.
// LISTED AND NOT A DIRECTORY GLOB for the reason above, and now twice over: `molecules/inline-field.css`
// and `molecules/popover.css` hold SURFACE rules (the card view's editable face, the panel that floats),
// and both are findings this census is supposed to keep counting — `.inline-view` and `.popover` are two
// of the five panels left.
const MOLECULE_SHEETS = ['tones', 'status-chip', 'tabs', 'menu', 'field', 'notice', 'figure-row'].map(
  (name) => join('web', 'src', 'molecules', `${name}.css`),
);
const PRIMITIVE_LAYER = [...ATOM_SHEETS, ...MOLECULE_SHEETS];

// ---------------------------------------------------------------------------------------------------
// THE CEILINGS. Each is what the tree holds today, measured by this file on 2026-08-21, and each is the
// number the phase named beside it has to drive down. NEVER raise one: a ratchet that moves the wrong way
// is a gate switched off in place.

// CHIP — ZERO, and it was 10 when Phase 7 wrote this census. Phase 8 migrated all ten: nine onto `Chip`
// and one — `.markdown code` — exempted BY NAME with its reason in CHIP_EXEMPT below. So this census is
// the one that stopped being a ratchet and became a gate blocking at zero, which is what this page asks
// of a count that has reached it.
// ARM 2 IS THE HALF THAT MATTERS NOW. Arm 1 is empty because there is nothing left to migrate; arm 2 —
// a surface class ON a `<Chip>` that decides a corner, a padding or a size — is the half that goes up
// the moment a chip is migrated carelessly, and Phase 8 put fourteen classes within its reach where
// there were eleven. `.report-chip`, `.ap-chip`, `.tag`, `.tile-setup` and the rest decide a face, an
// ink and a ground, which is the caller's to decide; not one decides the box.
const CHIP_CEILING = 0;
// PANEL — 32 as Phase 7 measured it, 28 after Phase 8, 20 after Phase 9, **10 after Phase 11**, which is
// the phase that finally owned the row. Phase 8's four were chips; Phase 9's eight were controls; Phase
// 11's ten split in two — three raised surfaces (`.modal`, `.mp-modal`, `.chat-menu`) that were
// `raised`'s own trio, and seven nested boxes that became Panel's third variant, `inset`, plus
// `.copilot-actions button`, which was `Button` `default` `sm` written out by hand.
// **5 AFTER THE MOLECULE LAYER**, and the five that went are all one phase's work. FOUR WERE TABS —
// `.tab-btn`, `.dock-tab`, `.cards-tab` and `.control-tabs button` each drew a 1px box with a corner and
// a ground, which is what made them read as panels to this census and as buttons to
// `check-radius-scale.mjs` at the same time. They are `Tabs` and `Menu` cells, in the primitive layer,
// and the refusal recorded here against four candidates is reversed in docs/design-system.md, *The atomic
// revamp: `Tabs` and `Menu` overturn a twice-taken refusal*. THE FIFTH is
// `.inline-edit`: `Field inline` renders a `<Control>` now, so the border, the corner and the ground it
// declared are the atom's and what is left is an accent EDGE.
// THE FIVE THAT REMAIN each have a reason and none of them is "it has its own padding": `.popover` and
// `.gate-card` are documents whose adjacent vertical margins collapse, which `raised`'s flex column would
// stop; `.markdown pre` has no element to put a primitive on; `.msg-assistant` has four corners and a
// tail; and `.inline-view` is the read-only half of one control in two states, which must share one box
// with the editor above and therefore cannot be a `Surface`. NEVER RAISE IT.
// THREE, AND IT WAS FIVE. `.gate-card` left in the reinvention sweep — it was hand-drawing a `--panel`
// ground, a `--border` edge and a `--r-lg` corner, which is `Surface variant="raised"` value for value, so
// both call sites render the primitive and the class kept only its 520px measure and its inset. The
// ratchet comes down in the commit that vacates it, which is the half of this repository's own rule that
// usually gets forgotten.
const PANEL_CEILING = 3;
// MONO — 14 as Phase 7 measured it, 11 after Phase 8's three chips, and **7 after Phase 12**, which is
// the phase that owned the row. Three went to the primitive: `.report-chip` names `vb-readout` on its
// `<Chip>` (the form Phase 8 established), `.msg-tool` IS `Readout` `small` `accent` and its rule is
// gone, and every `<dd>` in a report's meta list is a `Readout` `plain`. Two more merged: `.gate-preview
// code` and `.ap-help-body code` declared the same three things under two names and are one rule.
// SEVEN BECAME THREE IN THE ATOM PHASE, and the four that went were all the same row: a control a person
// types machine text into. `.raw-area` (a card's file), `.control-textarea` (a config file), `.skill-editor
// textarea` (a prompt) and `.confirm-require` (the exact string the machine demands back) each declared
// `font-family: var(--font-mono)` on their own class, because the ruling that a control cannot be a
// `Readout` — a Readout is a `<span>` — left them nowhere else to say it. `Control` has a `mono` option
// now, inside the primitive layer, which is where a face said four times belongs.
// THE THREE THAT REMAIN are quoted machine text rather than a control: `.markdown code` and the merged
// `.gate-preview code, .ap-help-body code` pair (inline code in prose) and `.signin-label` (a browser's
// User-Agent). Each reason is written at its own rule. NEVER RAISE IT.
const MONO_CEILING = 3;
// DOT — ZERO, and it is zero because Phase 8 took the one. `.copilot-status .status-dot` was the last
// `border-radius: 50%` outside the primitive stylesheet — named in `check-radius-scale.mjs`'s
// OFF_SCALE_ON_PURPOSE as the Dot's one remaining hand-rolled instance since Phase 3 — and it is a `Dot`
// now. Blocking at zero, which is what a census at zero is for.
const DOT_CEILING = 0;
// SEGMENTED CONTROL — FOLDED INTO THE TAB ARM AND NO LONGER ITS OWN ROW, which is the molecule layer's
// doing and is stated here rather than left as a dead 0/0. `SegmentedControl` is `Tabs grouped`: a group
// that draws one border and clips its cells IS a tab strip with the corners taken off, so a rule shaped
// like one is an un-migrated `Tabs` and belongs in the census that says so. `segFault` is unchanged and
// still runs — see TAB_ARM below, which counts its findings alongside the JSX ones.

// THE ONE EXEMPTION, BY NAME AND WITH ITS REASON ON IT — the form `check-radius-scale.mjs`'s
// OFF_SCALE_ON_PURPOSE established, for the same argument: a shape that is deliberately not the
// primitive's has to be stated where the census is, or the next person reads a ratchet of 1 as a
// backlog of 1 and migrates it. Keyed on the whole selector, so `.markdown pre code` is not excused by
// it and neither is anything else that happens to contain the word.
const CHIP_EXEMPT = new Map([
  [
    '.markdown code',
    'AN INLINE CODE SPAN IN RENDERED PROSE, NOT A CHIP. It means "this is code", it sits mid-sentence ' +
      'inside a paragraph, and it is not a discrete labelled thing — a chip is a noun you could point ' +
      "at. Making it a `Chip` would put an inline-flex box with a chip's gap into running text.",
  ],
]);
// THE CONTROL CENSUS, AND ITS RULE CHANGED IN PHASE 9 — read this before quoting either number.
//
// It was 35 of 42: a literal control whose nearest enclosing `<Field>` region does not contain it. That
// asked a narrower question than the one this file exists to ask. The question is *how much of this shape
// is still hand-rolled?*, and the primitive layer answers it in two ways on purpose — the sentence is
// beside `.vb-ctl` and it names its own three cases: "`.vb-ctl` is the same box for a control that is
// not inside a Field — an inline rename, a model search, a typed confirmation." A control wearing
// `.vb-ctl` has the primitive's box; counting it as hand-rolled is the same category error as counting
// `.vb-trigger`, which this file's header already excludes by name.
//
// SO ARM 1 IS NOW "gets its box from NEITHER a `<Field>` NOR `.vb-ctl`", and ARM 2 IS WHAT KEEPS THAT
// FROM BEING A LOOPHOLE: a class ON a literal control may not decide the box. Without arm 2, widening
// arm 1 would let `<input className="vb-ctl my-own-box">` through, which is precisely the hole Phase 3
// drove a bus through when 27 classes moved onto `<Button>`. Arm 2 is the chip census's second arm one
// primitive along, and it is the stricter half: it refuses a border, a corner, a padding or a size on any
// surface class that lands on an `<input>`, `<textarea>` or `<select>`.
//
// IT WAS 2, AND BOTH TWOS WERE `molecules/Field.tsx` — ruled out of `Field`'s scope BY NAME on the ground
// that a commit-on-blur editor is one control in two states that must share one padding, and no primitive
// owned that box. **IT IS ZERO NOW AND IT BLOCKS**, because the atom layer answered the objection rather
// than the census being relaxed: `InlineField` is `Field inline` and its two literal controls are
// `<Control>`s, so the box arrives with the element. What `.inline-edit` still declares is an accent EDGE
// and the type of the prose it sits in, neither of which is the box.
// A `<Control>` IS NOT COUNTED BY ARM 1 BY CONSTRUCTION — it HAS the box — so this reaching zero is a
// claim about literal `<input>`, `<select>` and `<textarea>` tags: every one of them in the tree is inside
// a `<Field>` or wears `.vb-ctl`. Phase 9 migrated 15 onto `<Field>` and put 18 on `.vb-ctl`.
const CONTROL_CEILING = 0;
// ARM 2's own ceiling is ZERO, and it blocks: no surface class in the tree decides a control's box. The
// first draft of this constant was 2, for `.inline-edit`'s border/corner/padding and
// `.cv-title.inline-edit`'s size — and neither is reachable, which is a LIMIT worth stating rather than a
// ceiling worth padding. `InlineField` builds one `common` object and spreads it, so `className:
// 'inline-edit'` never appears in a `className=` attribute and the reader arm 2 shares with the chip
// census cannot see it. That is the blind spot this file already names — "a class reaching a `<Chip>`
// through a variable or a ternary that names no literal" — one primitive along, and those two controls are
// counted by arm 1 regardless, which is why the pair is covered rather than lost.
const CONTROL_GEOMETRY_CEILING = 0;

const CHIP_FONT = ['var(--t-micro)', 'var(--t-small)'];
// A chip's corner, and the primitive's own two: `--r-sm` square-ish, `--r-pill` for a state word or a
// tag. `--r-md` is a button's and a panel's corner, which is what kept `.tab-btn` and `.dock-tab` out of a
// census they were not in the family of. Both are `Tabs`/`Menu` cells now and the point still stands: a
// tab wears a button's corner, so this discriminator is what stops the tab arm and the chip arm colliding.
const CHIP_RADIUS = ['var(--r-pill)', 'var(--r-sm)'];
// THE LITERAL ELEMENTS, for arm 1: is this control's box the primitive's? `<Control>` is not here, because
// a `<Control>` HAS the box by construction and counting it would make arm 1's backlog unreadable.
const CONTROL_TAGS = ['input', 'textarea', 'select'];
// ARM 2 READS `<Control` AS WELL, and it was forced rather than chosen — it is the `<Button className>`
// hole of Phase 3 one primitive along. Arm 2 asks whether a SURFACE class on a control decides the box,
// and migrating 34 literal controls onto `<Control className="raw-area">` moved every one of those classes
// out of a reader that only knew `<input`/`<select`/`<textarea>`. A `padding` planted on `.raw-area` after
// the migration would have exited 0.
const CONTROL_COMPONENT = '<Control';
// The class primitives.css gives a control that has no label to put in a `<Field>`. ONE CONSTANT AND NOT
// A STRING AT THREE CALL SITES, for the reason CHIP_TAG is one: a self-test that carries its own copy of
// the value it is meant to test has no opinion about the code under test.
const CONTROL_BOX_CLASS = 'vb-ctl';
// ONE CONSTANT AND NOT A STRING AT TWO CALL SITES, and a planted defect is what says so: with the tag
// written literally at both the run's call and the self-test's, breaking the run's copy to `'<ChipX'` took
// arm 2 blind and the run still exited 0 — the self-test was asserting its own argument. That is the same
// failure as a self-test carrying its own regex, one level along.
const CHIP_TAG = '<Chip';
const TAB_TAG = '<Tabs';
const MENU_TAG = '<Menu';

// ---------------------------------------------------------------------------------------------------
// THE TWO NEW ARMS — one per component, and TWO rather than one because the components are two.
//
// Six things in this app were a row or list of mutually-exclusive cells: the five top destinations, the
// chat session list, the dock's panes, the open cards, the editor's three views and the two value
// pickers. Nineteen classes, six faces, six selected states and six heights. They are `Tabs` and `Menu`
// now, and the LINE BETWEEN THEM is the reason a census that accepted either would be the wrong
// instrument: `Tabs` switch what you are LOOKING AT and the surface stays; a `Menu` takes you SOMEWHERE
// ELSE. An arm that took either would not notice a navigation row hand-rolled as tabs, which is the shape
// the atomic revamp's two-component answer exists to separate — docs/design-system.md, *The atomic
// revamp: `Tabs` and `Menu` overturn a twice-taken refusal*.
//
// THE DISCRIMINATOR IS ARIA AND NOT A CLASS NAME, and that is a decision worth stating because the
// obvious alternative was measured and rejected. The obvious signal is the SELECTION WORD: a `className`
// that conditionally adds `active` to a `<button>`. Six sites in the tree still do exactly that and NONE
// of them is a tab or a menu — the copilot toggle (`.switch-btn`), the tag filter's chips (which are
// MULTI-select, so not mutually exclusive at all), the board's archive toggle, and three list rows the
// organism phase owns as `Row`. An arm built on `active` would therefore point at a backlog it cannot
// clear, which is the one thing this file's own header refuses.
// `aria-selected` and `role="tab"` mean "one of a mutually-exclusive set of VIEWS"; `role="menuitem"` and
// `aria-current` mean "one of a set of DESTINATIONS, and this is where you are". Those are the assertions
// a hand-rolled cell has to make to be usable at all, and every one of the six families made one of them
// before this phase: the dock and the cards wrote `role="tab"` and `aria-selected`, the chat menu wrote
// `role="menu"`. So the population is real rather than hypothetical, and both arms reach ZERO.
//
// BOTH ARMS ARE BANS ON ARIA TEXT AND NOT CENSUSES OF SHAPE, and the inversion that follows has to be
// stated rather than left for a reader to discover: a surface that hand-rolls a tab row WITHOUT
// accessibility passes here, and one that hand-rolls the same row WITH accessibility fails. That is the
// right way round for the population these arms exist for — every one of the six families wrote a role or
// an aria attribute, because those are the assertions a cell has to make to be usable at all — but it
// means a clean run is evidence about ARIA and not about geometry.
//
// WHAT IT DOES NOT CATCH, MEASURED BY PLANTING IT RATHER THAN REASONED ABOUT. Three holes, all open:
//   1. A row of buttons with NO role and NO aria at all. The plan's own named plant for this arm —
//      `<div><button className="active">A</button><button>B</button></div>` — is exactly that shape, and it
//      was planted verbatim on a surface and exited 0 here AND on all ten gates. There is no property of
//      such a row that distinguishes it from six legitimate toggles in this tree (the copilot toggle, the
//      tag filter's multi-select chips, the board's archive toggle and three list rows), and a class-name
//      rule would report all six. The plan-named plant is dead: do not record this arm as proved by it.
//   2. THE FALLBACK ARGUMENT IS ONLY HALF TRUE. It used to read: the cell needs a box, and
//      `check-radius-scale.mjs`'s button-geometry ratchet is at 1/1, so the padding and the step cannot be
//      declared anywhere. True of the CLASS spelling — a hand-rolled cell given a box by a class exits 1 on
//      both radius-scale and class-budget, planted and confirmed. FALSE of the INLINE-STYLE spelling: a
//      complete hand-rolled tablist with correct ARIA through `role={'tab'}`, its own 28px box, padding,
//      radius and selected state, all in a `style={{…}}` object, passed radius-scale, box-scale,
//      class-budget, shape-coverage, scale and name-resolution — six gates and both selection arms.
//      Nothing in this tree reads inline styles. A NAMED LIMITATION and not an instrument to invent here.
//   3. Only the TAB arm's owner exclusion is asserted by the self-test (`markFaults(…, 'fixture.tsx')`
//      above). The menu arm's is the same function with a different array, so it is left unasserted
//      deliberately rather than by oversight — said here so the asymmetry is not read as a gap.
const TAB_OWNER = join('web', 'src', 'molecules', 'Tabs.tsx');
const MENU_OWNER = join('web', 'src', 'molecules', 'Menu.tsx');
// REGEXES AND NOT LITERALS, AND THE REASON IS THAT THE LITERALS COULD NOT SEE THEIR OWN OWNERS. A raw
// `String.indexOf('role="tab"')` is quote-bound on BOTH sides of the attribute, so it is evaded by the JSX
// expression spelling — which is exactly what `Tabs.tsx:86` (`role={grouped ? undefined : 'tab'}`) and
// `Menu.tsx:69` (`role={list ? 'menuitem' : undefined}`) write. A hand-rolled row copied from either owner
// therefore passed both arms. Planted and confirmed: the two owners' own idiom exited 0 on both arms; it
// exits 1 now, and rows 10-13 of `MARK_FIXTURE` are what stop the hole reopening.
// THE CLOSING QUOTE IS STILL THE GUARD, moved from the attribute text to the quoted VALUE: `'tabpanel'` is
// not `'tab'` and `'menubar'` is not `'menu'`, which rows 4 and 9 of the fixture assert. `[^>]` is what
// keeps a match inside one tag.
const TAB_MARKS = [
  /role\s*=\s*[^>]{0,60}?['"]tablist['"]/,
  /role\s*=\s*[^>]{0,60}?['"]tab['"]/,
  /aria-selected/,
];
const MENU_MARKS = [
  /role\s*=\s*[^>]{0,60}?['"]menuitem['"]/,
  /role\s*=\s*[^>]{0,60}?['"]menu['"]/,
  /aria-current/,
];
const TAB_CEILING = 0;
const MENU_CEILING = 0;

// Every mark in one file, with its line. Reads `codeOf` output for the reason arm 1 of the control census
// had to: this very file's header names `role="tab"` in prose four times, and a raw read would have
// counted every one of them as a hand-rolled tab.
function markFaults(sources, marks, owner) {
  const findings = [];
  for (const { file, code } of sources) {
    if (file === owner) continue;
    for (const mark of marks) {
      // A FRESH `g` COPY PER FILE PER MARK. A shared `lastIndex` on a literal in the array above would
      // carry over between files and skip whole matches — the defect is silent and looks like a clean run.
      // The finding prints the MATCHED TEXT rather than the pattern, so a report names the spelling it found.
      for (const m of code.matchAll(new RegExp(mark.source, 'g'))) {
        findings.push(`${file}:${lineOf(code, m.index)} ${m[0]} — a cell of a mutually-exclusive set`);
      }
    }
  }
  return findings.sort();
}
// What a census counts as adoption, printed beside its backlog so the ratio is visible on every run.
const ADOPTION = [
  { shape: 'chip', tags: [CHIP_TAG] },
  { shape: 'panel', tags: ['<Surface'] },
  { shape: 'mono', tags: ['<Readout', '<FigureRow'] },
  // `<Dot` IS GONE AND THE PIP IS NOT A COMPONENT ANY MORE: it had three sizes and exactly one consumer,
  // which is `StatusChip`, so the census counts that consumer instead. A hand-rolled circle is still a
  // finding — `dotFault` is unchanged.
  { shape: 'dot', tags: ['<StatusChip'] },
  { shape: 'tab', tags: [TAB_TAG] },
  { shape: 'menu', tags: [MENU_TAG] },
  { shape: 'control', tags: ['<Field', CONTROL_COMPONENT] },
  { shape: 'control-geometry', tags: ['<Field', CONTROL_COMPONENT] },
  { shape: 'boxless-chip', tags: [CHIP_TAG] },
];

// `tools/lib/` owns the parsers: `source.mjs` the walk, the line counter and the comment blanker,
// `css.mjs` the rule scanner (including the selector-cursor reset this file's Phase 7 self-test
// forced), `jsx.mjs` the opening-tag reader. One copy each — three copies is how that reset came to
// exist here and not in `check-radius-scale.mjs`.
// A SMOKE ALARM, NOT A TARGET: two css files and a hundred components, floored an order of magnitude
// below each so deleting a file never fails the run. See walk() in lib/source.mjs for why it is here.
const FLOOR = { '.css': 2, '.ts': 10, '.tsx': 20 };
const walk = (ext) => walkFiles(ROOT, CORPUS, ext, FLOOR[ext] ?? 1);

// One declaration's value, or null. Anchored on a boundary so `border` does not match `border-radius`
// and `background` does not match `background-clip`.
const declValue = (body, prop) =>
  new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`).exec(body)?.[1]?.trim() ?? null;

const declares = (body, prop) => new RegExp(`(?:^|[;{\\s])${prop}\\s*:`).test(body);
const declaresAny = (body, props) => props.some((prop) => declares(body, prop));

const PADDING = ['padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left'];
const GROUND = ['background', 'background-color'];
// What a class rendered on the primitive's own tag may NOT decide, and it is the same list
// `check-radius-scale.mjs` refuses a button: the box is the primitive's, the layout is the caller's.
// `height` AND `min-height` JOINED THIS LIST IN THE ATOM PHASE, and the census did not move: the box a
// chip draws is 16px everywhere as of `--mark-h`, and no surface class declares one.
const CHIP_GEOMETRY = ['border-radius', ...PADDING, 'font-size', 'height', 'min-height'];

// Every `<tag …>` across the corpus, with its site, its attribute text and its class literals. The tag
// scan itself — including the `(?![\w-])` that stops `<Chip` matching `<ChipRow` — is `openTagsOf` in
// tools/lib/jsx.mjs.
// ONE READER FOR BOTH THINGS THAT ASK ABOUT A `<Chip>`: arm 2 wants the class set, and the box-less
// check below wants the attribute text as well. Two readers would be two things to break, and the one
// that broke would be the one nobody planted at.
function tagsAcross(sources, tag) {
  return sources.flatMap(({ file, code }) =>
    tagsIn(code, tag).map(({ attrs, line }) => ({
      site: `${file}:${line}`,
      attrs,
      classes: classesInTag(attrs),
    })),
  );
}

function tagClasses(sources, tag) {
  return new Set(tagsAcross(sources, tag).flatMap((open) => open.classes));
}

// ---------- the three CSS shapes, one predicate each ----------
// A CHIP is the primitive's own declaration set written by hand: a small font-size, a chip's corner and
// a padding. See `.vb-chip` in atoms/chip.css, which says exactly those three things.
function chipFault(rule) {
  if (CHIP_EXEMPT.has(rule.selector)) return null;
  if (!CHIP_FONT.includes(declValue(rule.body, 'font-size'))) return null;
  if (!CHIP_RADIUS.includes(declValue(rule.body, 'border-radius'))) return null;
  if (!declaresAny(rule.body, PADDING)) return null;
  return `a chip's box — ${declValue(rule.body, 'font-size')}, ${declValue(rule.body, 'border-radius')}, a padding`;
}

// A PANEL is a drawn box: a 1px border, a corner and a ground, together. The owner's rule, adopted
// unchanged because it reproduces his 32 exactly. `border-width: 1px` counts as well as the shorthand,
// so a rule that splits them is not a hole.
function panelFault(rule) {
  const border = declValue(rule.body, 'border') ?? declValue(rule.body, 'border-width');
  if (border === null || !/(?:^|\s)1px(?:\s|$)/.test(border)) return null;
  if (!declares(rule.body, 'border-radius')) return null;
  if (!declaresAny(rule.body, GROUND)) return null;
  return 'a drawn box — border 1px, a border-radius and a background';
}

// A MONO FACT is `font-family: var(--font-mono)` outside the primitive that owns the signature. The
// claim the Readout makes is that a monospaced face MEANS the machine measured it, so every hand-rolled
// one is either a fact that should be a `Readout` or a deliberate exception — and the point of the census
// is that today nobody can tell which without reading fourteen rules.
function monoFault(rule) {
  return /font-family\s*:\s*var\(--font-mono\)/.test(rule.body) ? 'font-family: var(--font-mono)' : null;
}

// A DOT is a `50%` corner, and nothing else needs saying: `--r-pill`'s 999px is a claim about a stadium,
// so a circle is the ONE shape in this stylesheet that legitimately declares a raw value — which is why
// `check-radius-scale.mjs` carries `50%` in OFF_SCALE_ON_PURPOSE and named the Dot as its owner. The
// sizes are separate classes on the primitive, so requiring a width here would miss a dot that inherited
// one; the corner is what makes it a circle at all.
function dotFault(rule) {
  return declValue(rule.body, 'border-radius') === '50%' ? 'a circle — border-radius: 50%' : null;
}

// A SEGMENTED GROUP is a flex box that draws ONE 1px border and ONE corner and CLIPS what is inside it,
// and the ground is its cells' rather than its own. That last clause is the discriminator and it is
// measured rather than tidy: without it `.mp-modal` — a flex column with a border, a `--r-lg` corner and
// `overflow: hidden` — is reported as a segmented control, which is a false finding on a modal. A group
// with no ground of its own is the primitive's own statement (`.vb-seg` declares no background) and it is
// what makes the cells' fill reach the group's edge.
function segFault(rule) {
  const border = declValue(rule.body, 'border') ?? declValue(rule.body, 'border-width');
  if (border === null || !/(?:^|\s)1px(?:\s|$)/.test(border)) return null;
  if (!declares(rule.body, 'border-radius')) return null;
  if (!/^(inline-)?flex$/.test(declValue(rule.body, 'display') ?? '')) return null;
  if (declValue(rule.body, 'overflow') !== 'hidden') return null;
  if (declaresAny(rule.body, GROUND)) return null;
  return 'a clipped group — flex, border 1px, a border-radius, overflow: hidden and no ground of its own';
}

// THE CHIP CENSUS'S SECOND ARM, AND IT IS THE PHASE 3 HOLE CLOSED BEFORE IT COSTS ANYTHING. Arm 1 finds
// a chip nobody has migrated. This finds the other half: a class that IS on a `<Chip>` and still decides
// the box — a padding, a corner or a size of its own. Without it the census would fall as chips migrated
// while their geometry moved onto the primitive's tag, which is precisely what happened to the button
// ratchet when 27 classes went to `<Button>` and a planted `padding` on `.cs-action` exited 0.
//
// IT IS NOT THE SAME ARM `<Surface>` WOULD WANT, and that asymmetry is measured rather than tidy: a `Surface`
// is usually a `<div>` and `raised` deliberately has no padding, so `.archive-drawer`, `.exec-column` and
// `.halt` pad themselves correctly — counting every `<Surface className>` would report three right answers
// as faults, which Phase 4 established. A `Chip` always draws its own box, so a surface has no such claim.
function chipGeometryFault(rule, onChip) {
  if (!classesOf(rule.selector).some((cls) => onChip.has(cls))) return null;
  const decided = CHIP_GEOMETRY.filter((prop) => declares(rule.body, prop));
  return decided.length > 0 ? `geometry on a <Chip> — ${decided.join(', ')}` : null;
}

const censuses = (onChip) => [
  {
    shape: 'chip',
    ceiling: CHIP_CEILING,
    fault: (rule) => chipFault(rule) ?? chipGeometryFault(rule, onChip),
    phase: 'Phase 8',
  },
  { shape: 'panel', ceiling: PANEL_CEILING, fault: panelFault, phase: 'Phase 11' },
  { shape: 'mono', ceiling: MONO_CEILING, fault: monoFault, phase: 'unassigned' },
  { shape: 'dot', ceiling: DOT_CEILING, fault: dotFault, phase: 'at zero — blocking' },
];

function censusOf(ruleList, fault) {
  const findings = [];
  for (const rule of ruleList) {
    const detail = fault(rule);
    if (detail !== null)
      findings.push({ site: `${rule.file}:${rule.line}`, selector: rule.selector, detail });
  }
  return findings;
}

// ---------- the box-less chips, which no shape rule can ever find ----------
// FOUR CLASSES THAT ARE CHIPS BY MEANING AND DECLARE NO BOX, and this check exists because the original
// miss was invisible for exactly that reason. Every census above reads a DRAWN box — a corner, a padding,
// a border, a ground — and these four drew none: `.tile-suggestions` and `.tile-problem` were a size, an
// ink and a `white-space: nowrap`; `.tag-btn` was a cursor and two `inherit`s on a box declared by
// `.tag`; `.tag-chip-count` was an opacity inside `.tag-chip`. Phase 7 stated that as a known gap and
// said no shape rule could close it "without becoming a list of names". THIS IS THE LIST OF NAMES, and
// naming them is the only instrument available: the alternative is that the next person renders a
// coloured `<span>` where a chip belongs and nothing whatever notices, which is what happened.
//
// TWO CLAIMS PER NAME, and the second is the one that protects the tones.
//   1. The class is GONE, or every `<Chip>` in the tree carries it. A plain `<span className="tile-problem">`
//      fails, which is the regression this exists for.
//   2. The `<Chip>` carrying it names a `tone`. A tone is the whole meaning of three of these four — a
//      setup barrier, work left behind, and a real failure are three different facts and must not read
//      alike — and a `tone` prop dropped in a refactor is a silent collapse to the default ink. The
//      COLOURS are measured per theme in test/chip-boxes.test.tsx; this half only asserts that the
//      distinction is still being asked for at the call site, which is where it would be lost.
//
// WHAT IT DOES NOT CATCH, and the limit is real rather than a caveat: a FIFTH box-less chip, under a name
// nobody has added here. No rule over declarations can see one, because a state word with an ink and no
// box is indistinguishable from any other coloured word — that is Phase 7's finding and it still stands.
// It also cannot see a class that reaches a `<Chip>` through a variable or a ternary that names no
// literal, and it has no opinion about whether the tone chosen is the RIGHT one.
const BOXLESS_CHIPS = ['tile-suggestions', 'tile-problem', 'tag-btn', 'tag-chip-count'];

function boxlessFaults(names, chipTagList, named) {
  const findings = [];
  for (const cls of names) {
    const carried = chipTagList.filter((open) => open.classes.includes(cls));
    if (carried.length === 0) {
      // Gone is a pass. Named anywhere else is not: that is a box-less chip rendered as something else.
      if (named.has(cls)) findings.push(`.${cls} — named at ${named.get(cls)} and not on a <Chip>`);
      continue;
    }
    for (const open of carried)
      if (!/\stone=/.test(open.attrs)) findings.push(`.${cls} — on a <Chip> with no tone at ${open.site}`);
  }
  return findings;
}

// ---------- the control census, which reads the JSX ----------
// The regions between a `<Field` and its `</Field>`, depth-counted so a nested Field cannot end its
// parent's region. `(?![\w-])` is what keeps `<InlineField` and `<Fieldset` from opening one — the same
// guard `check-radius-scale.mjs`'s `openTagsOf` needs to stop `<Button` matching `<ButtonRow>`.
function fieldRanges(text) {
  const events = [
    ...[...text.matchAll(/<Field(?![\w-])/g)].map((m) => ({ at: m.index, open: true })),
    ...[...text.matchAll(/<\/Field\s*>/g)].map((m) => ({ at: m.index, open: false })),
  ].sort((a, b) => a.at - b.at);
  const ranges = [];
  const stack = [];
  for (const event of events) {
    if (event.open) stack.push(event.at);
    else {
      const start = stack.pop();
      if (start !== undefined) ranges.push([start, event.at]);
    }
  }
  return ranges;
}

// Every literal control tag in one file, each marked with where its box comes from and with the classes
// it carries. PER ELEMENT and never per file: a file-level test would stop counting a file's remaining
// controls the moment one of them was migrated, which is the Phase 3 blindness exactly.
// Sorted by LINE as a number, not by the `file:line` string: a string sort puts line 105 before line 93,
// and a census nobody can read down a file is a census nobody reads.
function controlsIn(file, text) {
  const ranges = fieldRanges(text);
  const found = CONTROL_TAGS.flatMap((tag) =>
    [...text.matchAll(new RegExp(`<${tag}(?![\\w-])`, 'g'))].map((m) => {
      const end = openTagEnd(text, m.index + tag.length);
      // A tag whose `>` cannot be found is read as carrying no classes rather than skipped: an
      // unparseable control must stay a finding, not vanish from the population.
      const classes = end < 0 ? [] : classesInTag(text.slice(m.index, end));
      const inField = ranges.some(([from, to]) => m.index > from && m.index < to);
      return {
        line: lineOf(text, m.index),
        site: `${file}:${lineOf(text, m.index)}`,
        tag,
        classes,
        inField,
        // THE `<Field>` EXCUSE IS WITHDRAWN, and the reason is the same one this file already gives for
        // `.inline-edit`: the atom layer answered the objection rather than the census being relaxed.
        // A literal control inside a `<Field>` was excused because the Field owned the LAYOUT and no
        // primitive owned a CHECKBOX — a tick has an intrinsic box the browser draws, and `.vb-ctl`'s
        // 28px height and horizontal padding stretch it into a slab. So six surfaces wrote
        // `<input type="checkbox">` inside a `<Field>` and this arm was right not to blame them.
        // `Control` takes the type now and withdraws the box (`.vb-ctl[data-kind='check']`), so there is
        // nowhere left in the tree that a literal control is the honest answer. THE ONLY ROUTE IS
        // `.vb-ctl`, which means the element is a `<Control>`: the atom is what puts that class on.
        // `inField` is still MEASURED and still printed, because which of the two a finding is tells the
        // reader whether it needs a `<Field>` around it or just the atom.
        boxed: classes.includes(CONTROL_BOX_CLASS),
        where: classes.includes(CONTROL_BOX_CLASS)
          ? `.${CONTROL_BOX_CLASS}`
          : inField
            ? '<Field>, which is no longer an excuse'
            : 'nothing',
      };
    }),
  );
  return found.sort((a, b) => a.line - b.line);
}

// ARM 2. A surface class that lands on a literal control may not decide the box — the same claim
// `chipGeometryFault` makes about a `<Chip>` and `check-radius-scale.mjs` about a `<button>`, and it is
// what stops arm 1's `.vb-ctl` clause becoming a licence: `<input className="vb-ctl my-own-box">`
// would otherwise pass arm 1 while the geometry moved out of sight, which is the Phase 3 defect exactly.
// `font-family` and `color` are NOT here: a monospaced editor body and a muted secondary select are the
// surface's to decide, and `.control-textarea` and `.archive-column` are both correct designs.
// `height` JOINS THIS LIST AND `min-height` DELIBERATELY DOES NOT, and the split is measured rather than
// convenient: a control's HEIGHT is `--ctl-h` and nothing else may say otherwise, but how much room a
// TEXTAREA starts with is genuinely the surface's — a card's whole file wants fourteen rems and a diary
// box wants two and a half, and atoms/control.css withdraws the fixed height for `textarea` precisely so
// they can. Those two floors are the `rem` rows `check-box-scale.mjs` names by hand with that reason;
// putting `min-height` here would report both correct designs as faults against a ceiling of zero, which
// is how a gate earns the reputation that gets it switched off.
const CONTROL_GEOMETRY = ['border', 'border-width', 'border-radius', ...PADDING, 'font-size', 'height'];

function controlGeometryFault(rule, onControl) {
  if (!classesOf(rule.selector).some((cls) => onControl.has(cls))) return null;
  const decided = CONTROL_GEOMETRY.filter((prop) => declares(rule.body, prop));
  return decided.length > 0 ? `geometry on a control — ${decided.join(', ')}` : null;
}

// ---------- the anti-vacuity self-tests ----------
// A pattern that stops matching reports zero findings, exits 0 and looks exactly like a cleared backlog.
// These are the instrument for that, and they go through the census's own functions — `rulesOf`, the
// three fault predicates, `fieldRanges`, `controlsIn` — because a self-test that carries its own copy of
// the pattern has no opinion about the code under test. That is not hypothetical: it is what the first
// version of `check-radius-scale.mjs`'s self-test did, and a broken tag name sailed straight past it.
//
// The CSS fixture exercises every branch that can silently stop matching: a comment naming all three
// shapes in prose (which must NOT be read as declarations, and must not shift the line numbers of what
// follows), the compact no-whitespace form this repository's stylesheets are written in, a chip-sized
// font on a `--r-md` corner (a tab, and NOT a chip), `border-width` split from `border`,
// `background-color` rather than `background`, and a rule nested inside an at-rule.
const CSS_FIXTURE = `
/* A chip has font-size: var(--t-micro), border-radius: var(--r-pill) and padding: 0 var(--s-3);
   a panel has border: 1px solid var(--border) and a background: var(--panel). */
.alpha { font-size: var(--t-micro); border-radius: var(--r-pill); padding: 0 var(--s-3); }
.beta{font-size:var(--t-small);border-radius:var(--r-sm);padding-left:var(--s-2);}
.gamma { font-size: var(--t-small); border-radius: var(--r-md); padding: var(--s-2); }
.delta { border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--panel); }
.epsilon { border-width: 1px; border-radius: var(--r-md); background-color: var(--bg); }
.zeta { border: 2px solid var(--border); border-radius: var(--r-md); background: var(--panel); }
.eta { font-family: var(--font-mono); }
@media (min-width: 1px) { .theta { font-family: var(--font-mono); } }
.iota { padding: 0 var(--s-3); }
.kappa { color: var(--muted); }
.markdown code { font-size: var(--t-small); border-radius: var(--r-sm); padding: 0 var(--s-2); }
.lambda { width: 8px; height: 8px; border-radius: 50%; }
.mu { display: flex; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
.nu { display: flex; border: 1px solid var(--border); border-radius: var(--r-lg); overflow: hidden; background: var(--panel); }
`;

// The JSX half of the chip fixture: `.iota` is on the primitive's own tag and still decides a padding —
// the post-migration hole, and the row that fails if the `<Chip` reader breaks. `.kappa` is on a `<Chip>`
// too and decides only a colour, which is the caller's to decide. `<ChipRow>` must open nothing.
const CHIP_TAG_FIXTURE = [
  '<Chip pill className="iota" onClick={() => n > 1 && go()}>x</Chip>',
  '<Chip className="kappa">y</Chip>',
  '<ChipRow className="lambda">z</ChipRow>',
].join('\n');

// `.theta@11` IS THE INTERESTING ROW, and it was written after the self-test failed on its first run.
// A shape nested in an `@media` must be counted EXACTLY ONCE and under its own selector, and both halves
// of that were wrong to begin with: `rulesOf` did not reset its selector cursor at a `{`, so the inner
// rule read as `@media (min-width: 1px) { .theta`, and the at-rule's own body — which contains every
// declaration nested in it — was counted as a second finding at the same line.
// `check-radius-scale.mjs` records that double-count as a latent over-report it can live with; a census
// whose whole output is a count cannot, so the cause is removed here rather than noted.
//
// `.iota@12` is the second arm: a padding on a class the fixture puts on a `<Chip>`. `.kappa` is on one
// too and is NOT a finding, because a colour is the caller's — both directions, for the reason
// `check-radius-scale.mjs` puts both directions of `<Surface as="button">` in its own fixture.
//
// `.markdown code@14` IS THE EXEMPTION, and it is in the fixture rather than trusted because an
// exemption is the one construct here that can silently swallow a real finding. It declares a chip's box
// exactly and must NOT appear below; widen CHIP_EXEMPT to anything else and `.alpha` or `.beta` drops out
// of this line, which fails. `.nu@17` is the same guard for `segFault`: a modal is a clipped bordered
// flex box WITH a ground, and it is the false finding that discriminator exists to refuse.
const CSS_SELF_TEST_WANT = [
  'chip .alpha@4 .beta@5 .iota@12',
  'panel .delta@7 .epsilon@8 .nu@17',
  'mono .eta@10 .theta@11',
  'dot .lambda@15',
].join(' | ');
// `.mu@16` IS THE SEGMENTED GROUP AND IT MOVED RATHER THAN LEAVING. `segFault` is folded into the tab
// arm, so its fixture row is asserted there — see TAB_SELF_TEST_WANT — and `.nu@17` stays in the panel
// row above as the false finding the discriminator refuses: a modal is a clipped bordered flex box WITH a
// ground. Deleting the row from this list without asserting it elsewhere is how a census goes quiet.

function cssSelfTest() {
  const ruleList = shapedRules(rulesOf('fixture.css', CSS_FIXTURE));
  const onChip = tagClasses([{ file: 'fixture.tsx', code: CHIP_TAG_FIXTURE }], CHIP_TAG);
  const got = censuses(onChip)
    .map(({ shape, fault }) => {
      const found = censusOf(ruleList, fault).map((f) => `${f.selector}@${f.site.split(':')[1]}`);
      return [shape, ...found].join(' ');
    })
    .join(' | ');
  return got === CSS_SELF_TEST_WANT ? null : `css census: expected\n  ${CSS_SELF_TEST_WANT}\ngot\n  ${got}`;
}

// The control fixture, and every row is a branch that can silently stop matching: a control inside a
// `<Field>` (covered), one carrying `.vb-ctl` (covered by the OTHER route, and the row that fails if
// arm 1's second clause breaks), one carrying `.vb-ctl` AND a class of its own (covered by arm 1 and a
// finding under arm 2 — the post-migration hole, and the reason arm 2 exists at all), a bare one (the
// finding), one inside an `<InlineField>` — which is NOT a Field, and is the case docs/design-system.md
// rules out of Field's scope by name — a control whose tag holds a brace expression before its
// `className` (so `openTagEnd` is exercised rather than a naive `indexOf('>')`), a multi-line Field, and
// a `<Fieldset>` that must not open a region either.
const CONTROL_FIXTURE = [
  '<Field label="a"><input value={v} /></Field>',
  '<input className="vb-ctl" />',
  '<input className="vb-ctl own-box" />',
  '<input placeholder="bare" />',
  '<InlineField><input className="inline-edit" /></InlineField>',
  '<select onChange={(e) => set(e.target.value)} className="vb-ctl"><option /></select>',
  '<Field',
  '  label="b"',
  '>',
  '  <select><option /></select>',
  '</Field>',
  '<Fieldset><textarea /></Fieldset>',
  // THE `<Control>` ROW, and it is arm 2's migration guard: the atom HAS the box, so this is not a
  // literal control and arm 1 must not count it — but `.ctl-own-box` is a surface class deciding a
  // control's geometry, which is exactly what arm 2 refuses, and a reader that knew only the three
  // literal tags could not see it after 34 controls moved onto the component.
  '<Control as="textarea" className="ctl-own-box" />',
].join('\n');

// `.own-box` and `.inline-edit` are the two arm-2 rows: one on a control that IS boxed by the primitive
// and one on a control that is not. `.plain-ink` is on a control and decides only a colour, which is the
// surface's — both directions, for the reason `chipGeometryFault`'s fixture carries `.kappa`.
const CONTROL_CSS_FIXTURE = [
  '.own-box { border-radius: var(--r-sm); padding: 0 var(--s-2); }',
  '.inline-edit { border: 1px solid var(--accent); }',
  '.plain-ink { color: var(--muted); }',
  '.not-on-a-control { padding: var(--s-3); font-size: var(--t-small); }',
  // A HEIGHT ON A CONTROL, which joined CONTROL_GEOMETRY in the atom phase, on the class that reaches the
  // list through `<Control>` rather than through a literal tag. One row proving both.
  '.ctl-own-box { height: 30px; }',
].join('\n');

const CONTROL_SELF_TEST_WANT = [
  // THREE, AND IT WAS FIVE UNTIL THE `<Field>` EXCUSE WAS WITHDRAWN. The two controls a `<Field>` region
  // covered are findings now: the only route to the box is `.vb-ctl`, which means the element is a
  // `<Control>`. So `boxed` counts the three tags carrying that class and nothing else. `<Control>` still
  // adds none of its own — it is not a literal control.
  // THE TWO NEW ROWS ARE THE POINT OF THE CHANGE, and they are why this expectation is written out in full
  // rather than as a count: a fixture that only counted would have passed 3-for-3 against a reader that
  // had stopped seeing `<Field>` at all.
  'boxed 3',
  'findings fixture.tsx:1 input <Field>, which is no longer an excuse,' +
    ' fixture.tsx:4 input nothing, fixture.tsx:5 input nothing,' +
    ' fixture.tsx:10 select <Field>, which is no longer an excuse, fixture.tsx:12 textarea nothing',
  'geometry .own-box — geometry on a control — border-radius, padding' +
    ' | .inline-edit — geometry on a control — border' +
    ' | .ctl-own-box — geometry on a control — height',
].join(' | ');

// The box-less fixture, and it exercises every way this check can go quiet: a name rendered as
// something other than a chip (the regression), a name on a `<Chip>` with a tone (the pass), a name on
// one WITHOUT a tone (the silent collapse), a `<ChipRow>` that must not count as a `<Chip>` — the
// `(?![\w-])` guard — and a name nobody uses at all, which is what "gone" looks like and must pass.
const BOXLESS_FIXTURE = [
  '<span className="gone-word">x</span>',
  '<Chip tone="warn" className="toned">y</Chip>',
  '<Chip className="untoned">z</Chip>',
  '<ChipRow tone="bad" className="rowed">w</ChipRow>',
].join('\n');

const BOXLESS_NAMES = ['gone-word', 'toned', 'untoned', 'rowed', 'never-written'];

const BOXLESS_SELF_TEST_WANT = [
  '.gone-word — named at fixture.tsx:1 and not on a <Chip>',
  '.untoned — on a <Chip> with no tone at fixture.tsx:3',
  '.rowed — named at fixture.tsx:4 and not on a <Chip>',
].join(' | ');

// THE TWO NEW ARMS' FIXTURE, and every row is a way one of them can go quiet: a mark on a tag (the
// finding), the same mark inside a COMMENT (which must not count — this file's own header names all six
// marks in prose), a `role="tabpanel"` and a `role="menubar"` that must NOT match the shorter marks, and a
// cross-arm row: a `role="menu"` must be a MENU finding and never a tab one, which is the whole reason
// there are two arms.
const MARK_FIXTURE = [
  '<div role="tablist" aria-label="View">',
  '  <button role="tab" aria-selected={true}>A</button>',
  '</div>',
  '<div role="tabpanel">not a tab</div>',
  '// role="tab" named in a comment is not a tab',
  '<div role="menu">',
  '  <button role="menuitem" aria-current="page">Boards</button>',
  '</div>',
  '<div role="menubar">not a menu</div>',
  // ROWS 10-13 ARE PLANT 4b: the spelling the two OWNERS use. `role={grouped ? undefined : 'tab'}` and
  // `role={list ? 'menuitem' : undefined}` are copied off `Tabs.tsx` and `Menu.tsx`, and the literal marks
  // this file used to carry were blind to both — a hand-rolled row lifted from either component passed.
  "<div role={grouped ? undefined : 'tablist'} aria-label={label}>",
  "  <button role={grouped ? undefined : 'tab'} aria-selected={v === value}>A</button>",
  "<div role={list ? 'menu' : undefined}>",
  "  <button role={list ? 'menuitem' : undefined} aria-current={at ? 'page' : undefined}>B</button>",
].join('\n');

// SORTED, so the order is lexicographic on the file:line prefix and `:10` sorts before `:2`. Rows 10-13
// are plant 4b's — if either expression row disappears from this list the arm is blind to its own owners.
const TAB_SELF_TEST_WANT = [
  'fixture.tsx:1 role="tablist" — a cell of a mutually-exclusive set',
  "fixture.tsx:10 role={grouped ? undefined : 'tablist' — a cell of a mutually-exclusive set",
  'fixture.tsx:11 aria-selected — a cell of a mutually-exclusive set',
  "fixture.tsx:11 role={grouped ? undefined : 'tab' — a cell of a mutually-exclusive set",
  'fixture.tsx:2 aria-selected — a cell of a mutually-exclusive set',
  'fixture.tsx:2 role="tab" — a cell of a mutually-exclusive set',
  'seg .mu@16',
].join(' | ');

const MENU_SELF_TEST_WANT = [
  "fixture.tsx:12 role={list ? 'menu' — a cell of a mutually-exclusive set",
  'fixture.tsx:13 aria-current — a cell of a mutually-exclusive set',
  "fixture.tsx:13 role={list ? 'menuitem' — a cell of a mutually-exclusive set",
  'fixture.tsx:6 role="menu" — a cell of a mutually-exclusive set',
  'fixture.tsx:7 aria-current — a cell of a mutually-exclusive set',
  'fixture.tsx:7 role="menuitem" — a cell of a mutually-exclusive set',
].join(' | ');

function markSelfTest() {
  const sources = [{ file: 'fixture.tsx', code: codeOf(MARK_FIXTURE) }];
  // The OWNER argument is exercised too, and it is the one that would silence the whole arm if it were
  // wrong: the same fixture read as its own owner must report nothing.
  if (markFaults(sources, TAB_MARKS, 'fixture.tsx').length > 0) return 'tab arm: the owner file was counted';
  const seg = censusOf(shapedRules(rulesOf('fixture.css', CSS_FIXTURE)), segFault).map(
    (f) => `${f.selector}@${f.site.split(':')[1]}`,
  );
  const tab = [...markFaults(sources, TAB_MARKS, TAB_OWNER), ['seg', ...seg].join(' ')].join(' | ');
  if (tab !== TAB_SELF_TEST_WANT) return `tab arm: expected\n  ${TAB_SELF_TEST_WANT}\ngot\n  ${tab}`;
  const menu = markFaults(sources, MENU_MARKS, MENU_OWNER).join(' | ');
  if (menu !== MENU_SELF_TEST_WANT) return `menu arm: expected\n  ${MENU_SELF_TEST_WANT}\ngot\n  ${menu}`;
  return null;
}

function boxlessSelfTest() {
  const sources = [{ file: 'fixture.tsx', code: codeOf(BOXLESS_FIXTURE) }];
  const got = boxlessFaults(BOXLESS_NAMES, tagsAcross(sources, CHIP_TAG), classSites(sources)).join(' | ');
  return got === BOXLESS_SELF_TEST_WANT
    ? null
    : `box-less chips: expected\n  ${BOXLESS_SELF_TEST_WANT}\ngot\n  ${got}`;
}

function controlSelfTest() {
  const all = controlsIn('fixture.tsx', CONTROL_FIXTURE);
  const findings = all.filter((c) => !c.boxed);
  // Arm 2 goes through the same two functions the run does — `controlsIn` for the classes and
  // `controlGeometryFault` for the verdict — so a break in either is a red fixture rather than a quiet
  // zero. `vb-ctl` is filtered out here for the reason the run filters primitive classes out of
  // `onChip`: the primitive's own class is not a surface hand-rolling one.
  const onControl = new Set(
    [
      ...all.flatMap((c) => c.classes),
      ...tagClasses([{ file: 'fixture.tsx', code: codeOf(CONTROL_FIXTURE) }], CONTROL_COMPONENT),
    ].filter((cls) => cls !== CONTROL_BOX_CLASS),
  );
  const geometry = censusOf(shapedRules(rulesOf('fixture.css', CONTROL_CSS_FIXTURE)), (rule) =>
    controlGeometryFault(rule, onControl),
  );
  const got = [
    `boxed ${all.length - findings.length}`,
    `findings ${findings.map((c) => `${c.site} ${c.tag} ${c.where}`).join(', ')}`,
    `geometry ${geometry.map((f) => `${f.selector} — ${f.detail}`).join(' | ')}`,
  ].join(' | ');
  return got === CONTROL_SELF_TEST_WANT
    ? null
    : `control census: expected\n  ${CONTROL_SELF_TEST_WANT}\ngot\n  ${got}`;
}

// ---------- where a class is used, so a finding follows it onto the primitive ----------
// THIS IS THE MIGRATION-BLINDNESS GUARD, and it is the Phase 3 lesson applied before it can cost
// anything. The site is read out of `className` attribute text with NO opinion about the tag, so a chip
// class moved onto `<Chip className="tag">` is still counted and still located: the census does not lose
// sight of the shape when the shape lands on the primitive.
//
// SCOPED TO `className` AND NOT A BARE TOKEN GREP — see `classSites` in tools/lib/jsx.mjs, which owns
// the reader and the reason. A `${…}` hole is blanked there: a composed name cannot be resolved here, and
// `check-class-budget.mjs` is the check that resolves composition. The comment blanking itself is `codeOf`
// in tools/lib/source.mjs.

// class name -> the FIRST `file:line` whose `className` names it. The shared reader keeps every site,
// because `check-name-resolution.mjs` prints all of them; a census only needs somewhere to look.
const classSites = (sources) => new Map([...classSitesOf(sources)].map(([cls, at]) => [cls, at[0]]));

function siteOf(selector, sites) {
  for (const cls of classesOf(selector)) {
    const at = sites.get(cls);
    if (at !== undefined) return at;
  }
  // A rule whose class is composed at run time (`.msg-assistant`) has no literal `className` to find, and
  // a rule with no class at all (`.markdown pre`) never had one. Neither is a hole in the census: the
  // finding is the RULE, and the site is only there so a reader can go and look at it.
  return 'no literal className';
}

// THE SELF-TEST FOR THE MIGRATION GUARD, and it is here because a `className` reader that stopped
// matching would not change a single count — it would only stop saying where the shape lives, quietly, on
// a run that still exits 0. The fixture holds the case that matters (a hand-rolled class on the
// PRIMITIVE'S own tag, which is the Phase 3 defect's shape), a class in a `${}` hole, and the import that
// made the first version of this wrong.
const SITE_FIXTURE = [
  "import { markdown } from '../markdown';",
  '<Chip pill className="tag">x</Chip>',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder IS the fixture — this string is JSX source whose `${}` hole `classSites` must blank, so it cannot be a real template.
  '<span className={`tag-chip ${on ? active : ""}`} title="two words">y</span>',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: as above — the ternary is the case `.popover` is written in.
  "<div className={x ? `popover ${x}` : 'popover'}>z</div>",
].join('\n');

// `.two` is the anti-case: a `title="two words"` in the same tag must NOT contribute a class name.
const SITE_SELF_TEST_WANT = [
  '.tag fixture.tsx:2',
  '.tag-chip fixture.tsx:3',
  '.popover fixture.tsx:4',
  '.markdown no literal className',
  '.two no literal className',
].join(' | ');

function siteSelfTest() {
  const sites = classSites([{ file: 'fixture.tsx', code: codeOf(SITE_FIXTURE) }]);
  const got = ['.tag', '.tag-chip', '.popover', '.markdown code', '.two']
    .map((selector) => `${classesOf(selector)[0] && `.${classesOf(selector)[0]}`} ${siteOf(selector, sites)}`)
    .join(' | ');
  return got === SITE_SELF_TEST_WANT
    ? null
    : `site lookup: expected\n  ${SITE_SELF_TEST_WANT}\ngot\n  ${got}`;
}

// ---------- the run ----------
const cssRules = shapedRules(
  walk('.css')
    .filter((file) => !PRIMITIVE_LAYER.includes(file))
    .flatMap((file) => rulesOf(file, readFileSync(join(ROOT, file), 'utf8'))),
);

const primitiveClasses = new Set(
  PRIMITIVE_LAYER.flatMap((file) =>
    shapedRules(rulesOf(file, readFileSync(join(ROOT, file), 'utf8'))).flatMap((rule) =>
      classesOf(rule.selector),
    ),
  ),
);

const tsxFiles = walk('.tsx').map((file) => ({ file, text: readFileSync(join(ROOT, file), 'utf8') }));
const sources = tsxFiles.map(({ file, text }) => ({ file, code: codeOf(text) }));
const allCode = sources.map((s) => s.code).join('\n');

const sites = classSites(sources);
// A PRIMITIVE'S OWN CLASS IS NOT A SURFACE HAND-ROLLING ONE, and leaving it in made the census report a
// right answer as a fault on its first run. Four count badges pass `className="vb-readout"` to `<Chip>` —
// borrowing the readout treatment, which is what `className` is for — so `.vb-readout` was in the set, and
// `.mp-modal > .vb-readout { padding }`, a rule about a READOUT in the model picker, was reported as
// geometry on a chip. Arm 2 asks whether a SURFACE class decides a chip's box; `vb-*` names are the
// primitives' own and their rules live in primitives.css, which this census does not read.
const chipTagList = tagsAcross(sources, CHIP_TAG);
const onChip = new Set([...tagClasses(sources, CHIP_TAG)].filter((cls) => !primitiveClasses.has(cls)));
// Where a class is NAMED AT ALL — a `className` first, a stylesheet rule if nothing renders it. The
// box-less check needs both directions: a class rendered as a `<span>` is visible in the JSX, and a class
// whose rule survives with no call site is visible only in the CSS.
const named = new Map(sites);
for (const rule of cssRules)
  for (const cls of classesOf(rule.selector))
    if (!named.has(cls)) named.set(cls, `${rule.file}:${rule.line}`);
// CODE, NOT COMMENTS, and a real finding is what says so. Arm 1 read the RAW file while every other
// reader here reads `codeOf`, which was a latent hole for as long as no `.tsx` comment quoted a control
// tag — and the atom phase quoted three in one sentence: `atoms/Control.tsx`'s own header says "an
// `<input>`, a `<select>` or a `<textarea>`" and names `<input type="checkbox">` eight lines later. That
// is FOUR phantom controls in the file whose whole purpose is that a control no longer hand-rolls its
// box, and they took the census from 2 to 6 against a ceiling of 2 — a gate reporting the component that
// fixed the defect as the defect. `codeOf` blanks a comment to spaces and keeps its newlines, so
// `lineOf` still answers, which is why the census can read it without losing its own sites.
const controls = tsxFiles.flatMap(({ file, text }) => controlsIn(file, codeOf(text)));
const rawControls = controls.filter((c) => !c.boxed);
// Arm 2's population: every surface class that lands on a literal control. `vb-ctl` and the rest of the
// primitives' own names are filtered out for the reason `onChip` filters them — a primitive's class is
// not a surface hand-rolling one, and its rules live in primitives.css, which this census does not read.
const onControl = new Set(
  [...controls.flatMap((c) => c.classes), ...tagClasses(sources, CONTROL_COMPONENT)].filter(
    (cls) => !primitiveClasses.has(cls),
  ),
);

const adoption = new Map(
  ADOPTION.map(({ shape, tags }) => [
    shape,
    tags.reduce((n, tag) => n + [...allCode.matchAll(new RegExp(`${tag}(?![\\w-])`, 'g'))].length, 0),
  ]),
);

console.log(
  `shape coverage: ${cssRules.length} rule(s) outside the ${PRIMITIVE_LAYER.length}-sheet primitive layer, ${controls.length} literal control(s) in ${tsxFiles.length} .tsx file(s)`,
);

// Before any finding is printed, because a green run on a pattern that matched nothing is the worse
// failure — the same order `check-radius-scale.mjs` prints in, and for the same reason.
const parserFault =
  cssSelfTest() ?? controlSelfTest() ?? siteSelfTest() ?? boxlessSelfTest() ?? markSelfTest();
if (parserFault) {
  console.error(`\nthe parser is broken: ${parserFault}.`);
  console.error(`A census here is vacuous — it would report zero findings whatever the tree holds. Fix the`);
  console.error(`pattern in tools/check-shape-coverage.mjs; do NOT relax the fixture.`);
  process.exit(1);
}

let failed = false;

// A CEILING OF ZERO GETS ITS OWN MESSAGE, because the ratchet wording is unactionable on one: "it blocks
// an increase, not the backlog — Phase 8 drives it down" is nonsense addressed to somebody who has just
// added the only finding there is, and a gate message a reader cannot act on is a gate that gets
// bypassed. Found by planting at all three of the zero censuses and reading what they said.
function report(shape, ceiling, phase, lines) {
  const adopted = adoption.get(shape) ?? 0;
  const head = `${shape}-shaped: ${lines.length} hand-rolled against ${adopted} primitive call site(s)`;
  if (lines.length > ceiling) {
    if (ceiling === 0) {
      console.error(`\n${head}. This shape is FULLY MIGRATED and this census BLOCKS AT ZERO: every`);
      console.error(`finding below is a new hand-rolled instance. Render it with the atom in`);
      console.error(`web/src/atoms/ or the molecule in web/src/molecules/ instead of declaring the`);
      console.error(`shape again.\n`);
    } else {
      console.error(`\n${head}, against a ceiling of ${ceiling}. This census is a RATCHET: it blocks an`);
      console.error(`increase, not the backlog — ${phase} drives it down. Render the new one with the`);
      console.error(`atom in web/src/atoms/ or the molecule in web/src/molecules/ instead of declaring`);
      console.error(`the shape again.\n`);
    }
    for (const line of lines) console.error(`  ${line}`);
    failed = true;
    return;
  }
  // Printed on a PASSING run too: a finding list nobody sees is a finding list nobody fixes.
  console.log(`${head} (ratchet ${lines.length}/${ceiling}, ${phase}):`);
  for (const line of lines) console.log(`  ${line}`);
}

for (const { shape, ceiling, fault, phase } of censuses(onChip)) {
  const findings = censusOf(cssRules, fault);
  report(
    shape,
    ceiling,
    phase,
    findings.map((f) => `${f.site} ${f.selector} — ${f.detail}  (used at ${siteOf(f.selector, sites)})`),
  );
}

// THE TWO NEW ARMS. The tab arm carries the FOLDED SEGMENTED CENSUS with it: a clipped bordered group is
// `Tabs grouped` with the corners taken off, and counting it here rather than as its own 0/0 row is what
// keeps the fold visible.
report(
  'tab',
  TAB_CEILING,
  'at zero — blocking',
  [
    ...markFaults(sources, TAB_MARKS, TAB_OWNER),
    ...censusOf(cssRules, segFault).map(
      (f) => `${f.site} ${f.selector} — ${f.detail}  (used at ${siteOf(f.selector, sites)})`,
    ),
  ].map((line) => `${line}  → render it with <Tabs>`),
);
report(
  'menu',
  MENU_CEILING,
  'at zero — blocking',
  markFaults(sources, MENU_MARKS, MENU_OWNER).map((line) => `${line}  → render it with <Menu>`),
);

report(
  'control',
  CONTROL_CEILING,
  'InlineField absorbed as `Field inline` — at zero, blocking',
  rawControls.map(
    (c) =>
      `${c.site} <${c.tag}> — a literal control: its box comes from ${c.where}. Render <Control> instead` +
      ` (a checkbox or a radio takes \`type\` and the atom withdraws the text box).`,
  ),
);

// ARM 2, reported as its own census because it answers the other direction and would be invisible folded
// into arm 1's count: arm 1 falls as controls are migrated and this one RISES if one is migrated badly.
report(
  'control-geometry',
  CONTROL_GEOMETRY_CEILING,
  'at zero — blocking',
  censusOf(cssRules, (rule) => controlGeometryFault(rule, onControl)).map(
    (f) => `${f.site} ${f.selector} — ${f.detail}  (used at ${siteOf(f.selector, sites)})`,
  ),
);

// A ceiling of ZERO, because this one never had a backlog: the four are migrated or gone as of Phase 8,
// so there is nothing here to ratchet down and every finding is a regression.
report('boxless-chip', 0, 'gone or a <Chip> — blocking', boxlessFaults(BOXLESS_CHIPS, chipTagList, named));

// PRINTED, because an exemption nobody sees is an exemption nobody re-examines — the same argument as
// printing a passing census's full list.
for (const [selector, reason] of CHIP_EXEMPT) console.log(`chip-shaped, EXEMPT: ${selector} — ${reason}`);

if (failed) process.exit(1);

console.log(
  `all four shape censuses, both selection arms, both control arms and the box-less list are at or ` +
    `under their ceilings; ` +
    `${controls.length - rawControls.length} of ${controls.length} control(s) take the primitive's box ` +
    `(${controls.filter((c) => c.inField).length} in a <Field>, ` +
    `${controls.filter((c) => !c.inField && c.boxed).length} on .${CONTROL_BOX_CLASS})`,
);
