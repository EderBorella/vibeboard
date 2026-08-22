#!/usr/bin/env node
//
// Two claims about the CLASS SELECTORS in every stylesheet under web/src.
//
//   1. Every one of them is referenced from web/src — literally, or through a class name composed at
//      run time from a prefix and a value. BLOCKING at zero.
//   2. How many there are, against a ratchet. BLOCKING on any increase. The target is 183.
//
// A NAIVE IMPLEMENTATION OF CLAIM 1 DELETES LIVE CODE, and this is the check docs/design-system.md's
// *Risks* section was written to stop being written badly. Classes are named nowhere as literals when
// they are built from a prefix and a value: `` `msg-${it.kind}` `` makes the chat bubbles, and
// `` `vb-tone-${tone}` `` makes the five state colours the whole app shares. A literal grep finds none of
// them — and deleting them breaks the state colours ONLY in the states a person sees when something has
// already gone wrong. A board that has not failed anything looks perfectly correct; the colour that says
// a run halted is the one that has gone. Nothing in the suite would catch it either: the browser harness
// measures a board in one state, and every React test runs in jsdom.
//
// `ap-bar-{running,halted,complete,stopped}` was the other half of that sentence until Phase 13, which
// deleted all four: the bar's rail takes `--tone` from the one table now. `vb-chip-${tone}` and
// `vb-dot-${tone}` went the same way, so three composing prefixes became one.
//
// SO COMPOSITION IS RESOLVED RATHER THAN ALLOWED FOR. The document offers two implementations — resolve
// the template literals, or keep an explicit allow-list of prefixes with the composing `file:line`
// beside each — and says of the second that it is "the cheaper of the two and the one that rots: it needs
// its own check that every prefix in it still has a composing call site, or it becomes a licence to keep
// dead classes". This is the first, which cannot rot for a structural reason: both halves of a composed
// name are read out of the source, so a prefix whose call site is deleted stops resolving anything and
// its classes go back to being findings.
//
// A class is REFERENCED when either:
//   (a) its name occurs as a whole token in web/src/**/*.{ts,tsx} — comments stripped, so a class named
//       only in a comment is dead. Several comments in this repository name classes they have just
//       removed, which is exactly the case that must not count as a reference; or
//   (b) it is `prefix` + `suffix`, where `` `prefix-${` `` appears in a template literal in the code and
//       `suffix` appears as a quoted string token somewhere in the corpus. Both halves have to be real:
//       `ap-bar-running` resolves because `` `ap-bar-${model.tone}` `` is at AutopilotBar.tsx and
//       `'running'` is a member of AUTOPILOT_STATES, while `ap-bar-runningx` resolves as neither.
//
// WHAT IT DELIBERATELY DOES NOT CATCH: a class that is referenced but dead — a `className` on an element
// that never renders. That is a different claim needing a different instrument, and the harness's element
// census is the closest thing to it.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classesOf, rulesOf, shapedRules } from './lib/css.mjs';
import { codeOf, lineOf, walk as walkFiles } from './lib/source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = 'web/src';
// EVERY SHEET IN THE CORPUS, DISCOVERED RATHER THAN LISTED. It was the two names `styles.css` and
// `ui/primitives.css`; the split made those 48 files, and a hand-written list of 48 is a list that goes
// stale the first time a phase adds a layer sheet — which would drop its classes out of the count
// silently, and the count is a ratchet. The list below is the opposite direction and is safe for it: it
// only SPLITS a total that is already discovered, so a sheet missing from it lands in the other column.
// Documentary here — the ratchet is on the UNION — but the split of the count into "what the shared
// layer names" and "what the surfaces name between them" is the pair the record quotes.
// THIRTEEN SHEETS AND NOT SEVEN AS OF THE MOLECULE LAYER, and `ui/primitives.css` is not among them
// because it no longer exists: what was left of it — the tone table, the pip, the status chip, the
// segmented control, the field, the select trigger and the notice — WAS the molecule layer, and it is
// seven sheets beside the six atoms now. Reading only the atoms would have moved 29 classes into the
// surfaces' column overnight, which is the same mistake the atom phase caught one layer down.
const PRIMITIVE_LAYER = [
  ...['button', 'chip', 'control', 'readout', 'surface', 'text'].map((name) =>
    join('web', 'src', 'atoms', `${name}.css`),
  ),
  ...['tones', 'status-chip', 'tabs', 'menu', 'field', 'notice', 'figure-row'].map((name) =>
    join('web', 'src', 'molecules', `${name}.css`),
  ),
];

