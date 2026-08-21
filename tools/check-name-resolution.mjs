#!/usr/bin/env node
//
// THE DIRECTION NOTHING READ. Two claims about names, both asked CODE → CSS.
//
//   1. Every class named in a `className` across web/src/**/*.{ts,tsx} is DEFINED by a rule in one of
//      the stylesheets. RATCHET, with the full list printed on a passing run.
//   2. Every custom property a stylesheet REFERENCES is defined by a stylesheet, or supplied at run
//      time by code that names it. BLOCKING AT ZERO.
//
// WHY IT EXISTS, and it is three real defects rather than a hypothesis. `check-class-budget.mjs` asks
// the opposite question — every class in a stylesheet must be referenced from the code — and nothing
// asked this one, so all three of these were found by a person reading the source:
//
//   - `.vb-label-caps` was written at EIGHT call sites and defined by no rule. The tracking and the
//     `text-transform` happened to sit on `.vb-label-rail`, so seven of the eight looked right and
//     DispatchPane's prompt label — a caps label with no rail — rendered in lower case. Found in
//     Phase 5b by eye.
//   - `--ink` was referenced by `.ap-remedy-btn` and defined by no theme. An invalid `var()` falls
//     through to the inherited colour, so the one action on a stalled project rendered the wrong ink
//     for weeks. Found by the browser harness's check 5 — which only sees the surfaces it opens.
//   - `.conn-pop` was passed to `<Popover>` at `ConnectionLight.tsx:50` and no stylesheet in the tree
//     contained the string. Found in Phase 11 writing a characterisation suite, and removed there.
//
// All three have the same shape: a name that resolves to nothing, on a surface where the absence is
// invisible because SOMETHING ELSE is already doing the job. That is why a gate has to ask it.
//
// A NAIVE IMPLEMENTATION IS WRONG IN BOTH DIRECTIONS, and both are handled rather than allowed for.
//
//   COMPOSITION. Seven classes are built from a prefix and a value at twelve call sites, so a composed
//   name has no literal to look up: `` `ap-bar-${model.tone}` `` reads as the token `ap-bar-`, which is
//   no class at all. `check-class-budget.mjs` already resolves that direction and its method is reused
//   here rather than re-derived — a token ending in `-` is a PREFIX, and it is satisfied when the prefix
//   plus SOME value written in the corpus is a class the stylesheets define. Never by prefix MATCH: a
//   `.conn-pop` prefix-matches its own children `.conn-pop-head` and `.conn-pop-detail`, which is
//   exactly how the defect this gate is named after would have gone on hiding.
//
//   LEGITIMATE HOOKS. A `className` can exist so that something can FIND the element rather than so
//   that something can style it. `.column` is read by the visual harness (`.column > .vb-panel-head`)
//   and `.explorer` by both the harness and the React suite (`section.control.explorer`,
//   `.control:not(.explorer)`) — neither has a rule and neither is a defect. So a class is excused when
//   it is READ: named as a selector, or passed to `classList`, anywhere in web/src, test/ or visual/.
//   That is a measurement rather than an allow-list, and it cannot rot: delete the querySelector and
//   the class goes back to being a finding.
//
// WHAT IT DELIBERATELY DOES NOT CATCH, stated so nobody mistakes a ratchet for a proof:
//   - A CLASS THAT IS DEFINED BUT DEFINED WRONG. This is a resolution check, not a conformance one:
//     `.vb-label-caps` with an empty body would pass. The type, radius and shape censuses are what ask
//     whether a rule says the right thing.
//   - A CLASS REACHED THROUGH A VARIABLE. `InlineField` builds one `common` object and spreads it, so
//     `className: 'inline-edit'` is never in a `className=` attribute; the same blind spot
//     `check-shape-coverage.mjs` names for its own arm 2.
//   - A HOOK THAT IS READ AND THEN NEVER USED. A `querySelector('.dead')` in a test excuses `.dead`
//     here whether or not that test still asserts anything.
//   - A CUSTOM PROPERTY REFERENCED ONLY FROM CODE. Claim 2's population is what the STYLESHEETS
//     reference; an inline `style={{ color: 'var(--nope)' }}` is invisible to it.
//   - A TOKEN DEFINED AND NEVER REFERENCED. That is the other direction again, and it is not a defect:
//     `--s-1`, `--s-7` and `--scan` are defined and unused today, which is a scale step with no
//     consumer rather than a wrong colour on screen.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classesOf, rulesOf, shapedRules } from './lib/css.mjs';
import { classSites } from './lib/jsx.mjs';
import { codeOf, lineOf, walk as walkFiles } from './lib/source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = 'web/src';

