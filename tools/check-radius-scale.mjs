#!/usr/bin/env node
//
// Two claims about the FILES, both of them things the browser harness cannot make.
//
//   1. Every `border-radius` authored in web/src/*.css is one of the four steps of the radius scale,
//      or `50%`. BLOCKING at zero.
//   2. No rule outside the primitive LAYER declares `border-radius`, `padding`, `font-size`, `height` or
//      `min-height` for a class that is rendered on a `<button>`. A RATCHET, not zero — see below.
//
// WHY THIS EXISTS BESIDE `npm run visual`, WHICH ALREADY ASSERTS THE FIRST ONE.
//
// It does not assert the same thing, and Phase 2 proved the gap by planting a defect: `0.81rem` on
// `.exec-head`, an Execution-tab-only rule, made `npm run check:scale` exit 1 while `npm run
// visual` exited 0 on the same tree. The harness measures the BOARD — 232 elements, six radius values
// — and the stylesheet authors radii on the Execution tab, in settings, in drawers, in card panes and
// in the copilot's message bubbles, none of which the board view opens. Before Phase 3 the file held
// eight distinct values and the board computed six; a browser gate alone would have passed with the
// other two still in the file.
//
// So the two gates make different claims and both are needed:
//   the harness  — "nothing the eye can reach on the board is off the scale", including a radius no
//                  rule authored.
//   this check   — "nothing in the FILE is off the scale", including surfaces no test opens.
//
// CLAIM 2 IS A RATCHET AND NOT ZERO, DELIBERATELY, and saying so plainly is the point. 56 classes are
// rendered on a `<button>` and declare their own geometry; Phase 3 converts the ones the plan names
// and the ones the dynamic-class work touches, which is not all of them. A blocking gate pointed at
// the remainder would have to be bypassed on every commit, which teaches everyone to ignore it — so
// it reports the full list, blocks any INCREASE, and the number below is what it was on the day the
// primitives landed. Drive it down; never raise it.
//
// WHAT CLAIM 2 CATCHES: a `<button className="x">`, a `<Button className="x">` or a
// `<Surface as="button" className="x">` in a .tsx file whose class `x` is given a `border-radius`, a
// `padding` (or `padding-top`, `-right`, `-bottom`, `-left`) or a `font-size` by any rule in a
// stylesheet other than the primitive one.
// WHAT IT DOES NOT CATCH, and none of these is hypothetical:
//   - a class reaching a button through a variable or a helper, rather than as a literal in the
//     element's own `className`. It reads the attribute text, not the render — which is why
//     `.confirm-go`, whose class arrives through a ternary, never appeared in the census.
//   - geometry applied by a selector that never names the class — `.dock-strip > button`,
//     `.copilot-actions button`, `button, input, select, textarea`. Element-selector rules are
//     invisible to it, and `.copilot-actions button` really is one of them.
//   - anything about an `<a>`, a `<div role="button">` or an `<input type="submit">`.
// The `<Button className>` hole USED to be on this list, and reading `<Button>` closed it — see the
// comment on TAGS. It was not hypothetical either: it opened up the moment 27 classes migrated;
// `<Surface as="button">` is the same hole reopened by Phase 4, and `<Row as="button">` the same hole
// reopened by Phase 6 — each closed one commit late, which is the pattern worth reading the TAGS note for.
// It is a real subset of "no rule outside the primitive block declares geometry for a button-shaped
// element", stated so nobody mistakes it for the whole.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rulesOf, shapedRules } from './lib/css.mjs';
import { openTagsOf } from './lib/jsx.mjs';
import { walk as walkFiles } from './lib/source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = 'web/src';
// The radius scale is geometry, so it lives in design/tokens.css rather than in design/themes.css —
// the split the atomic revamp's Phase 1 made structural and `check:tokens` keeps. See
// docs/design-system.md, *The atomic revamp: the radius scale*.
const TOKENS_FILE = 'web/src/design/tokens.css';
// FIFTEEN SHEETS AS OF THE ORGANISM LAYER, and the two that joined are `Modal`'s and `List`/`Row`'s.
// `organisms/shared/` is the SHARED layer by construction — the atomic revamp puts three components there
// "because ≥4 surfaces each built one by hand", and `check-layers.mjs` has read it as an OPEN layer since
// the split. A `Row` rendered as a `<button>` declares a padding for the same reason a `Tabs` cell does:
// nineteen surfaces stop doing it. `organisms/shared/shared.css` is NOT among them — it is the two
// CALLERS that live in that directory (the picker's filters, the confirm's danger button), which are
// surfaces like any other. Same distinction the note below draws about `atoms/prose.css`.
//
// THE PRIMITIVE LAYER WAS THIRTEEN SHEETS. `ui/primitives.css` was the only place a button's
// geometry could be decided; the atom phase gave each of the six atoms its own file, and the molecule
// phase dissolved what was left of that file into seven — the tone table, the pip and its chip, `Tabs`,
// `Menu`, the field and its trigger, and the notice. A `Tabs` cell IS a button and declares a padding, a
// step and a height, which is exactly what this claim refuses OUTSIDE this layer: the whole point of the
// merge is that six surfaces stop doing it.
// LISTED AND NOT A DIRECTORY GLOB, twice over: `web/src/atoms/prose.css` is the markdown SURFACE, and
// `web/src/molecules/popover.css` holds surface rules of its own — a glob over either directory would
// have excused them. (`molecules/inline-field.css` stood in this sentence and has not existed since the
// organism phase folded it into `field.css`; a gate naming a file nobody can open is a gate nobody
// checks.)
const ATOM_SHEETS = ['button', 'chip', 'control', 'readout', 'surface', 'text', 'stack'].map((name) =>
  join('web', 'src', 'atoms', `${name}.css`),
);
const MOLECULE_SHEETS = ['tones', 'status-chip', 'tabs', 'menu', 'field', 'notice', 'figure-row'].map(
  (name) => join('web', 'src', 'molecules', `${name}.css`),
);
const SHARED_ORGANISM_SHEETS = ['modal', 'list'].map((name) =>
  join('web', 'src', 'organisms', 'shared', `${name}.css`),
);
const PRIMITIVE_LAYER = new Set([...ATOM_SHEETS, ...MOLECULE_SHEETS, ...SHARED_ORGANISM_SHEETS]);
const RADIUS_SCALE = ['--r-sm', '--r-md', '--r-lg', '--r-pill'];

