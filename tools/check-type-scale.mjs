#!/usr/bin/env node
//
// Every `font-size` authored in web/src/*.css must be one of the six steps of the type scale, and no
// `gap` or `padding` may sit in the 0.25–0.6rem band the space scale replaced.
//
// Run it with: npm run check:type-scale
//
// WHY THIS EXISTS BESIDE THE BROWSER GATE, WHICH ALREADY ASSERTS THE SAME THING.
//
// It does not assert the same thing. `npm run visual` measures COMPUTED font sizes on the board, and
// Phase 0 found 15 of them against 27 authored in the stylesheet. The other twelve live on surfaces
// the harness never visits — the Execution tab, settings, drawers, card panes, the dock's other
// states — so a browser gate alone cannot verify "27 became 6": it would pass with a dozen off-scale
// values still in the file, and the sweep in Phase 5 would then find them by hand.
//
// So the two gates make different claims and both are needed:
//   the harness  — "nothing the eye can reach on the board is off the scale", including sizes no rule
//                  authored (a UA default on a control, an inherited size from a container).
//   this check   — "nothing in the FILE is off the scale", including surfaces no test opens.
// Neither subsumes the other. This one cannot see an element that never names a size; that one cannot
// see a rule it never renders.
//
// It is BLOCKING and at zero, because it is a claim about a file rather than about a backlog.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineOf, walk } from './lib/source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = 'web/src';
// The scale's definitions live here, and the six names are checked AGAINST it rather than merely
// looking right: `var(--t-bdoy)` matches any `--t-*` pattern, resolves to nothing, and makes the
// declaration invalid at computed-value time — so the element silently inherits and the file passes a
// check that only ever read the shape of the name.
const TOKENS_FILE = 'web/src/themes.css';
const TYPE_SCALE = ['--t-micro', '--t-small', '--t-body', '--t-lead', '--t-title', '--t-display'];

// The band Phase 2 closed, in rem. Below 0.25rem the nearest step is a 2–6x change on what is a
// hairline rather than a space, and above 0.6rem is a band this phase does not claim; both are
// deliberately out of scope and NOT silently allowed — see the report for what remains.
const SPACE_BAND = { lo: 0.25, hi: 0.6 };

// A VALUE MAY BE OFF THE SCALE ON PURPOSE, and then it is written here with its reason rather than
// left to be rediscovered. Empty is the honest state today: all 27 authored sizes mapped onto a step.
// A relative unit is the case to expect — `em` has no fixed pixel value, so "nearest step" is not
// defined for it and the judgement has to be recorded by a person.
/** @type {Map<string, string>} */
const OFF_SCALE_ON_PURPOSE = new Map([
  [
    'inherit',
    'On the scale BY CONSTRUCTION rather than by exception: it defers to the ancestor, and every ' +
      'ancestor that names a size is checked here, with the chain terminating at `body`, which names ' +
      '`--t-body`. Used by the form-control reset at the top of styles.css, which exists to stop a ' +
      "control taking the UA's off-scale 13.3333px.",
  ],
]);

// `font: 14px/1.2 sans-serif` SETS A FONT SIZE AND THE PATTERN ABOVE CANNOT SEE IT — the shorthand is
// the way round this check, so it is closed here rather than left as a hole. `font: inherit` and
// `font: 400 …` carry no length and are fine; the file uses the former in a dozen places deliberately.
const FONT_SHORTHAND = /(?:^|[;{\s])font:([^;}]*)/g;
const LENGTH = /\d*\.?\d+(?:px|rem|em|pt|%)/;

// THERE ARE NO COUNT FLOORS ANY MORE, and removing them was forced rather than chosen — the same
// structural flaw check-radius-scale.mjs hit at its button-class floor, one file over.
//
// A REGEX THAT STOPS MATCHING IS STILL THE FAILURE MODE OF A CHECK LIKE THIS: it reports zero findings,
// exits 0, and looks exactly like success. The floors were 150 font-size and 150 gap/padding
// declarations, and they were the wrong instrument for it. Phase 5's sweep took font-size from 202 to
// **155** by merging surfaces onto primitives, which is the goal, so the next merge would have failed
// the run FOR SUCCEEDING — and the message it failed with would have said "this check is vacuous" about
// a check that was working perfectly. Both counts shrink as the sweep continues, so any floor on either
// must eventually be bypassed or deleted.
//
// Its replacement is `parserSelfTest` below, which asserts every pattern here against a fixture the tree
// cannot move: it works identically at 155 declarations and at 5. Do NOT put a count floor back.