// THE RATCHET, and the number is what the tree holds today rather than what the plan wants. The sweep
// took the union from 443 to this; the target is **183** and it is not reached.
//
// WHERE THE REST IS, MEASURED AND STATED HERE RATHER THAN CITED. 341 today — the 13-sheet primitive layer
// 58, the surfaces 294, 11 in both. The deletions still named ahead are `Modal` 23 → 5 and `List`/`Row`
// ~35 → 5, about −48, which lands near **293 against 183**: roughly 110 classes are not accounted for by
// any named deletion, and that is the owner's to see rather than a gate's to hide.
// The pointer this paragraph used to carry was FALSE, which is why the number is inline now:
// `docs/design-system.md`'s own "Phase 5" is an earlier and different phase, it still lists
// `SegmentedControl` as live and it still reports 457 class selectors. That document is rewritten as the
// work closes; until then the only number that is true is the one this gate prints.
//
// THE TARGET IS 183 AND NOT THE PLAN'S "UNDER 150", which is withdrawn. 150 was derived from ten bespoke
// surfaces at about eight layout classes each plus roughly thirty primitive classes, and neither term was
// counted: the tree holds **17** surfaces (16 feature directories under web/src besides ui/ and api/, plus
// markdown.tsx) and **47** primitive classes. At the plan's own allowance that is 17 × 8 + 47 = 183, so
// 150 was not merely missed — it was excluded by the arithmetic it was derived from. The derivation and
// its commands are in docs/design-system.md under *Under 150 is WITHDRAWN*.
//
// A CEILING AND NOT THE TARGET, deliberately: a blocking gate pointed at a backlog has to be bypassed on
// every commit, which teaches everyone to ignore it — the same argument that kept radius conformance
// reporting until Phase 3 drove it to zero. Lower this as the sweep continues; the commit that reaches
// 183 is the commit that sets it to 183 and deletes this paragraph. NEVER raise it.
// 377 before Phase 9, 375 after it, measured: three classes died in styles.css — `.theme-select`,
// `.mp-prov` and `.link-option` — and `.vb-field-check` was added to primitives.css. The other eight
// control classes the phase touched survive with a declaration only the surface can make, which is the
// same result Phase 3 measured on its 27 and Phase 8 on its nine.
// 375 before Phase 12, 374 after it: `.msg-tool` died — a tool name is a `Readout` `small` `accent`, and
// the rule was that primitive written out by hand.
// 374 before Phase 13, 364 after it, and it is the largest single drop of the sweep. Fifteen died:
// `.ap-bar-{running,halted,complete,stopped}` (the rail is one declaration reading `--tone`),
// `.vb-chip-{neutral,accent,ok,warn,bad}` and `.vb-dot-{neutral,accent,ok,warn,bad}` (ten rules that
// each named a token, replaced by five that name it once), and `.msg-error` (a state's colour picked on
// a surface). Five arrived: `.vb-tone-*`, which IS the table. Plus `.vb-chip-tone` and `.vb-dot-glow`,
// and `.ok`/`.down` off `.copilot-status` — the fifth mechanism, which no census had counted.
// 364 before the status-indicator merge, 362 after it. Seven died — `.conn-status`'s box kept the class
// but `.conn` went with it, and `.conn-pop-{head,detail,next}` plus `.ap-agent-{heading,detail,next}` were
// two copies of one balloon; `.ap-agent-state` went too, with the `button.` qualifier that undid the UA
// styles by hand. Five arrived: `.vb-status`, `.vb-status-{head,detail,next}` — the one copy — and
// `.vb-twist`, which is a font-size for six disclosure glyphs drawn at the chip step. Plus
// `.copilot-authority`, a row that had never had a class and therefore never had the gutter its six
// siblings all have.
// 362 before the owner's second pass, 361 after it: `.ap-transport` lost its whole rule — a `min-width`
// that measured 104px around 49px of ink — and `.ap-chip` moved from the top bar to the auto-pilot bar's
// own chip rather than being added again.
// 361 before the ATOM LAYER, 354 after it, and the arithmetic is 20 out against 13 in:
//   OUT (20)  `.vb-readout-{small,body,plain,accent,accent2,text,quiet}` — a Readout is a TREATMENT and
//             takes the step and the ink of the atom it sits in, so nine classes are one;
//             `.vb-label`, `.vb-label-caps`, `.vb-hint`, `.vb-error`, `.vb-empty`, `.vb-empty-small` —
//             six names for one face times three options, and the last of the six was the fifth
//             declaration for declaration; `.vb-label-rail`, `.vb-input` and the five `.vb-panel*`,
//             which are renames rather than deletions.
//   IN (13)   `.vb-text` + four modifiers; `.vb-ctl` and `.vb-ctl-mono`; `.vb-field-rail`; the five
//             `.vb-surface*`. Nine of the thirteen are the renames' other half.
// The renames net to zero on purpose and are worth their churn for one reason: one vocabulary, one word
// per thing. `Panel` meant six things in this tree and `.vb-input` named a class that is now a component.
// 354 before the MOLECULE LAYER, 341 after it, and the arithmetic is 21 out against 8 in:
//   OUT (21)  the six families' nineteen — `.tab-btn` `.tab-badge` `.topbar-tabs`, `.chat-menu` and its
//             four, `.dock-tab` `.dock-strip`, `.cards-tab` `.cards-tab-label` `.cards-tab-x`,
//             `.control-tabs` and `.vb-seg` `.vb-seg-cell` `.vb-seg-cell-sm` — minus `.cards-tabs`, which
//             SURVIVES as two declarations no other tab strip has (it is the only one that scrolls and the
//             only one with a rule under it); plus three the plan did not name: `.vb-dot-7`, `.vb-dot-8`
//             and `.vb-dot-12`, because `Dot` had three sizes and exactly ONE consumer, and
//             `.vb-trigger-label`, which is a rename.
//   IN (8)    `.vb-tabs` `.vb-tabs-grouped` `.vb-tab`; `.vb-menu` `.vb-menu-list` `.vb-menu-item`
//             `.vb-menu-backdrop`; `.vb-clip`, which is `.vb-trigger-label`'s other half and now serves
//             three molecules rather than one.
// SIX FACES, SIX SELECTED STATES AND SIX HEIGHTS BECAME TWO COMPONENTS AND SEVEN CLASSES. `.active` is
// not counted here in either direction: it is one name for the whole app and it survives on the toggles.
const CLASS_CEILING = 341;
const CLASS_TARGET = 183;

