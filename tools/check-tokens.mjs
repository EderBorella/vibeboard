#!/usr/bin/env node
//
// THE PRIMITIVE LAYER, AND THREE CLAIMS ABOUT IT. Phase 1 of notes/atomic-revamp-plan.md, over
// `web/src/design/*.css` — the geometry block and the three palettes, which were one file until this
// phase split them.
//
// Run it with: npm run check:tokens
//
//   1. Every custom property DEFINED is referenced from `web/src/**/*.css`, or is listed in `UNCONSUMED`
//      with the phase that will spend it. A row that has since acquired a consumer is also a finding:
//      an exception list nobody prunes is an exception list that would pass an empty tree.
//   2. Every property defined in one `[data-theme]` block is defined in ALL of them.
//   3. The shared `:root` block defines no COLOUR, and the theme blocks define no GEOMETRY.
//
// WHY EACH ONE, and every one is a defect this tree really had rather than a hypothesis.
//
//   `--scan` was defined in all three palettes and referenced by nothing, for three palettes' worth of
//   history. No gate here has ever been able to see an unused token: `check-name-resolution.mjs` runs the
//   other direction (referenced and defined nowhere) and says so in its own comments. Claim 1 is that
//   direction, and it is the one that makes "tokens arrive before their consumers" a discipline rather
//   than a licence to leave names lying around — an unconsumed name has to be signed for.
//
//   `--warn` was referenced by styles.css and defined by NO theme, so every theme fell through to a
//   hardcoded fallback chosen for a dark ground, which the light theme then inherited and could not fix.
//   Claim 2 is the same fault one step later: a name defined in two palettes and forgotten in the third
//   renders, and renders wrong, in exactly one theme — the theme nobody had open.
//
//   Claim 3 is what makes the split worth doing at all. One file holding both halves can only ask a
//   reader to keep them apart, and a theme that decides a length has its own layout.
//
// WHAT IT DELIBERATELY DOES NOT CATCH:
//   - A NAME WHOSE VALUE IS NEITHER COLOUR-SHAPED NOR GEOMETRY-SHAPED, moved into the wrong file: a font
//     stack in a theme block passes claim 3. The shape of a value is what is checkable here; which half
//     a `--font-*` belongs to is a judgement, and the honest instrument for it is review.
//   - A TOKEN REFERENCED ONLY FROM A `.tsx` inline style. The corpus is the stylesheets on purpose —
//     `web/src` has six such references today and every one of them is also in a rule — but a name kept
//     alive ONLY by an inline style would read as unconsumed here and has to be listed with its reason.
//   - WHETHER A VALUE IS RIGHT. `--ctl-h: 3px` passes. That is the browser harness's business.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rulesOf, shapedRules } from './lib/css.mjs';
import { lineOf, walk as walkFiles } from './lib/source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN = 'web/src/design';
const CORPUS = 'web/src';

// A SMOKE ALARM, NOT A TARGET — see walk() in lib/source.mjs. An order of magnitude under the real
// counts (75 definitions, 45 names, 3 themes, 4 stylesheets).
const FLOOR = { defs: 20, themes: 3 };

// A NAME MAY BE DEFINED BEFORE ANYTHING READS IT, and this is where that is signed for: the phase that
// spends it, so the row can be deleted by the commit that does. Every phase number is
// notes/atomic-revamp-plan.md's.
// EMPTY, AND THAT IS THE ATOM PHASE PAYING ITS BILL. All eight rows that stood here — `--ctl-h`,
// `--mark-h`, `--rule`, `--lift` and the four `--z-*` names — were signed for by Phase 4, and Phase 4
// spent them: the two heights on Button, Chip, Control and the segmented group, the rule on twelve
// border-left rails, the lift on the four shadows that each said "off the page" in their own numbers, and
// the four layers on all nine `z-index` declarations. `npm run check:box-scale` is what holds those four
// at zero from here.
//
// The claim that made the emptiness reachable is the SECOND half of claim 1: a name that has acquired a
// consumer and kept its row is a finding too, so this map cannot rot into an allow-list. Leaving one row
// here would have failed the run.
/** @type {Map<string, string>} */
const UNCONSUMED = new Map();