// A VALUE MAY BE OFF THE SCALE ON PURPOSE, and then it is written here with its reason rather than
// left to be rediscovered.
/** @type {Map<string, string>} */
const OFF_SCALE_ON_PURPOSE = new Map([
  [
    '50%',
    "A CIRCLE, and it cannot be expressed as a length without knowing the box width — `--r-pill`'s " +
      '999px would be a claim about a stadium. Owned by the Dot primitive, and as of Phase 8 the ONLY ' +
      'consumer: `.copilot-status .status-dot` was the last hand-rolled one and it is a `Dot`. ' +
      "`check-shape-coverage.mjs`'s dot census now blocks a new one at zero.",
  ],
]);

// THERE ARE NO COUNT FLOORS HERE AT ALL ANY MORE, and both removals were forced rather than chosen.
//
// A REGEX THAT STOPS MATCHING IS STILL THE FAILURE MODE OF A CHECK LIKE THIS: it reports zero findings,
// exits 0, and looks exactly like success. A count floor is the wrong instrument for it, twice over.
//
// The BUTTON-CLASS floor went first. It was 30 against a population of 50, and Phase 3's migration took
// the population to 23 — so a floor that was doing its job failed the run for SUCCEEDING.
//
// The RADIUS floor went the same way, and it had already fired. It was 60 against 65 declarations when
// Phase 5's sweep began; the segmented-control merge took the tree to **59**, and the run failed saying
// *"only 59 border-radius found, against a floor of 60. This check is vacuous"* about a check that was
// working perfectly and had just been given less work to do. `tools/check-scale.mjs` had its own
// version of this five away from firing and lost its floors in the same commit.
//
// The flaw is structural in both cases: every count this file measures SHRINKS as the sweep succeeds,
// which is the goal, so any floor on any of them must eventually be bypassed or deleted. Their
// replacement is `parserSelfTest` below, which asserts every pattern against a fixture the tree cannot
// move — it works identically at 65 declarations and at 5. Do NOT put a count floor back.