// Anti-vacuity floor on the SELECTOR PARSER, not on the class count: a regex that stops matching reports
// zero findings, exits 0 and looks exactly like success. This one is safe from the trap Phase 3's button
// floor fell into (a floor that fails the run for succeeding) because it is far below the target the
// sweep is driving towards — 183 classes is the goal and 40 is a broken parser.
const PARSE_FLOOR = 40;

// The walk, the line counter and the comment blanker are `tools/lib/source.mjs`; the rule scanner and
// the selector reader are `tools/lib/css.mjs`. One copy each — see that file's header.
// A SMOKE ALARM, NOT A TARGET: 50 css files and a hundred components, floored an order of magnitude
// below each so deleting a file never fails the run. See walk() in lib/source.mjs for why it is here.
const FLOOR = { '.css': 2, '.ts': 10, '.tsx': 20 };
const walk = (ext) => walkFiles(ROOT, CORPUS, ext, FLOOR[ext] ?? 1);

// THE METHOD IS THE DOCUMENT'S, and it has to be: three different answers have been quoted for this
// property, and a target expressed against a number nobody can reproduce is not a target. Strip
// comments, take the selector text before each `{`, skip at-rule preludes, extract every `.name` token,
// count the DISTINCT names — and the union across every stylesheet, because `vb-btn` and `vb-dot` are
// named by the surfaces too.
export function classesIn(css) {
  // `rulesOf` is the brace matcher, `shapedRules` drops the at-rule preludes and `classesOf` reads the
  // `.name` tokens — the same three the other gates use, so a selector this file counts is a selector
  // they see. The file name is documentary here: nothing in the returned set carries it.
  const names = new Set();
  for (const rule of shapedRules(rulesOf('sheet.css', css)))
    for (const cls of classesOf(rule.selector)) names.add(cls);
  return names;
}

