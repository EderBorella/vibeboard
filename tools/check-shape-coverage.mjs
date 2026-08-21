#!/usr/bin/env node
//
// FOUR COVERAGE CENSUSES, ONE PER PRIMITIVE SHAPE: chip, panel, mono-fact, control. Each one asks the
// single question `tools/check-radius-scale.mjs` asks of buttons — *how much of this shape is still
// hand-rolled?* — and each one RATCHETS at what the tree holds today rather than blocking at zero.
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
// measurement is what this page exists to stop.
//
// EVERY CENSUS RATCHETS, AND NOT ONE OF THEM BLOCKS AT ZERO. Four backlogs exist today; a gate pointed
// at a backlog has to be bypassed on every commit, which teaches everyone to ignore it. Each census
// therefore prints its FULL list on a passing run and fails only on an increase. Lower the ceilings as
// the phases land; never raise one.
//
// THREE CENSUSES READ THE STYLESHEETS AND ONE READS THE JSX, and that split is what makes them
// migration-proof — the Phase 3 defect this file was written not to repeat. That defect: the geometry
// ratchet read literal `<button>` only, so moving 27 classes onto `<Button>` took its population from 50
// to 23 and a planted `padding` exited 0. The count kept falling while the geometry moved out of sight.
//   - chip, panel and mono are detected in the CSS, by the declarations that DRAW the shape. A shape can
//     only be hand-rolled in one place, so moving the element onto `<Chip>`, `<Panel>` or `<Readout>`
//     cannot hide it: the rule is still there and still counted. Each finding additionally names a call
//     site read out of the JSX — ANY tag, the primitive's own included — so the finding follows the class
//     onto the primitive rather than losing sight of it.
//   - control is detected in the JSX, because a raw `<input>` is not a class at all. Its population is
//     EVERY control in the tree and its finding count is the controls outside a `<Field>`, both printed:
//     migration moves a control from one to the other and leaves the population where it was. A census
//     whose population shrinks as the migration succeeds is the Phase 3 defect wearing a new hat, and the
//     "in a Field" test is per-ELEMENT and not per-file for the same reason — a file-level test would
//     silence every remaining control in a file the moment one of them was migrated.
//
// NO COUNT FLOORS, ANYWHERE. A floor on a number the sweep exists to reduce fails the run for SUCCEEDING
// and says "this check is vacuous" while doing it — that has now happened twice in this repository
// (`check-radius-scale.mjs`'s button population at 30 against 23, and its radius floor at 60 against 59).
// The anti-vacuity instrument here is `cssSelfTest`, `controlSelfTest` and `siteSelfTest` below, over
// fixtures the tree cannot move, and all three go through the census's OWN functions: a self-test that
// carries its own copy of the regex it is meant to test has no opinion about the code under test at all,
// which is what happened to the first one written in this repository.
//
// WHAT THESE CENSUSES DO NOT CATCH, stated so nobody mistakes a ratchet for a proof:
//   - A CHIP WITH NO BOX. The census reads the box — a small font-size, a pill-or-`--r-sm` corner and a
//     padding. `.tile-suggestions` and `.tile-problem` declare a size, an ink and `white-space: nowrap`
//     and nothing else, so they are chips by MEANING and invisible here; `.tag-btn` (a cursor on `.tag`)
//     and `.tag-chip-count` (an opacity inside `.tag-chip`) are modifiers of a box declared elsewhere.
//     Those four are the reason this census reads 10 where the owner's family list reads 9, and no shape
//     rule can separate a state word from any other coloured word without becoming a list of names.
//     Phase 8's own gate is where the three tones of those two are asserted.
//   - A SHAPE BUILT BY MORE THAN ONE RULE. `.a { border-radius } .a { padding }` is two rules and each is
//     short of the pattern. Every shape in the tree today is declared in one rule.
//   - GEOMETRY FROM AN INLINE STYLE, or from a `style={{…}}` prop. Nothing in `web/src` draws one of
//     these four shapes that way, and a census over the stylesheets cannot see it if it did.
//   - A CONTROL THAT IS NOT A `<input>`/`<textarea>`/`<select>` literal — a control rendered by a
//     component of its own, or reached through a variable. `.vb-trigger` is the deliberate case: two
//     select triggers that are `<button>`s.
//   - WHETHER THE SHAPE IS RIGHT. It counts hand-rolled shapes, not wrong ones. Values are still the
//     type and radius checks' business.
//
// THE CENSUSES OVERLAP AND THAT IS NOT DOUBLE-COUNTING, because they answer per-shape questions and one
// rule can be two shapes: `.tag`, `.tag-chip`, `.mp-chip` and `.board-archive` are in both the chip and
// the panel census (a chip IS a small panel with a corner and a ground), and `.board-archive`, `.tag-chip`
// and `.tab-badge` are in the mono census too. Phase 8 taking the chips therefore moves three numbers.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = 'web/src';
// The primitive stylesheet: the ONE place any of these four shapes may be declared.
const PRIMITIVES = join('web', 'src', 'ui', 'primitives.css');