// THE RATCHET, and it is what the tree holds today rather than what it ought to hold. Five names
// resolve to nothing and none of them is read by anything: `.ap-drawer-col` (two sites),
// `.copilot-authority`, `.mp-badge` (three sites, beside a real `.mp-badges` rule),
// `.settings-error` (two sites, where `.vb-error` is the class that would draw one) and the composed
// `status-*` at `runs/CardReports.tsx`. Each is the `.conn-pop` defect again — a name that styles
// nothing — and each is left where it is, printed, because removing five of them is a separate change
// from building the instrument that finds them. NEVER RAISE IT.
const UNDEFINED_CEILING = 1;

// Anti-vacuity: a floor on the POPULATION, not on the findings. A reader that stops matching names
// nothing and reports nothing, which looks exactly like a clean tree. Set an order of magnitude below
// the real count (323 classes named, 41 tokens referenced) so it never fails a run for succeeding.
const NAMED_FLOOR = 40;
const REFERENCED_FLOOR = 10;

// A SMOKE ALARM, NOT A TARGET — see walk() in lib/source.mjs.
const FLOOR = { '.css': 2, '.ts': 10, '.tsx': 20 };
const walk = (corpus, ext, atLeast) => walkFiles(ROOT, corpus, ext, atLeast ?? FLOOR[ext] ?? 1);

// Where a class may be READ rather than styled: the app's own code, the React suite and the browser
// harness. Floored low, because these are the corpora a hook lives in and an empty one would excuse
// nothing rather than everything — which is the safe direction here.
const READERS = [
  ['web/src', '.ts'],
  ['web/src', '.tsx'],
  ['test', '.ts'],
  ['test', '.tsx'],
  ['visual', '.ts'],
  ['visual', '.mjs'],
];

const read = (file) => readFileSync(join(ROOT, file), 'utf8');

// ---------- the two definition sets ----------
export function definitionsIn(sheets) {
  const classes = new Set();
  const tokens = new Set();
  for (const { file, css } of sheets) {
    for (const rule of shapedRules(rulesOf(file, css))) {
      for (const cls of classesOf(rule.selector)) classes.add(cls);
      // A custom property is DECLARED by a `--name:` in a rule body, wherever that rule is — `:root`,
      // a `[data-theme]` block or a class. Read from the body and not from the file, so a theme that
      // defines a token on a selector of its own still counts.
      for (const m of rule.body.matchAll(/(--[\w-]+)\s*:/g)) tokens.add(m[1]);
    }
  }
  return { classes, tokens };
}

// Every `var(--x)` a stylesheet asks for, with the first place it asks. Comments blanked so a token
// named in prose is not a reference — the same rule `codeOf` applies to the code.
export function tokenReferences(sheets) {
  const out = new Map();
  for (const { file, css } of sheets) {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!out.has(m[1])) out.set(m[1], `${file}:${lineOf(text, m.index)}`);
    }
  }
  return out;
}

// ---------- resolution ----------
// The right-hand half of a composed name: every quoted word and every bare number in the corpus. The
// same method as `check-class-budget.mjs`'s `vocabularyOf`, and the numbers are not a widening for
// convenience — `` `vb-dot-${size}` `` composes three real classes out of a `7 | 8 | 12` union.
export function vocabularyOf(code) {
  const out = new Set();
  for (const m of code.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)) {
    for (const word of (m[1] ?? m[2] ?? '').split(/[\s|,]+/)) if (word) out.add(word);
  }
  for (const m of code.matchAll(/(?<![\w-])\d+(?![\w-])/g)) out.add(m[0]);
  return out;
}