// `prefix-${` inside a template literal: the left-hand half of a composed class name.
export function prefixesOf(code) {
  return [...code.matchAll(/([\w-]*[a-z\d])-\$\{/g)].map((m) => m[1]);
}

// Every quoted string token in the corpus: the right-hand half. A tone, a state, a kind, a backend name —
// whatever the value is, it has to be written down somewhere for the composition to produce it.
export function vocabularyOf(code) {
  const out = new Set();
  for (const m of code.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)) {
    for (const word of (m[1] ?? m[2] ?? '').split(/[\s|,]+/)) if (word) out.add(word);
  }
  // NUMBERS TOO, and they were not a widening for convenience: `Dot`'s size was a `7 | 8 | 12` union, so
  // `` `vb-dot-${size}` `` composed three real classes out of values that are numeric literals rather
  // than quoted strings, and leaving them out reported all three as dead — the exact defect this check
  // exists to prevent, produced by the check itself.
  // THAT CONSUMER IS GONE AS OF THE MOLECULE LAYER: `StatusChip` absorbed the pip, one size is left and
  // `.vb-dot` is a literal. Measured: with this clause removed the census still reports zero
  // unreferenced classes. It stays because a numerically composed name is a real shape and the cost of
  // being wrong about it is a deleted rule, not a missed finding — but it has no consumer today, which is
  // stated here so the next reader is not looking for one.
  for (const m of code.matchAll(/(?<![\w-])\d+(?![\w-])/g)) out.add(m[0]);
  return out;
}

function corpus() {
  return walk('.ts')
    .concat(walk('.tsx'))
    .map((file) => ({ file, code: codeOf(readFileSync(join(ROOT, file), 'utf8')) }));
}

// THE PARSER SELF-TEST, and it goes through the same functions the census does — the lesson from
// check-radius-scale.mjs, whose first self-test carried its own regex and so had no opinion about the
// code under test at all. A fixture the tree cannot move: one literal class, one composed from a prefix
// and a quoted value, one composed from a prefix whose value is written nowhere, and one named only in a
// comment.
const FIXTURE_CSS = `
/* .commented-only { color: red } */
.alpha { color: red }
.beta-ok, .beta-nope { color: red }
@media (min-width: 1px) { .gamma { color: red } }
`;
const FIXTURE_CODE = `
// .commented-only is named here and nowhere else, so it is DEAD.
const kinds = ['ok'];
const a = <div className="alpha" />;
const b = <div className={\`beta-\${kind}\`} />;
const c = <div className="gamma" />;
`;

function selfTest() {
  const names = [...classesIn(FIXTURE_CSS)].sort().join(',');
  if (names !== 'alpha,beta-nope,beta-ok,gamma') return `selector parse: got [${names}]`;
  const code = codeOf(FIXTURE_CODE);
  if (/commented-only/.test(code)) return 'comment stripping: a commented class survived';
  const prefixes = prefixesOf(code);
  if (!prefixes.includes('beta')) return `prefix parse: got [${prefixes.join(',')}]`;
  const vocabulary = vocabularyOf(code);
  if (!vocabulary.has('ok')) return 'vocabulary parse: a quoted value was not found';
  const dead = [...classesIn(FIXTURE_CSS)].filter(
    (cls) => !referenced(cls, [{ file: 'fixture', code }], prefixes, vocabulary),
  );
  // `beta-nope` is the one that must be a finding: the prefix is composed and the suffix is not written
  // anywhere, which is exactly the shape of a renamed dynamic class. `commented-only` is not in the CSS
  // fixture's rules at all (it is inside a comment there too), so it cannot be one.
  if (dead.join(',') !== 'beta-nope') return `resolution: findings were [${dead.join(',')}]`;
  return null;
}