// The walk and the line counter are `tools/lib/source.mjs` — one copy for all five gates, because
// `lineOf` was written out four times and every gate's `file:line` depends on it.
const cssFiles = () => walk(ROOT, CORPUS, '.css', 2);

// The tokens the stylesheet actually defines, so a name can be resolved and not merely recognised.
const defined = () => {
  const text = readFileSync(join(ROOT, TOKENS_FILE), 'utf8');
  return new Set([...text.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
};

const FONT_SIZE = /font-size:\s*([^;}]+?)\s*(?=[;}])/g;
// `gap` and its long forms, and `padding` and its sides. Anchored on a boundary so `--tile-gap:` and
// `grid-template-columns:` cannot match.
const SPACE = /(?:^|[;{\s])(gap|row-gap|column-gap|padding(?:-top|-right|-bottom|-left)?):([^;}]*)/g;
const REM = /(\d*\.?\d+)rem/g;

const known = defined();

// ONE FILE'S SCAN, AS A FUNCTION, so `parserSelfTest` goes through exactly the code the census does.
// The lesson is check-radius-scale.mjs's, whose first self-test carried its own `/<button\b/` and
// therefore had no opinion about the code under test at all: it reported success on a census that had
// stopped matching anything. This one has no patterns of its own.
// What is wrong with ONE `font-size` value, or null if nothing is. Its own function because the three
// branches nested inside two loops cost more in the complexity metric than the whole of the rest of this
// file — the metric punishes nesting far harder than length, so flattening beat every other shape.
function fontSizeFault(value) {
  if (OFF_SCALE_ON_PURPOSE.has(value)) return null;
  const token = /^var\((--t-[\w-]+)\)$/.exec(value)?.[1];
  if (!token) return `font-size: ${value} — not a step on the scale`;
  if (!TYPE_SCALE.includes(token)) return `font-size: var(${token}) — not one of the six steps`;
  if (!known.has(token)) return `font-size: var(${token}) — defined in no stylesheet`;
  return null;
}

// The rem lengths in one `gap`/`padding` value that sit inside the band the space scale replaced.
function bandedLengths(value) {
  return [...value.matchAll(REM)].filter(([, n]) => {
    const rem = Number(n);
    return rem >= SPACE_BAND.lo && rem <= SPACE_BAND.hi;
  });
}

export function scan(file, raw) {
  /** @type {{ site: string, detail: string }[]} */
  const findings = [];
  let fontSizes = 0;
  let spaces = 0;
  // COMMENTS ARE BLANKED, NOT READ. This check scanned the raw file, so any comment that mentioned
  // `font-size:` or `padding:` in prose was parsed as a declaration and the words after it as its
  // value — Phase 4 tripped it with a comment explaining why a `font-size` had been REMOVED, and it
  // reported `.cv-links { display: flex` as a value off the scale. The counts it printed included
  // comment text too, so the anti-vacuity floor was being satisfied partly by prose.
  //
  // Blanked to spaces rather than removed, so every offset still maps to its real line and the
  // `file:line` in a finding stays correct. This is the same treatment `rules()` in
  // tools/check-radius-scale.mjs has always applied, which is why that check never had the fault.
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const site = (offset) => `${file}:${lineOf(text, offset)}`;

  for (const match of text.matchAll(FONT_SIZE)) {
    fontSizes += 1;
    const fault = fontSizeFault(match[1]);
    if (fault) findings.push({ site: site(match.index), detail: fault });
  }

  for (const match of text.matchAll(FONT_SHORTHAND)) {
    if (!LENGTH.test(match[1])) continue;
    findings.push({
      site: site(match.index),
      detail: `font:${match[1]} — the shorthand sets a font size; name the step with font-size instead`,
    });
  }

  for (const match of text.matchAll(SPACE)) {
    spaces += 1;
    for (const length of bandedLengths(match[2])) {
      findings.push({
        site: site(match.index),
        detail: `${match[1]}: ${length[0]} — inside the ${SPACE_BAND.lo}–${SPACE_BAND.hi}rem band the space scale replaced`,
      });
    }
  }

  return { fontSizes, spaces, findings };
}