// ---------------------------------------------------------------------------------------------------
// THE CEILINGS. Each is what the tree holds today, measured by this file on 2026-08-21, and each is the
// number the phase named beside it has to drive down. NEVER raise one: a ratchet that moves the wrong way
// is a gate switched off in place.

// CHIP — 10, against the owner's family list of 9. Five are the same rule (`.tag`, `.tag-chip`,
// `.mp-chip`, `.board-archive`, `.tile-setup`); four of his nine declare no box and cannot be seen here
// (see WHAT THESE DO NOT CATCH); and five more draw a chip's box that his list does not name —
// `.mp-def-tag`, `.control-tag`, `.tab-badge`, `.signin-this` and `.markdown code`. The last is inline
// code in rendered prose and is the one member of this census that may legitimately never be a `Chip`;
// it is counted rather than exempted, because over-reporting is loud and harmless while an exemption list
// is a licence.
// ALL TEN ARE ARM 1 AND ARM 2 IS AT ZERO TODAY: no surface class currently on a `<Chip>` declares a
// corner, a padding or a size — `.report-chip` and `.ap-chip` decide a face and an ink, which is the
// caller's to decide. That zero is the interesting half, because it is the half that goes up the moment a
// chip is migrated carelessly. PHASE 8'S NUMBER.
const CHIP_CEILING = 10;
// PANEL — 32, and it agrees with the owner's independently measured 32 exactly. Four of them are the
// chips above. PHASE 8 AND PHASE 10 MOVE PARTS OF THIS; no phase owns the whole of it yet.
const PANEL_CEILING = 32;
// MONO — 14, and it agrees with the owner's 14 exactly. Not all fourteen are readout facts: a `<pre>`, a
// `<code>` and three textareas are monospaced because the CONTENT is machine text rather than because a
// figure is a measurement, and those are legitimate survivors. Counted anyway, for the reason
// `.markdown code` is counted above.
const MONO_CEILING = 14;
// CONTROL — 35 of 42, against the owner's approximate ~33 across 23 files. The tree holds 42 literal
// `<input>`/`<textarea>`/`<select>` tags in 23 files; seven are already inside a `<Field>`, leaving 35 in
// 22 files. Two of the 35 are `ui/InlineField.tsx`'s, which docs/design-system.md rules OUT of `Field`'s
// scope by name — its commit-on-blur is behaviour, not a box — so 33 is the number Phase 9 can actually
// reach, and it is not made 33 here by exempting them: a census that quietly drops its own known
// survivors is how a backlog stops being visible. PHASE 9'S NUMBER.
const CONTROL_CEILING = 35;

const CHIP_FONT = ['var(--t-micro)', 'var(--t-small)'];
// A chip's corner, and the primitive's own two: `--r-sm` square-ish, `--r-pill` for a state word or a
// tag. `--r-md` is a button's and a panel's corner, which is what keeps `.tab-btn` and `.dock-tab` — tabs,
// refused a primitive by Phase 5b with a measurement — out of a census they are not in the family of.
const CHIP_RADIUS = ['var(--r-pill)', 'var(--r-sm)'];
const CONTROL_TAGS = ['input', 'textarea', 'select'];
// ONE CONSTANT AND NOT A STRING AT TWO CALL SITES, and a planted defect is what says so: with the tag
// written literally at both the run's call and the self-test's, breaking the run's copy to `'<ChipX'` took
// arm 2 blind and the run still exited 0 — the self-test was asserting its own argument. That is the same
// failure as a self-test carrying its own regex, one level along.
const CHIP_TAG = '<Chip';
// What a census counts as adoption, printed beside its backlog so the ratio is visible on every run.
const ADOPTION = [
  { shape: 'chip', tags: [CHIP_TAG] },
  { shape: 'panel', tags: ['<Panel'] },
  { shape: 'mono', tags: ['<Readout', '<ReadoutLine'] },
  { shape: 'control', tags: ['<Field'] },
];