// A COLOUR IN THE GEOMETRY BLOCK, ON PURPOSE, with its reason — the precedent is
// check-radius-scale.mjs's `50%` and check-scale.mjs's `inherit`.
/** @type {Map<string, string>} */
const COLOUR_IN_TOKENS_ON_PURPOSE = new Map([
  [
    '--lift',
    'A SHADOW IS A GEOMETRY, and its ink is part of the offset rather than a palette decision: the ' +
      'three themes disagree about `--glow` for an argued reason (marshmallow sets it to `none`) and ' +
      'agree about this one by construction, because all four shadows it replaces were the same black.',
  ],
]);

// What a value LOOKS like, which is the only half of "is this a colour" a file can answer. A hex, any
// colour function, a gradient, or a keyword that only ever names ink.
const COLOUR_SHAPED =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(|-gradient\(|\b(?:currentColor|transparent)\b/;
// A length, a number, or a whitespace/comma-separated list of them — and at least one digit, so `none`
// and `inherit` are neither geometry nor colour and may sit in either file.
const LENGTH = /^-?\d*\.?\d+(?:px|rem|em|%|vh|dvh|vw|ch|s|ms)?$/;
const geometryShaped = (value) =>
  /\d/.test(value) &&
  value
    .split(/[\s,]+/)
    .filter(Boolean)
    .every((part) => LENGTH.test(part));

const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const sheetsIn = (corpus, atLeast) =>
  walkFiles(ROOT, corpus, '.css', atLeast).map((file) => ({ file, css: read(file) }));

// ---------- what the design files define, and in which block ----------
// `scope` is the theme key, or `null` for the shared block. A selector list that names ANY `[data-theme]`
// is a theme block and not the shared one, which matters: the default palette is written
// `:root, :root[data-theme="cyberpunk"]` so that an unset attribute does not flash the wrong ground, and
// reading its `:root` as the shared block would report every cyberpunk colour as claim-3 fault.
export function definitionsOf(sheets) {
  const defs = [];
  for (const { file, css } of sheets) {
    for (const rule of shapedRules(rulesOf(file, css))) {
      const themes = [...rule.selector.matchAll(/\[data-theme="([a-z-]+)"\]/g)].map((m) => m[1]);
      const scopes = themes.length > 0 ? themes : [null];
      for (const m of rule.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        const line = rule.line + lineOf(rule.body, m.index) - 1;
        for (const scope of scopes) {
          defs.push({ at: `${file}:${line}`, name: m[1], value: m[2].trim(), scope });
        }
      }
    }
  }
  return defs;
}

// Every `var(--name)` in the corpus, with where it was first seen. The design files are IN the corpus,
// because a token defined in one of them may be spent by another: `--on-fill: var(--on-accent)` was a
// real consumer for two of the three palettes, and that alias is exactly why `--on-accent` is now gone.
export function referencesOf(sheets) {
  const refs = new Map();
  for (const { file, css } of sheets) {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
      const seen = refs.get(m[1]) ?? { count: 0, at: `${file}:${lineOf(text, m.index)}` };
      refs.set(m[1], { count: seen.count + 1, at: seen.at });
    }
  }
  return refs;
}

// ---------- the three claims ----------
// One function per claim, each returning findings, so the self-test drives exactly the code the run does.
export function claim1(defs, refs) {
  const names = [...new Set(defs.map((d) => d.name))];
  const dead = names
    .filter((name) => !refs.has(name) && !UNCONSUMED.has(name))
    .map((name) => ({ name, detail: 'defined and referenced by no rule, and not listed in UNCONSUMED' }));
  const stale = names
    .filter((name) => refs.has(name) && UNCONSUMED.has(name))
    .map((name) => ({
      name,
      detail: `listed in UNCONSUMED (${UNCONSUMED.get(name)}) and now referenced ${refs.get(name).count}× — delete the row`,
    }));
  return [...dead, ...stale];
}

export function claim2(defs) {
  const themes = [...new Set(defs.map((d) => d.scope).filter((s) => s !== null))].sort();
  const byTheme = new Map(themes.map((t) => [t, new Set()]));
  for (const d of defs) if (d.scope !== null) byTheme.get(d.scope).add(d.name);
  const every = [...new Set(themes.flatMap((t) => [...byTheme.get(t)]))].sort();
  const findings = [];
  for (const name of every) {
    const missing = themes.filter((t) => !byTheme.get(t).has(name));
    if (missing.length > 0) {
      findings.push({
        name,
        detail: `defined for ${themes.length - missing.length} of ${themes.length} themes — missing from ${missing.join(', ')}`,
      });
    }
  }
  return { themes, findings };
}

export function claim3(defs) {
  const findings = [];
  for (const { at, name, value, scope } of defs) {
    if (scope === null && COLOUR_SHAPED.test(value) && !COLOUR_IN_TOKENS_ON_PURPOSE.has(name)) {
      findings.push({ at, name, detail: `a colour in the shared block: ${value}` });
    }
    if (scope !== null && geometryShaped(value)) {
      findings.push({ at, name, detail: `geometry in the ${scope} block: ${value}` });
    }
  }
  return findings;
}

// ---------- the self-test ----------
// THROUGH THE RUN'S OWN FUNCTIONS, for the reason every other gate in this directory states: a self-test
// carrying its own copy of a pattern has no opinion about the code under test, and that mistake has been
// made twice in this repository.
//
// Every branch that can silently stop matching is exercised once: a shared geometry definition and a
// shared colour one; a definition inside a `:root, :root[data-theme=…]` selector list (which must read as
// the THEME and not as the shared block); a name missing from one theme; a length in a theme block; a
// referenced name and an unreferenced one; a declaration named only in a comment, which is not a
// definition; and the line arithmetic, which must report the declaration's own line and not the block's.
const FIXTURE_TOKENS = `
:root {
  /* --commented: 1px is prose and not a definition. */
  --s-9: 40px;
  --oops: #abcdef;
}
`;

const FIXTURE_THEMES = `
:root,
:root[data-theme="one"] {
  --paint: #111111;
  --only-one: #222222;
  --gap: 4px;
}
:root[data-theme="two"] {
  --paint: #333333;
}
`;

const FIXTURE_USE = `
.alpha { padding: var(--s-9); color: var(--paint); }
`;

const SELF_TEST_WANT = [
  'defs fixture-tokens.css:4 --s-9 shared | fixture-tokens.css:5 --oops shared | ' +
    'fixture-themes.css:4 --paint one | fixture-themes.css:5 --only-one one | ' +
    'fixture-themes.css:6 --gap one | fixture-themes.css:9 --paint two',
  'claim1 --oops: defined and referenced by no rule, and not listed in UNCONSUMED | ' +
    '--only-one: defined and referenced by no rule, and not listed in UNCONSUMED | ' +
    '--gap: defined and referenced by no rule, and not listed in UNCONSUMED',
  'claim2 themes one,two — --gap: defined for 1 of 2 themes — missing from two | ' +
    '--only-one: defined for 1 of 2 themes — missing from two',
  'claim3 fixture-tokens.css:5 --oops: a colour in the shared block: #abcdef | ' +
    'fixture-themes.css:6 --gap: geometry in the one block: 4px',
];

function selfTest() {
  const design = [
    { file: 'fixture-tokens.css', css: FIXTURE_TOKENS },
    { file: 'fixture-themes.css', css: FIXTURE_THEMES },
  ];
  const defs = definitionsOf(design);
  const refs = referencesOf([...design, { file: 'fixture-use.css', css: FIXTURE_USE }]);
  const themed = claim2(defs);
  const got = [
    `defs ${defs.map((d) => `${d.at} ${d.name} ${d.scope ?? 'shared'}`).join(' | ')}`,
    `claim1 ${claim1(defs, refs)
      .map((f) => `${f.name}: ${f.detail}`)
      .join(' | ')}`,
    `claim2 themes ${themed.themes.join(',')} — ${themed.findings.map((f) => `${f.name}: ${f.detail}`).join(' | ')}`,
    `claim3 ${claim3(defs)
      .map((f) => `${f.at} ${f.name}: ${f.detail}`)
      .join(' | ')}`,
  ];
  for (const [i, want] of SELF_TEST_WANT.entries()) {
    if (got[i] !== want) return `row ${i}: expected\n  ${want}\ngot\n  ${got[i]}`;
  }
  return null;
}

// ---------- the run ----------
const design = sheetsIn(DESIGN, 2);
const defs = definitionsOf(design);
const refs = referencesOf(sheetsIn(CORPUS, 3));
const names = [...new Set(defs.map((d) => d.name))];
const { themes, findings: themeGaps } = claim2(defs);

console.log(
  `tokens: ${defs.length} definition(s) of ${names.length} name(s) across ${design.length} file(s) in ${DESIGN}, ` +
    `${themes.length} theme(s), read against ${refs.size} referenced name(s)`,
);

// Before any finding, because a green run on a reader that matched nothing is the worse failure.
if (defs.length < FLOOR.defs || themes.length < FLOOR.themes) {
  console.error(`\nonly ${defs.length} definition(s) and ${themes.length} theme(s) found.`);
  console.error(`This check is vacuous: the reader has stopped matching. Fix the pattern in`);
  console.error(`tools/check-tokens.mjs — do NOT lower the floor.`);
  process.exit(1);
}
const parserFault = selfTest();
if (parserFault) {
  console.error(`\nthe token reader is broken: ${parserFault}`);
  console.error(`All three claims are vacuous — they would report nothing whatever the files hold. Fix the`);
  console.error(`pattern in tools/check-tokens.mjs; do NOT relax the fixture.`);
  process.exit(1);
}

let failed = false;
const fail = (head, lines, why) => {
  console.error(`\n${head}\n`);
  for (const line of lines) console.error(`  ${line}`);
  console.error(`\n${why}`);
  failed = true;
};

const unread = claim1(defs, refs);
if (unread.length > 0) {
  fail(
    `${unread.length} token(s) whose consumers and whose paperwork disagree:`,
    unread.map((f) => `${f.name} — ${f.detail}`),
    `A THEME TOKEN NOTHING READS IS NOT FREE: \`--scan\` survived three palettes that way. A name may\n` +
      `land before its consumers — that is this phase's whole discipline — but it is signed for in\n` +
      `UNCONSUMED with the phase that spends it, and the row is deleted by the commit that spends it.`,
  );
}

if (themeGaps.length > 0) {
  fail(
    `${themeGaps.length} token(s) not defined for every theme:`,
    themeGaps.map((f) => `${f.name} — ${f.detail}`),
    `A name missing from ONE palette renders in exactly one theme, and renders whatever it inherited —\n` +
      `which is what \`--warn\` did: referenced by styles.css, defined by no theme, so every theme took a\n` +
      `hardcoded dark-ground fallback and the light one wore it. Define it in all ${themes.length}, or in none.`,
  );
}

const misplaced = claim3(defs);
if (misplaced.length > 0) {
  fail(
    `${misplaced.length} definition(s) in the wrong half of the primitive layer:`,
    misplaced.map((f) => `${f.at} — ${f.name}: ${f.detail}`),
    `A THEME DECIDES COLOUR. A theme that disagreed about what 12px means is a theme with its own\n` +
      `layout, and a colour in the shared block is a colour no theme can answer for. Geometry goes in\n` +
      `${DESIGN}/tokens.css, palettes in ${DESIGN}/themes.css. A colour that is geometry on purpose goes\n` +
      `in COLOUR_IN_TOKENS_ON_PURPOSE with its reason.`,
  );
}

if (failed) process.exit(1);

// PRINTED IN FULL ON A PASSING RUN, because the vocabulary is the deliverable of this layer and a list
// nobody sees is a list nobody keeps. Consumers first: it is the number every argument in
// notes/atomic-revamp-plan.md §3 is made from.
console.log(`\nthe shared block — geometry, elevation and layers:`);
for (const d of defs.filter((x) => x.scope === null)) {
  const n = refs.get(d.name)?.count ?? 0;
  console.log(`  ${String(n).padStart(3)}×  ${d.name.padEnd(14)} ${d.value}`);
}
console.log(`\nthe palettes — ${themes.join(', ')}:`);
for (const name of names.filter((n) => defs.some((d) => d.name === n && d.scope !== null))) {
  console.log(`  ${String(refs.get(name)?.count ?? 0).padStart(3)}×  ${name}`);
}
if (UNCONSUMED.size > 0) {
  console.log(`\n${UNCONSUMED.size} name(s) defined before their consumers, each signed for:`);
  for (const [name, phase] of UNCONSUMED) console.log(`  ${name.padEnd(14)} ${phase}`);
}
console.log(
  `\nevery name is referenced or signed for; every palette defines the same ` +
    `${new Set(defs.filter((d) => d.scope !== null).map((d) => d.name)).size} name(s); no colour in the ` +
    `shared block and no geometry in a palette.`,
);