// Is this class name resolved by the stylesheets? A whole name is looked up; a PREFIX — the residue of
// a `` `prefix-${…}` `` after the hole is blanked — is satisfied by one composition that exists.
export function resolves(name, defined, vocabulary) {
  if (defined.has(name)) return true;
  if (!name.endsWith('-')) return false;
  // `name` KEEPS ITS TRAILING DASH, and the first draft stripped it: `beta-` + `ok` became `betaok`, so
  // a composed name that resolves perfectly well was reported as a finding. The fixture caught it.
  for (const value of vocabulary) if (defined.has(`${name}${value}`)) return true;
  return false;
}

// Is this class READ by something, rather than styled? SELECTION HAPPENS THROUGH A NAMED API, so the
// match is scoped to the argument of one — `querySelector`, `querySelectorAll`, `closest`, `matches`,
// Playwright's `locator` — or to a `classList` membership.
//
// SCOPED, AND THE FIRST VERSION WAS A BARE `\.name` SEARCH, which excused the very defect this gate
// exists for. Reintroducing `.conn-pop` exited 0, because `test/panel-twenty.test.tsx` contains the
// string in a TEST TITLE — *"`.conn-pop` decides nothing about the popover it is passed to"* — and prose
// in a test name is not a reader. The same bare search would have excused a class on the strength of a
// module path in an import. A grep about to become a claim has to be read; this one was, and it was
// wrong.
//
// NO LEFT ANCHOR ON THE DOT, deliberately, because the anchor the first version carried broke the
// COMPOUND selector: `page.locator('section.control.explorer')` has a word character before the dot, so
// `.explorer` reported as unread on the surface list that reads it every run. The scoping is what keeps a
// module path out, and it does it better than an anchor could.
const SELECTING = 'querySelector|querySelectorAll|closest|matches|locator';

export function readAs(name, readers) {
  const escaped = name.replace(/[-.]/g, '\\$&');
  const selector = new RegExp(`(?:${SELECTING})\\(\\s*['"\`][^'"\`]*\\.${escaped}(?![\\w-])`);
  const hook = new RegExp(`classList\\.(?:contains|add|remove|toggle)\\(\\s*['"\`]${escaped}['"\`]`);
  for (const { file, code } of readers) {
    if (selector.test(code)) return `${file} reads it as a selector`;
    if (hook.test(code)) return `${file} reads it through classList`;
  }
  return null;
}

// ---------- the self-test ----------
// It goes through the run's OWN functions — `definitionsIn`, `classSites`, `resolves`, `readAs`,
// `tokenReferences` — because a self-test carrying its own copy of a pattern has no opinion about the
// code under test, which is a mistake this repository has made twice.
//
// Every row is a branch that can silently stop matching: a literal that IS defined; a literal that is
// not (the `.conn-pop` defect); a composed prefix that resolves; a composed prefix that resolves to
// nothing; a prefix whose only would-be match is a longer class with the same start (the `.conn-pop`
// vs `.conn-pop-head` trap, which must NOT resolve); a class read by a selector in a test; a class
// whose only appearance is a module path in an import (which must NOT excuse it); a string that is
// the operand of a comparison inside the `className` expression rather than a class; a class named in a
// TEST TITLE and selected by nothing (which must NOT be excused — the `.conn-pop` miss); and a class
// read through a COMPOUND selector (which must be, and was not before the anchor came off).
const FIXTURE_CSS = `
/* .in-a-comment { color: red } */
.alpha { color: var(--known); }
.beta-ok { color: red }
.conn-pop-head { color: red }
:root { --known: red; }
`;