const walk = (ext) =>
  readdirSync(join(ROOT, CORPUS), { recursive: true })
    .filter((entry) => typeof entry === 'string' && entry.endsWith(ext))
    .map((entry) => join(CORPUS, entry))
    .sort();

const lineOf = (text, offset) => {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
};

// Every rule in a stylesheet as `{ file, line, selector, body }`, brace-matched rather than regex-split
// because `@media`/`@supports`/`@container` nest and a flat regex reads their prelude as a selector.
// Comments are BLANKED and not removed, so every offset still maps to its real line — the repair
// `check-type-scale.mjs` needed after it read a comment's prose as a declaration.
function rulesOf(file, raw) {
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out = [];
  const stack = [];
  let selStart = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{') {
      stack.push({ selector: text.slice(selStart, i).trim(), start: i + 1 });
      // Reset here as well as at `}` and `;`, so a rule NESTED in an at-rule carries its own selector
      // rather than the at-rule's prelude glued to the front of it. `check-radius-scale.mjs` does not,
      // and it does not have to: it drops anything starting with `@`, which drops the nested rule too.
      // This file counts shapes, and a shape inside a `@media` is a shape.
      selStart = i + 1;
    } else if (c === '}') {
      const open = stack.pop();
      if (open) {
        out.push({
          file,
          line: lineOf(text, open.start),
          selector: open.selector,
          body: text.slice(open.start, i),
        });
      }
      selStart = i + 1;
    } else if (c === ';') selStart = Math.max(selStart, i + 1);
  }
  return out;
}

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
const CHIP_GEOMETRY = ['border-radius', ...PADDING, 'font-size'];

const classesOf = (selector) => [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);

// The end of an element's opening tag: the first `>` outside any `{}`. A naive `indexOf('>')` stops
// inside `onClick={() => …}` and reads half a tag, silently losing every className written after a
// handler. Lifted from `check-radius-scale.mjs`, where it was forced by exactly that.
function openTagEnd(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return i;
  }
  return -1;
}

// The class tokens in one opening tag's `className`, through the SAME reader the call-site lookup uses —
// one attribute reader and not two, so a class reaching a `<Chip>` through a ternary is not visible to the
// locator and invisible to the census.
function classesInTag(attrs) {
  return [...attrs.matchAll(/className=/g)].flatMap((m) => classNameTokens(attrs, m.index));
}

// Every class literal on a `<tag …>`, whatever else that tag says. `(?![\w-])` so `<Chip` does not match
// `<ChipRow`, the guard `check-radius-scale.mjs` needed for `<Button` against `<ButtonRow`.
function tagClasses(sources, tag) {
  const found = new Set();
  for (const { code } of sources) {
    for (const open of code.matchAll(new RegExp(`${tag}(?![\\w-])`, 'g'))) {
      const end = openTagEnd(code, open.index + tag.length);
      if (end >= 0) for (const cls of classesInTag(code.slice(open.index, end))) found.add(cls);
    }
  }
  return found;
}