function referenced(cls, sources, prefixes, vocabulary) {
  const token = new RegExp(`(?<![\\w-])${cls.replace(/-/g, '\\-')}(?![\\w-])`);
  if (sources.some(({ code }) => token.test(code))) return true;
  return prefixes.some(
    (prefix) => cls.startsWith(`${prefix}-`) && vocabulary.has(cls.slice(prefix.length + 1)),
  );
}

const sources = corpus();
const allCode = sources.map((s) => s.code).join('\n');
const prefixes = [...new Set(prefixesOf(allCode))];
const vocabulary = vocabularyOf(allCode);

const perSheet = walk('.css').map((file) => ({
  file,
  names: classesIn(readFileSync(join(ROOT, file), 'utf8')),
}));
const union = new Set(perSheet.flatMap(({ names }) => [...names]));
// The two numbers the record quotes, and they are still the two that mean something: what the primitives
// name, and what the surfaces name between them. Printing 48 per-file counts would bury both.
const primitives = new Set(
  perSheet.filter(({ file }) => PRIMITIVE_LAYER.includes(file)).flatMap(({ names }) => [...names]),
);
const surfaces = new Set(
  perSheet.filter(({ file }) => !PRIMITIVE_LAYER.includes(file)).flatMap(({ names }) => [...names]),
);

// Where each dynamic prefix is composed, so a failing run can be read against the source rather than
// against this file's opinion of it.
const sites = new Map();
for (const { file, code } of sources) {
  for (const m of code.matchAll(/([\w-]*[a-z\d])-\$\{/g)) {
    if (!sites.has(m[1])) sites.set(m[1], `${file}:${lineOf(code, m.index)}`);
  }
}

const unreferenced = [...union].filter((cls) => !referenced(cls, sources, prefixes, vocabulary)).sort();

console.log(
  `class budget: ${union.size} distinct class selector(s) across ${perSheet.length} sheet(s) — ` +
    `the ${PRIMITIVE_LAYER.length}-sheet primitive layer ${primitives.size}, the surfaces ${surfaces.size}`,
);
console.log(
  `dynamic composition: ${prefixes.length} prefix(es) resolved against ${vocabulary.size} quoted value(s) — ${[
    ...sites,
  ]
    .map(([prefix, site]) => `${prefix}-* (${site})`)
    .join(', ')}`,
);

if (union.size < PARSE_FLOOR) {
  console.error(`\nonly ${union.size} class selector(s) found, against a floor of ${PARSE_FLOOR}.`);
  console.error(`This check is vacuous: the selector parser has stopped matching the stylesheets. Fix it`);
  console.error(`in tools/check-class-budget.mjs — do NOT lower the floor.`);
  process.exit(1);
}

const parserFault = selfTest();
if (parserFault) {
  console.error(`\nthe class parser is broken: ${parserFault}.`);
  console.error(`Both claims are vacuous — they would report nothing whatever the tree holds. Fix the`);
  console.error(`pattern in tools/check-class-budget.mjs; do NOT relax the fixture.`);
  process.exit(1);
}

let failed = false;

if (unreferenced.length > 0) {
  console.error(`\n${unreferenced.length} class selector(s) referenced from nowhere in ${CORPUS}:\n`);
  for (const cls of unreferenced) console.error(`  .${cls}`);
  console.error(`\nEither delete the rule, or — if the name is COMPOSED at run time — check that the`);
  console.error(`prefix is still built in a template literal and that the value is still written as a`);
  console.error(`string somewhere. Both halves are read from the source; neither is allow-listed.`);
  failed = true;
}

if (union.size > CLASS_CEILING) {
  console.error(`\n${union.size} class selectors, against a ceiling of ${CLASS_CEILING}.`);
  console.error(`This gate is a RATCHET: it blocks an increase, not the backlog. The target is`);
  console.error(`${CLASS_TARGET} — see docs/design-system.md. Merge the new shape into an atom in`);
  console.error(`web/src/atoms/ or a molecule in web/src/molecules/ instead of giving a surface a`);
  console.error(`class of its own.`);
  failed = true;
}

if (failed) process.exit(1);

console.log(`every class is referenced; ${union.size}/${CLASS_CEILING} against a target of ${CLASS_TARGET}`);