// WHAT CLAIM 2 STANDS AT. 56 before Phase 3; 46 when the primitives landed; 22 after that adoption was
// finished; 13 after Phase 4 gave the list rows a `Surface`; **8** after Phase 5b, which is the number
// here. The five that went in 5b:
//   `.chat-current` `.mp-trigger` — the two select triggers, now `.vb-trigger`: they were `.vb-ctl`'s
//                      box with a caret, which is what this file called them for two phases running.
//   `.bt-btn` `.mode-btn` — the segmented cells, now `.vb-seg-cell`. They were identical declaration for
//                      declaration apart from one size step, and `.backend-toggle-md .bt-btn` restated
//                      `.mode-btn`'s padding and font-size verbatim.
//   `.archive-title` — NOT migrated to `Surface`, and it left the census for a different reason: its only
//                      geometry declaration was `font-size: var(--t-body)`, which is what `body` already
//                      gives it. A dead declaration, the same one Phase 4 found on `.cv-link`.
//
// The 8 that remain are THREE kinds and none of the reasons is "it has its own padding":
//   `.board-archive` `.mp-chip` `.tag` `.tag-chip` — chips. `Chip` owns that box; every Panel variant
//                      is a rectangle with a corner, and a pill is not.
//   `.board-label` — a section header. Panel's header slot is a bordered row INSIDE a panel; this is a
//                      collapsible heading ABOVE one, with a 3px accent left edge.
//   `.cards-tab-label` `.dock-tab` `.tab-btn` — tabs, and Phase 5b measured them and did NOT build a
//                      `Tabs`. `.cards-tab-label` is not a tab at all — it is the ellipsised label inside
//                      one, with `border: none` and no corner — and the two real tabs disagree on the two
//                      things a tab primitive would have to own: the face (`.tab-btn` is not uppercase,
//                      `.dock-tab` is — the tracking stopped disagreeing once both took `--track`) and
//                      the selected state
//                      (`.tab-btn` goes accent with a `--glow`, `.dock-tab` goes `--text` with none).
//                      Two consumers disagreeing on both of a primitive's decisions is a primitive that
//                      would carry one variant each, which is a name that decides nothing.
//
// The 24 that went in Phase 3's second pass were `.btn-primary`, The 24 that went in that second pass are `.btn-primary`,
// `.btn-secondary` and `.btn-danger` (37 call sites between them, and exactly `primary`, `default` and
// `danger` at `md` under their old names), `.archive-restore`, `.confirm-cancel`, `.chat-new`,
// `.cards-raw`, `.copilot-reset`, `.cs-action`, `.dispatch-back`, `.option-btn`, `.switch-btn`, and the
// twelve bare glyph buttons that became `Button`'s fifth variant — `.modal-close`, `.mp-modal-close`,
// `.cards-tab-x`, `.res-del`, `.chat-del`, `.tile-archive`, `.column-add`, `.control-new`, `.mp-star`,
// `.dock-collapse`, `.tag-filter-clear`, `.cv-link-edit`.
//
// 8 BEFORE THE ATOM PHASE, 4 AFTER IT, **1 AFTER THE MOLECULE LAYER**, and the three that went are the
// three tab faces this file has named as tabs for two phases running:
//   `.tab-btn`          — a `Menu` item. The five destinations were the one family that changes the whole
//                         screen, so they left through `Menu` rather than through `Tabs`; it is the same
//                         class either way.
//   `.dock-tab`         — a `Tabs` cell, and its selected state is the one that survived the merge of
//                         four. Its uppercase did not.
//   `.cards-tab-label`  — never a tab at all: it was the ellipsised LABEL inside one, with `border: none`
//                         and no corner. It is `.vb-clip` inside a `.vb-tab` now, which is the same three
//                         overflow declarations said once for three molecules.
// The refusal Phase 5b recorded here — "two consumers disagreeing on both of a primitive's decisions is a
// primitive that would carry one variant each" — is REVERSED, and on evidence rather than taste: there
// were never two consumers, there were SIX. The argument is docs/design-system.md, *The atomic revamp:
// `Tabs` and `Menu` overturn a twice-taken refusal*, which is written beside the refusal it reverses.
// **0 AFTER THE ORGANISM LAYER**, and `.board-label` is what went. It was "a collapsible section heading
// with a 3px accent left edge", and it is a `Row rail="accent" interactive` on a `Surface flat` now: the
// rail is `--rule` × `--tone`, the padding is the variant's and the pointer is `.vb-row-hit`'s. What is
// left of the class is a FACE with no geometry in it at all — `--font-display`, `text-transform` and
// `--track` — because its `font-size: var(--t-body)` was the value `body` already gives it, which is the
// fifth dead declaration this sweep has found (after `.cv-link`, `.archive-title`, `.mp-prov` and
// `.link-option`).
// AT ZERO IT IS NO LONGER A RATCHET BUT A CLAIM, which is the point: the next surface that gives a
// button-shaped class a padding fails the run rather than raising a number.
// NEVER raise this: a ratchet that moves the wrong way is a gate switched off in place.
const BUTTON_GEOMETRY_CEILING = 0;