const FIXTURE_CODE = `
import { thing } from '../api/deep-path';
const kinds = ['ok'];
const a = <div className="alpha" />;
const b = <div className="never-styled" />;
const c = <div className={\`beta-\${kind}\`} />;
const d = <div className={\`gone-\${kind}\`} />;
const e = <div className={\`conn-pop-\${kind}\`} />;
const f = <div className="hooked-by-a-test" />;
const g = <div className="deep-path" />;
const h = <div className={layout === 'a-value' ? 'alpha' : 'alpha'} />;
const i = <Popover triggerClassName="through-a-prop" />;
const j = <div className="named-in-a-title" />;
const k = <div className="in-a-compound" />;
`;

const FIXTURE_READER = [
  "document.querySelector('.hooked-by-a-test');",
  "import x from '../api/deep-path';",
  "it('.named-in-a-title decides nothing about the box it is passed to', () => {});",
  "await expect(page.locator('section.control.in-a-compound')).toBeVisible();",
].join('\n');

// `.conn-pop-` must be a finding: `'ok'` is the only value in the fixture's vocabulary and
// `.conn-pop-ok` is not defined, so the `.conn-pop-head` rule must not resolve it by prefix.
// `.deep-path` must be a finding too: it is named in an import in BOTH fixtures and read by neither.
// `.through-a-prop` is the `triggerClassName` row, and it is the shape the `.conn-pop` defect had.
const SELF_TEST_WANT = [
  'named alpha,never-styled,beta-,gone-,conn-pop-,hooked-by-a-test,deep-path,through-a-prop,named-in-a-title,in-a-compound',
  'findings .never-styled, .gone-, .conn-pop-, .deep-path, .through-a-prop, .named-in-a-title',
  'hooks .hooked-by-a-test (fixture-reader.ts reads it as a selector), .in-a-compound (fixture-reader.ts reads it as a selector)',
  'tokens --unknown',
];

function selfTest() {
  const sheets = [{ file: 'fixture.css', css: FIXTURE_CSS }];
  const { classes, tokens } = definitionsIn(sheets);
  const code = codeOf(FIXTURE_CODE);
  const sources = [{ file: 'fixture.tsx', code }];
  const readers = [{ file: 'fixture-reader.ts', code: codeOf(FIXTURE_READER) }];
  const vocabulary = vocabularyOf(code);
  const named = [...classSites(sources).keys()];
  const unresolved = named.filter((cls) => !resolves(cls, classes, vocabulary));
  const hooks = unresolved.filter((cls) => readAs(cls, readers) !== null);
  const findings = unresolved.filter((cls) => readAs(cls, readers) === null);
  const referenced = tokenReferences([
    ...sheets,
    { file: 'other.css', css: '.zeta { color: var(--unknown); }' },
  ]);
  const got = [
    `named ${named.join(',')}`,
    `findings ${findings.map((c) => `.${c}`).join(', ')}`,
    `hooks ${hooks.map((c) => `.${c} (${readAs(c, readers)})`).join(', ')}`,
    `tokens ${[...referenced.keys()].filter((t) => !tokens.has(t)).join(',')}`,
  ];
  for (const [i, want] of SELF_TEST_WANT.entries()) {
    if (got[i] !== want) return `expected\n  ${want}\ngot\n  ${got[i]}`;
  }
  return null;
}

// ---------- the run ----------
const sheets = walk(CORPUS, '.css').map((file) => ({ file, css: read(file) }));
const { classes: definedClasses, tokens: definedTokens } = definitionsIn(sheets);

const sources = [...walk(CORPUS, '.ts'), ...walk(CORPUS, '.tsx')].map((file) => ({
  file,
  code: codeOf(read(file)),
}));
const readers = READERS.flatMap(([corpus, ext]) =>
  walk(corpus, ext, 1).map((file) => ({ file, code: codeOf(read(file)) })),
);
const vocabulary = vocabularyOf(sources.map((s) => s.code).join('\n'));

const named = classSites(sources);
const referenced = tokenReferences(sheets);