// ---------- the three CSS shapes, one predicate each ----------
// A CHIP is the primitive's own declaration set written by hand: a small font-size, a chip's corner and
// a padding. See `.vb-chip` in ui/primitives.css, which says exactly those three things.
function chipFault(rule) {
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

// THE CHIP CENSUS'S SECOND ARM, AND IT IS THE PHASE 3 HOLE CLOSED BEFORE IT COSTS ANYTHING. Arm 1 finds
// a chip nobody has migrated. This finds the other half: a class that IS on a `<Chip>` and still decides
// the box — a padding, a corner or a size of its own. Without it the census would fall as chips migrated
// while their geometry moved onto the primitive's tag, which is precisely what happened to the button
// ratchet when 27 classes went to `<Button>` and a planted `padding` on `.cs-action` exited 0.
//
// IT IS NOT THE SAME ARM `<Panel>` WOULD WANT, and that asymmetry is measured rather than tidy: a `Panel`
// is usually a `<div>` and `raised` deliberately has no padding, so `.archive-drawer`, `.exec-column` and
// `.halt` pad themselves correctly — counting every `<Panel className>` would report three right answers
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
  { shape: 'panel', ceiling: PANEL_CEILING, fault: panelFault, phase: 'Phases 8 and 10' },
  { shape: 'mono', ceiling: MONO_CEILING, fault: monoFault, phase: 'Phase 8' },
];

// An at-rule's own body text contains every rule nested inside it, so counting it as well as its
// children reports the same shape twice. Dropping the prelude — which is what `startsWith('@')` selects,
// now that a nested rule keeps its own selector — counts each shape exactly once, wherever it sits.
const shapedRules = (ruleList) => ruleList.filter((rule) => !rule.selector.startsWith('@'));

function censusOf(ruleList, fault) {
  const findings = [];
  for (const rule of ruleList) {
    const detail = fault(rule);
    if (detail !== null)
      findings.push({ site: `${rule.file}:${rule.line}`, selector: rule.selector, detail });
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

// Every literal control tag in one file, each marked with whether it is inside a Field. PER ELEMENT and
// never per file: a file-level test would stop counting a file's remaining controls the moment one of
// them was migrated, which is the Phase 3 blindness exactly.
// Sorted by LINE as a number, not by the `file:line` string: a string sort puts line 105 before line 93,
// and a census nobody can read down a file is a census nobody reads.
function controlsIn(file, text) {
  const ranges = fieldRanges(text);
  const found = CONTROL_TAGS.flatMap((tag) =>
    [...text.matchAll(new RegExp(`<${tag}(?![\\w-])`, 'g'))].map((m) => ({
      line: lineOf(text, m.index),
      site: `${file}:${lineOf(text, m.index)}`,
      tag,
      inField: ranges.some(([from, to]) => m.index > from && m.index < to),
    })),
  );
  return found.sort((a, b) => a.line - b.line);
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
// `check-radius-scale.mjs` puts both directions of `<Panel as="button">` in its own fixture.
const CSS_SELF_TEST_WANT = [
  'chip .alpha@4 .beta@5 .iota@12',
  'panel .delta@7 .epsilon@8',
  'mono .eta@10 .theta@11',
].join(' | ');

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

// The control fixture: a control inside a Field (not a finding), one outside it (a finding), one inside
// an `<InlineField>` — which is NOT a Field, and is the case docs/design-system.md rules out of Field's
// scope by name — a multi-line Field, and a `<Fieldset>` that must not open a region either.
const CONTROL_FIXTURE = [
  '<Field label="a"><input value={v} /></Field>',
  '<input className="vb-input" />',
  '<InlineField><input /></InlineField>',
  '<Field',
  '  label="b"',
  '>',
  '  <select><option /></select>',
  '</Field>',
  '<Fieldset><textarea /></Fieldset>',
].join('\n');

const CONTROL_SELF_TEST_WANT =
  'in-field 2 | findings fixture.tsx:2 input, fixture.tsx:3 input, fixture.tsx:9 textarea';

function controlSelfTest() {
  const all = controlsIn('fixture.tsx', CONTROL_FIXTURE);
  const findings = all.filter((c) => !c.inField);
  const got = [
    `in-field ${all.length - findings.length}`,
    `findings ${findings.map((c) => `${c.site} ${c.tag}`).join(', ')}`,
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
// SCOPED TO `className` AND NOT A BARE TOKEN GREP, and the first version was the bare grep. It reported
// `.markdown code` as used at `cards/CardView.tsx:1`, which is the `markdown` MODULE in an import
// statement — a search that matched something other than what it claimed. A `${…}` hole is blanked for the
// reason `check-radius-scale.mjs` blanks it: a composed name cannot be resolved here, and
// `check-class-budget.mjs` is the check that resolves composition.
function codeOf(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\w])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

// The class tokens named anywhere in one `className=`'s value, whatever shape the expression is. A plain
// string, a template literal, and a TERNARY — `.popover`'s own call site is
// `className={className ? `popover ${className}` : 'popover'}`, and a reader that only understood the
// first two forms reported that rule as having no call site at all.
// The braced expression after `className=`, brace-matched. Scoped to the ATTRIBUTE'S OWN VALUE and not to
// the rest of the tag, because a `title="two words"` in the same tag would otherwise contribute two class
// names that do not exist.
function bracedAt(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(from + 1, i);
    }
  }
  return '';
}

const tokensOf = (text) =>
  text
    .replace(/\$\{[^}]*\}/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

function classNameTokens(code, at) {
  const from = at + 'className='.length;
  if (code[from] === '"') return tokensOf(code.slice(from + 1, code.indexOf('"', from + 1)));
  if (code[from] !== '{') return [];
  // Every string in the expression, whichever branch of a ternary it is in.
  return [...bracedAt(code, from).matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)].flatMap((m) =>
    tokensOf(m[1] ?? m[2] ?? m[3] ?? ''),
  );
}

// class name -> the first `file:line` whose `className` names it.
function classSites(sources) {
  const sites = new Map();
  for (const { file, code } of sources) {
    for (const m of code.matchAll(/className=/g)) {
      const at = `${file}:${lineOf(code, m.index)}`;
      for (const cls of classNameTokens(code, m.index)) if (!sites.has(cls)) sites.set(cls, at);
    }
  }
  return sites;
}

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
    .filter((file) => file !== PRIMITIVES)
    .flatMap((file) => rulesOf(file, readFileSync(join(ROOT, file), 'utf8'))),
);