// THE ANTI-VACUITY TEST, and it is a self-test rather than a count — see the note where the floors
// used to be. What can silently break here is the PARSER: `FONT_SIZE`, `FONT_SHORTHAND`, `LENGTH`,
// `SPACE`, `REM`, the comment blanking, and the `var(--t-*)` resolution against `known`. Each of them
// is exercised once, and a broken one changes either a count or a finding.
//
// The fixture is a stylesheet the tree cannot move. Its comment names `font-size` and `padding` in
// prose, which is the Phase 4 fault; the two lines AFTER it are what says the blanking did not shift
// the offsets, because their findings must report lines 7 and 8 rather than 5 and 6. `.delta` is
// written in the compact no-whitespace form, which is what a reformatting run produces and what a
// pattern anchored on `font-size: ` would miss.
const FIXTURE = `
/* font-size: 0.99rem and padding: 0.42rem in prose are NOT declarations, and this check read them as
   declarations until Phase 4. */
.alpha { font-size: var(--t-body); padding: 1rem }
.beta { font: 14px/1.2 sans-serif }
.gamma { gap: 0.4rem; padding-left: var(--s-3) }
.delta{font-size:0.81rem}
.epsilon { font-size: var(--t-nope); font: inherit }
.zeta { font-size: inherit }
`;

// 4 font-size (alpha, delta, epsilon, zeta — NOT the comment's) and 3 gap/padding (alpha, gamma's two
// — NOT the comment's). `.zeta` is counted and is not a finding, which is `OFF_SCALE_ON_PURPOSE`
// working; `.alpha`'s `1rem` and `.epsilon`'s `font: inherit` carry no finding either, which is the
// space band's ceiling and the shorthand's length test.
const SELF_TEST_WANT = [
  '4 font-size',
  '3 gap/padding',
  'fixture.css:7 font-size: 0.81rem — not a step on the scale',
  'fixture.css:8 font-size: var(--t-nope) — not one of the six steps',
  // Two spaces after `sans-serif`, and that is the parser's real output rather than a typo here:
  // `FONT_SHORTHAND` captures `[^;}]*`, so a declaration with no trailing semicolon carries the space
  // before its `}` into the message. Cosmetic, pre-existing, and recorded rather than smoothed over —
  // an expectation written to look tidy is an expectation that stops matching the code.
  'fixture.css:5 font: 14px/1.2 sans-serif  — the shorthand sets a font size; name the step with font-size instead',
  'fixture.css:6 gap: 0.4rem — inside the 0.25–0.6rem band the space scale replaced',
].join(' | ');

function parserSelfTest() {
  const { fontSizes, spaces, findings } = scan('fixture.css', FIXTURE);
  const got = [
    `${fontSizes} font-size`,
    `${spaces} gap/padding`,
    ...findings.map(({ site, detail }) => `${site} ${detail}`),
  ].join(' | ');
  return got === SELF_TEST_WANT ? null : `expected\n  ${SELF_TEST_WANT}\ngot\n  ${got}`;
}

/** @type {{ site: string, detail: string }[]} */
const findings = [];
let fontSizes = 0;
let spaces = 0;

for (const file of cssFiles()) {
  const seen = scan(file, readFileSync(join(ROOT, file), 'utf8'));
  fontSizes += seen.fontSizes;
  spaces += seen.spaces;
  findings.push(...seen.findings);
}

console.log(
  `type scale: ${fontSizes} font-size and ${spaces} gap/padding declaration(s) across ${cssFiles().length} file(s) in ${CORPUS}`,
);

// Before the findings, because a green run on a pattern that matched nothing is the worse failure.
const parserFault = parserSelfTest();
if (parserFault) {
  console.error(`\nthe type-scale parser is broken: ${parserFault}`);
  console.error(`\nThis check is vacuous — it would report nothing whatever the stylesheets hold. Fix the`);
  console.error(`pattern in tools/check-type-scale.mjs; do NOT relax the fixture.`);
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`\n${findings.length} declaration(s) off the scale:\n`);
  for (const { site, detail } of findings) console.error(`  ${site} — ${detail}`);
  console.error(`\nGive each one the nearest step: --t-micro 11px, --t-small 12px, --t-body 13px,`);
  console.error(`--t-lead 15px, --t-title 18px, --t-display 24px; --s-1 2px … --s-7 24px.`);
  console.error(`Do NOT add a step. If a surface looks wrong on the nearest one, the surface is wrong —`);
  console.error(`see docs/design-system.md. A value that is off the scale ON PURPOSE goes in`);
  console.error(`OFF_SCALE_ON_PURPOSE with its reason.`);
  process.exit(1);
}

console.log(
  `all ${fontSizes} font-size declarations are one of the ${TYPE_SCALE.length} steps; the ${SPACE_BAND.lo}–${SPACE_BAND.hi}rem gap/padding band is empty`,
);