console.log(
  `name resolution: ${named.size} class name(s) in a className across ${sources.length} file(s), ` +
    `${referenced.size} custom propert(ies) referenced by ${sheets.length} stylesheet(s), ` +
    `read against ${definedClasses.size} defined class(es) and ${definedTokens.size} defined token(s)`,
);
console.log(
  `hooks and findings are separated by ${readers.length} reader file(s) in web/src, test/ and visual/`,
);

// Before any finding, because a green run on a reader that matched nothing is the worse failure.
if (named.size < NAMED_FLOOR || referenced.size < REFERENCED_FLOOR) {
  console.error(`\nonly ${named.size} class name(s) and ${referenced.size} token reference(s) found.`);
  console.error(`This check is vacuous: a reader has stopped matching. Fix the pattern in`);
  console.error(`tools/check-name-resolution.mjs — do NOT lower the floor.`);
  process.exit(1);
}
const parserFault = selfTest();
if (parserFault) {
  console.error(`\nthe name reader is broken: ${parserFault}.`);
  console.error(`Both claims are vacuous — they would report nothing whatever the tree holds. Fix the`);
  console.error(`pattern in tools/check-name-resolution.mjs; do NOT relax the fixture.`);
  process.exit(1);
}

let failed = false;

const unresolved = [...named.keys()]
  .filter((cls) => !resolves(cls, definedClasses, vocabulary))
  .map((cls) => ({ cls, sites: named.get(cls), hook: readAs(cls, readers) }))
  .sort((a, b) => a.cls.localeCompare(b.cls));
const hooks = unresolved.filter((f) => f.hook !== null);
const findings = unresolved.filter((f) => f.hook === null);

// PRINTED, both lists, on a passing run: a finding list nobody sees is a finding list nobody fixes,
// and a hook nobody sees is an excuse nobody re-examines.
for (const { cls, sites, hook } of hooks)
  console.log(`hook: .${cls} — ${hook}  (named at ${sites.join(', ')})`);

const head = `class names resolving to no rule: ${findings.length}`;
if (findings.length > UNDEFINED_CEILING) {
  console.error(`\n${head}, against a ceiling of ${UNDEFINED_CEILING}. A class named at a call site and`);
  console.error(`defined by no rule styles NOTHING, and the three this gate exists for were each found by`);
  console.error(`hand. Either give it a rule, delete the name, or — if something READS it — say so with a`);
  console.error(`selector or a classList call, which is what excuses .column and .explorer.\n`);
  for (const { cls, sites } of findings) console.error(`  .${cls} — named at ${sites.join(', ')}`);
  failed = true;
} else {
  console.log(`${head}/${UNDEFINED_CEILING} (a RATCHET — drive it down, never up):`);
  for (const { cls, sites } of findings) console.log(`  .${cls} — named at ${sites.join(', ')}`);
}

const undefinedTokens = [...referenced]
  .filter(([token]) => !definedTokens.has(token))
  // Supplied at RUN TIME by the surface that uses it: `--exec-cols` and `--max-cols` arrive as inline
  // styles from React, so the grid's track count cannot disagree with the component's own column list.
  // Read out of the source rather than allow-listed, so a token whose supplier is deleted comes back.
  .filter(
    ([token]) => !sources.some(({ code }) => code.includes(`'${token}'`) || code.includes(`"${token}"`)),
  );

if (undefinedTokens.length > 0) {
  console.error(`\n${undefinedTokens.length} custom propert(ies) referenced and defined by nothing:\n`);
  for (const [token, site] of undefinedTokens) console.error(`  ${token} — referenced at ${site}`);
  console.error(`\nAn invalid var() falls through to the inherited value, so this renders a WRONG colour`);
  console.error(`rather than none — which is what \`--ink\` did for weeks. Define it in themes.css, or set`);
  console.error(`it from the component that owns it and name it as a string there.`);
  failed = true;
}

if (failed) process.exit(1);

console.log(
  `every custom property resolves; ${findings.length} class name(s) resolve to no rule against a ` +
    `ceiling of ${UNDEFINED_CEILING}, and ${hooks.length} more are read rather than styled`,
);