const primitiveClasses = new Set(
  shapedRules(rulesOf(PRIMITIVES, readFileSync(join(ROOT, PRIMITIVES), 'utf8'))).flatMap((rule) =>
    classesOf(rule.selector),
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
const onChip = new Set([...tagClasses(sources, CHIP_TAG)].filter((cls) => !primitiveClasses.has(cls)));
const controls = tsxFiles.flatMap(({ file, text }) => controlsIn(file, text));
const rawControls = controls.filter((c) => !c.inField);

const adoption = new Map(
  ADOPTION.map(({ shape, tags }) => [
    shape,
    tags.reduce((n, tag) => n + [...allCode.matchAll(new RegExp(`${tag}(?![\\w-])`, 'g'))].length, 0),
  ]),
);

console.log(
  `shape coverage: ${cssRules.length} rule(s) outside ${PRIMITIVES}, ${controls.length} literal control(s) in ${tsxFiles.length} .tsx file(s)`,
);

// Before any finding is printed, because a green run on a pattern that matched nothing is the worse
// failure — the same order `check-radius-scale.mjs` prints in, and for the same reason.
const parserFault = cssSelfTest() ?? controlSelfTest() ?? siteSelfTest();
if (parserFault) {
  console.error(`\nthe parser is broken: ${parserFault}.`);
  console.error(`A census here is vacuous — it would report zero findings whatever the tree holds. Fix the`);
  console.error(`pattern in tools/check-shape-coverage.mjs; do NOT relax the fixture.`);
  process.exit(1);
}

let failed = false;

function report(shape, ceiling, phase, lines) {
  const adopted = adoption.get(shape) ?? 0;
  const head = `${shape}-shaped: ${lines.length} hand-rolled against ${adopted} primitive call site(s)`;
  if (lines.length > ceiling) {
    console.error(`\n${head}, against a ceiling of ${ceiling}. This census is a RATCHET: it blocks an`);
    console.error(`increase, not the backlog — ${phase} drives it down. Render the new one with the`);
    console.error(`primitive in web/src/ui/ instead of declaring the shape again.\n`);
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

report(
  'control',
  CONTROL_CEILING,
  'Phase 9',
  rawControls.map((c) => `${c.site} <${c.tag}> — not inside a <Field>`),
);

if (failed) process.exit(1);

console.log(
  `all four shape censuses are at or under their ceilings; ${controls.length - rawControls.length} of ${controls.length} control(s) are in a Field`,
);