// `height` AND `min-height` JOINED THIS LIST IN THE ATOM PHASE, and the same four classes are in the
// census before and after — the tab and label faces the plan deliberately does NOT patch, because it
// deletes them in Phases 5 and 6 — so the ratchet did not move. Which is exactly why
// `check-box-scale.mjs` is a separate file: this instrument is a count of CLASSES, and adding a property
// to a class it already counts changes no count.
const GEOMETRY = [
  'border-radius',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-size',
  'height',
  'min-height',
];

// `tools/lib/source.mjs` owns the walk, the line counter and the comment blanker; `lib/css.mjs` the
// rule scanner; `lib/jsx.mjs` the opening-tag reader. One copy each, because this file's at-rule
// double-count was a bug fixed in one of the three copies and left in the other two.
// A SMOKE ALARM, NOT A TARGET: two css files and a hundred components, floored an order of magnitude
// below each so deleting a file never fails the run. See walk() in lib/source.mjs for why it is here.
const FLOOR = { '.css': 2, '.ts': 10, '.tsx': 20 };
const walk = (ext) => walkFiles(ROOT, CORPUS, ext, FLOOR[ext] ?? 1);

// The tokens the stylesheet actually defines, so a name can be RESOLVED and not merely recognised:
// `var(--r-mdd)` matches any `--r-*` shape, resolves to nothing, and makes the declaration invalid at
// computed-value time — so the corner silently squares off and the file passes a check that only ever
// read the shape of the name.
const defined = new Set(
  [...readFileSync(join(ROOT, TOKENS_FILE), 'utf8').matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]),
);

// One stylesheet's rules, read through the shared brace matcher in `tools/lib/css.mjs`. Split from it
// so `radiusSelfTest` can scan a FIXTURE through exactly the same parser rather than through a second
// copy of it.
const rules = (file) => rulesOf(file, readFileSync(join(ROOT, file), 'utf8'));

// ---------- claim 1: every authored radius is on the scale ----------
// Its own function so `parserSelfTest` measures it on a fixture. Takes the rules rather than the file,
// because the brace matcher is the other half of what can silently stop matching.
// What is wrong with ONE corner value, or null if nothing is. Its own function because three branches
// inside three loops is what the complexity metric punishes, and the metric punishes nesting far harder
// than length — the same repair `fontSizeFault` is in tools/check-scale.mjs.
function cornerFault(value) {
  if (OFF_SCALE_ON_PURPOSE.has(value)) return null;
  const token = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  if (!token) return `border-radius: ${value} — not a step on the scale`;
  if (!RADIUS_SCALE.includes(token)) return `border-radius: var(${token}) — not one of the four steps`;
  if (!defined.has(token)) return `border-radius: var(${token}) — defined in no stylesheet`;
  return null;
}

// The faults in one whole `border-radius` value. The shorthand takes up to four values — the chat
// bubbles' tail corner is one of them — so each is checked on its own: a single off-scale corner is
// exactly as visible as four.
function shorthandFaults(whole) {
  if (OFF_SCALE_ON_PURPOSE.has(whole)) return [];
  return whole
    .split(/\s+/)
    .map(cornerFault)
    .filter((fault) => fault !== null);
}

function radiiOf(ruleList) {
  /** @type {{ site: string, detail: string }[]} */
  const findings = [];
  let count = 0;
  for (const rule of shapedRules(ruleList)) {
    for (const match of rule.body.matchAll(/border-radius:\s*([^;}]+?)\s*(?=[;}])/g)) {
      count += 1;
      const site = `${rule.file}:${rule.line}`;
      for (const detail of shorthandFaults(match[1].trim())) findings.push({ site, detail });
    }
  }
  return { count, findings };
}

// THE ANTI-VACUITY TEST FOR CLAIM 1, and it replaced a count floor that had just failed the run for
// succeeding — see the note where the floors used to be. It goes through `rulesOf` and `radiiOf`, which
// is the census's own code and not a second copy of the pattern.
//
// The fixture exercises every branch that can silently stop matching: a comment naming a radius in prose
// (which must NOT be a declaration, and which must not shift the line numbers of what follows), the
// compact no-whitespace form a reformatting run produces, the four-value shorthand, `50%` reaching
// OFF_SCALE_ON_PURPOSE, a `--r-*` name that is not a step, and a rule nested inside an at-rule — the case
// a flat regex reads as a selector.
const RADIUS_FIXTURE = `
/* border-radius: 7px named in prose is not a declaration, and neither is padding: 0.4rem. */
.alpha { border-radius: var(--r-md); }
.beta{border-radius:7px;}
.gamma { border-radius: var(--r-lg) var(--r-lg) var(--r-sm) var(--r-lg); }
.delta { border-radius: 50%; }
.epsilon { border-radius: var(--r-nope); }
@media (min-width: 1px) { .zeta { border-radius: 3px; } }
@container vbboards (max-width: 1px) { .eta { border-radius: 2px; } }
`;

// SEVEN DECLARATIONS AND EACH AT-RULE'S ONE REPORTED ONCE, which is the line Phase 10 changed. It read
// `7 declarations` for six with `.zeta`'s `3px` printed TWICE: `rulesOf` did not reset its selector
// cursor at a `{`, so the inner rule read as `@media (min-width: 1px) { .zeta` and the `@media`'s own
// body — which contains every declaration nested in it — was scanned as a rule in its own right. The
// over-report was latent (no `border-radius` in the tree sits inside an at-rule) and the SELECTOR half
// was not harmless at all: a class whose rule sits in an `@media` was invisible to claim 2, because
// every selector test there is anchored on `.name` and that string began with `@`.
//
// TWO AT-RULE KINDS, deliberately: `@media` and `@container` are both in this stylesheet, and a fix
// keyed on the word `media` would pass a fixture that only held the first.
const RADIUS_SELF_TEST_WANT = [
  '7 declarations',
  'fixture.css:4 border-radius: 7px — not a step on the scale',
  'fixture.css:7 border-radius: var(--r-nope) — not one of the four steps',
  'fixture.css:8 border-radius: 3px — not a step on the scale',
  'fixture.css:9 border-radius: 2px — not a step on the scale',
].join(' | ');

function radiusSelfTest() {
  const { count, findings } = radiiOf(rulesOf('fixture.css', RADIUS_FIXTURE));
  const got = [`${count} declarations`, ...findings.map(({ site, detail }) => `${site} ${detail}`)].join(
    ' | ',
  );
  return got === RADIUS_SELF_TEST_WANT
    ? null
    : `radius scan: expected\n  ${RADIUS_SELF_TEST_WANT}\ngot\n  ${got}`;
}

const claim1 = radiiOf(walk('.css').flatMap((file) => rules(file)));
const findings = claim1.findings;
const radiusDecls = claim1.count;

// ---------- claim 2: geometry for a button-shaped class lives in the primitive stylesheet ----------
// Every class that appears as a literal in a `<button>`'s own `className`. A `${...}` hole is skipped:
// that is a composed class, which Phase 3 exists to remove and which this cannot resolve anyway.

// The literal class tokens in one opening tag's `className`. A `${...}` hole is blanked: that is a
// composed class, which Phase 3 exists to remove and which this could not resolve anyway.
function classesIn(attrs) {
  return [...attrs.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].flatMap((m) =>
    (m[1] ?? m[2] ?? '')
      .replace(/\$\{[^}]*\}/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

// THE ANTI-VACUITY TEST, and it is a self-test rather than a count. What can silently break here is the
// PARSER — `/<button\b/`, `openTagEnd`'s brace scan, `classesIn`'s attribute regex — and a broken parser
// reports zero findings and exits 0, which looks exactly like a cleared backlog. A floor on how many
// classes it finds cannot tell those apart once the backlog really is cleared, so this asserts the
// parser against a fixture the tree cannot move: two buttons, one of them with a `>` inside a handler
// (the case a naive `indexOf('>')` truncates) and one with a template literal carrying a `${}` hole.
const FIXTURE = [
  '<button className="alpha beta" onClick={() => x > 1 && go()}>hi</button>',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder IS the fixture — this string is JSX source that `classesIn` must blank a `${}` hole out of, so it cannot be a real template.
  '<Button className={`gamma ${tone} delta`}>hi</Button>',
  // A Panel IS in the population when it says so, and is NOT otherwise. Both directions are in the
  // fixture because the requirement is the part that can silently invert: a predicate that matched
  // nothing would drop `.exec-card` out of the census, and one that matched everything would report
  // `.archive-drawer`'s legitimate padding as a fault.
  '<Surface as="button" variant="flat" className="eta">x</Surface>',
  '<Surface variant="raised" className="theta">x</Surface>',
  // And a `Row`, both directions, because this is the tag whose absence let two plants through a ceiling
  // of zero: a row that is a button is in the population, a row that is an `<li>` is not.
  '<Row as="button" variant="flat" className="kappa">x</Row>',
  '<Row as="li" stack className="lambda">x</Row>',
  // None of these is a button, and a pattern that swept them up would inflate the census.
  '<ButtonRow className="epsilon">x</ButtonRow>',
  '<PanelHead className="iota">x</PanelHead>',
  '<div className="zeta">x</div>',
].join('\n');

// IT MUST GO THROUGH THE SAME FUNCTIONS THE CENSUS USES, and the first version did not: it carried its
// own `/<button\b/` and so had no opinion about `TAGS` at all. Planting `TAGS = ['<buttonXX', …]` made
// the census find 0 classes and 0 findings and exit **0** — the exact vacuous green this test exists to
// refuse, sailing straight past the test meant to refuse it. A self-test that does not call the code
// under test is decoration.
function parserSelfTest() {
  const seen = TAGS.flatMap(({ tag, requires }) => shapedTags(FIXTURE, tag, requires)).flatMap((t) =>
    classesIn(t.attrs),
  );
  const want = 'alpha,beta,gamma,delta,eta,kappa';
  // Not sorted: TAGS' order is part of what is asserted, so `<button`'s two come before `<Button`'s.
  return seen.join(',') === want ? null : `expected [${want}], parsed [${seen.join(',')}]`;
}

// THE POPULATION IS BUTTON-SHAPED ELEMENTS, whatever renders them.
//
// `<Button>` was added in Phase 3 and it was forced rather than chosen: the check read literal
// `<button>` only, so migrating 27 classes onto `<Button className="…">` moved every one of them OUT
// of the population — a `padding` planted on `.cs-action` right after that migration exited **0**. The
// ratchet would have gone on falling while the geometry it counted quietly moved out of sight.
//
// `<Surface as="button">` is Phase 4's version of exactly that hole, and it is qualified rather than
// swept in. A `Surface` is usually a `<div>` or a `<section>`, and one of those may legitimately declare
// its own padding — `.archive-drawer`, `.exec-column` and `.halt` all do, because `Surface`'s `raised`
// variant deliberately has none: a column pads its body and a drawer pads itself. Counting every
// `<Surface>` would therefore report three correct designs as findings, which is how a check earns the
// reputation that gets it switched off. Counting none of them would leave `.exec-card`'s padding free
// to come back through a prop the check cannot see. So the tag carries a REQUIREMENT, read out of the
// same attribute text: a Panel is in the population when it says `as="button"`.
//
// `<Row as="button">` IS PHASE 6'S VERSION OF THE SAME HOLE, AND IT REOPENED IT. The organism phase put
// six rows on `<Row as="button">` — `.board-label` (Board.tsx), `.explorer-item` (FileTree.tsx),
// `.report-open` (CardReports.tsx) and two in ControlFileList.tsx — and none of the three tags above sees
// one, so `padding: var(--s-3) var(--s-5)` planted on `.board-label` and `border-radius: var(--r-md)` on
// `.explorer-item` both exited **0** against a ceiling of zero. The 0/0 below was true; the sentence at
// :180 that the next such padding "fails the run rather than raising a number" was not, for any `<Row>`.
// Qualified the same way and for the same reason: a `Row` is usually an `<li>` or a `<div>`, and a stacked
// row may legitimately pad itself.
//
// Both primitives document `className` as layout-only. This is what makes that documentation a gate.
const TAGS = [
  { tag: '<button', requires: null },
  { tag: '<Button', requires: null },
  { tag: '<Surface', requires: /\bas="button"/ },
  { tag: '<Row', requires: /\bas="button"/ },
];

// Every opening tag of `tag` that also satisfies `requires`, which is how `<Surface as="button">` is
// separated from an ordinary `<Surface>`. Its own function so `parserSelfTest` goes through exactly the
// code the census does — the first version of that test carried its own regex, had no opinion about
// `TAGS` at all, and sailed straight past a broken tag name.
function shapedTags(text, tag, requires) {
  return openTagsOf(text, tag).filter((t) => requires === null || requires.test(t.attrs));
}

function buttonClasses() {
  /** @type {Map<string, string[]>} */
  const found = new Map();
  const tags = walk('.tsx').flatMap((file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    return TAGS.flatMap(({ tag, requires }) => shapedTags(text, tag, requires).map((t) => ({ file, ...t })));
  });
  for (const { file, attrs, line } of tags) {
    for (const cls of classesIn(attrs)) {
      if (!found.has(cls)) found.set(cls, []);
      found.get(cls)?.push(`${file}:${line}`);
    }
  }
  return found;
}

const onButton = buttonClasses();
const cssRules = walk('.css')
  .filter((file) => !PRIMITIVE_LAYER.has(file))
  .flatMap((file) => rules(file));

/** @type {{ cls: string, where: string, sites: string[] }[]} */
const geometry = [];
for (const [cls, sites] of [...onButton].sort()) {
  const named = new RegExp(`\\.${cls.replace(/-/g, '\\-')}(?![\\w-])`);
  const hits = new Set();
  for (const rule of cssRules) {
    if (rule.selector.startsWith('@') || !named.test(rule.selector)) continue;
    for (const prop of GEOMETRY) {
      if (new RegExp(`(?:^|[;{\\s])${prop}\\s*:`).test(rule.body)) {
        hits.add(`${prop} at ${rule.file}:${rule.line}`);
      }
    }
  }
  if (hits.size > 0) geometry.push({ cls, where: [...hits].join(', '), sites });
}

console.log(
  `radius scale: ${radiusDecls} border-radius declaration(s) across ${walk('.css').length} file(s) in ${CORPUS}`,
);
console.log(
  `button geometry: ${onButton.size} class(es) literal on a ${TAGS.map((t) => `${t.tag}${t.requires ? ' as="button"' : ''}`).join(', ')}, ${geometry.length} of them given geometry outside the ${PRIMITIVE_LAYER.size}-sheet primitive layer`,
);

// Before the findings, because a green run on a pattern that matched nothing is the worse failure.
const parserFault = radiusSelfTest() ?? parserSelfTest();
if (parserFault) {
  console.error(`\nthe parser is broken: ${parserFault}.`);
  console.error(`A claim here is vacuous — it would report zero findings whatever the tree holds. Fix the`);
  console.error(`pattern in tools/check-radius-scale.mjs; do NOT relax the fixture.`);
  process.exit(1);
}

let failed = false;

if (findings.length > 0) {
  console.error(`\n${findings.length} border-radius declaration(s) off the scale:\n`);
  for (const { site, detail } of findings) console.error(`  ${site} — ${detail}`);
  console.error(`\nGive each one a step: --r-sm 4px, --r-md 6px, --r-lg 10px, --r-pill 999px; or 50% for`);
  console.error(`a circle. Do NOT add a step — see docs/design-system.md. A value that is off the scale ON`);
  console.error(`PURPOSE goes in OFF_SCALE_ON_PURPOSE with its reason.`);
  failed = true;
}

if (geometry.length > BUTTON_GEOMETRY_CEILING) {
  console.error(
    `\n${geometry.length} button class(es) declare their own geometry outside the primitive stylesheet,`,
  );
  console.error(`against a ceiling of ${BUTTON_GEOMETRY_CEILING}. This gate is a RATCHET: it blocks an`);
  console.error(
    `increase, not the backlog. Render the new control with <Button> from web/src/atoms/Button.tsx`,
  );
  console.error(`instead of giving a class a padding of its own.\n`);
  for (const { cls, where, sites } of geometry) {
    console.error(`  .${cls} — ${where}  (${sites.length} button site(s), e.g. ${sites[0]})`);
  }
  failed = true;
} else if (geometry.length > 0) {
  // Printed on a PASSING run too: a finding list nobody sees is a finding list nobody fixes, and
  // Phases 4 and 5 are the ones that have to fix these.
  console.log(
    `  still hand-rolled (ratchet ${geometry.length}/${BUTTON_GEOMETRY_CEILING}): ${geometry.map((g) => `.${g.cls}`).join(' ')}`,
  );
}

if (failed) process.exit(1);

console.log(
  `all ${radiusDecls} border-radius declarations are one of the ${RADIUS_SCALE.length} steps (or 50%)`,
);
