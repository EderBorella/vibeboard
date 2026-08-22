#!/usr/bin/env node
//
// NOTHING IN THE FILE IS OFF THE SCALE. Three claims over `web/src/**/*.css`, all blocking at zero:
//
//   1. Every authored `font-size` is one of the FIVE steps of the type scale.
//   2. Every authored `gap`, `padding` and `margin` value is `0`, a keyword, a percentage, `auto`,
//      `var(--s-1)`…`var(--s-7)`, a `calc()` built only from those steps, or a row in an exception map
//      with its reason.
//   3. Every authored `letter-spacing` is `var(--track)`, `normal`, or a row in an exception map.
//
// Run it with: npm run check:scale
//
// THIS FILE WAS `check-type-scale.mjs` AND IT MADE A WEAKER CLAIM THAN ITS NAME. Claim 2 was a BAND —
// "no `gap` or `padding` may sit between 0.25rem and 0.6rem" — which is not a scale claim at all: it is a
// claim about one interval, so `padding: 0.7rem` (11.2px, on no step) passed, and `padding: 0.05rem`
// passed at the other end. And `margin` was in no gate in the repository whatsoever, which is where the
// values actually were: 59 hand-written lengths carrying 17 distinct values, including BOTH halves of the
// pair docs/design-system.md names as the clearest single piece of evidence for this whole project —
// `0.3rem` against `0.35rem`, 4.8px against 5.6px, five times each. A band that excludes the property
// holding the pathology is a gate whose green tick means nothing.
//
// So the band is gone and the claim is the one the audit says it should always have been. There are seven
// steps and a value is on one of them or it is a finding.
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
// The scales' definitions live here, and the names are checked AGAINST it rather than merely
// looking right: `var(--t-bdoy)` matches any `--t-*` pattern, resolves to nothing, and makes the
// declaration invalid at computed-value time — so the element silently inherits and the file passes a
// check that only ever read the shape of the name.
// The scales are geometry, so they live in design/tokens.css and not in design/themes.css — the split
// Phase 1 of notes/atomic-revamp-plan.md made structural, and `npm run check:tokens` is what keeps it.
const TOKENS_FILE = 'web/src/design/tokens.css';
// FIVE, and `--t-display` is the one that went. It existed to carry "the one big number per surface" and
// no number in the app was ever set in it; its only consumer was a markdown `h1`, which the scale had
// three steps below it to draw a heading ladder with. See design/tokens.css.
const TYPE_SCALE = ['--t-micro', '--t-small', '--t-body', '--t-lead', '--t-title'];
const SPACE_SCALE = ['--s-1', '--s-2', '--s-3', '--s-4', '--s-5', '--s-6', '--s-7'];
const TRACK = '--track';

// A VALUE MAY BE OFF THE SCALE ON PURPOSE, and then it is written here with its reason rather than
// left to be rediscovered. A relative unit is the case to expect — `em` has no fixed pixel value, so
// "nearest step" is not defined for it and the judgement has to be recorded by a person.
//
// THE MAPS ARE PRUNED BY THE RUN. A row that matches nothing in the corpus is a finding of its own,
// because an exception list nobody prunes is an exception list that would pass an empty tree — the same
// mechanism check-tokens.mjs applies to `UNCONSUMED`, and the reason a planted "delete `.brand`'s row"
// defect is a real test of this file rather than of the stylesheet.

/** @type {Map<string, string>} */
const OFF_SCALE_ON_PURPOSE = new Map([
  [
    'inherit',
    'On the scale BY CONSTRUCTION rather than by exception: it defers to the ancestor, and every ' +
      'ancestor that names a size is checked here, with the chain terminating at `body`, which names ' +
      '`--t-body`. Used by the form-control reset in web/src/design/reset.css, which exists to stop a ' +
      "control taking the UA's off-scale 13.3333px.",
  ],
]);

// The two tracking decisions that are NOT the uppercase chrome treatment, on the precedent of `50%` in
// check-radius-scale.mjs and `inherit` above. Keyed by VALUE and named in the reason, which is that
// precedent exactly: both values are unique in the tree, and a selector-keyed map would need this check
// to become rule-aware for two rows.
/** @type {Map<string, string>} */
const TRACKING_ON_PURPOSE = new Map([
  [
    '0.22em',
    '`.brand` in web/src/organisms/topbar/topbar.css — A LOGOTYPE IS NOT A UI LABEL. 0.22em on ' +
      '`▚ VIBEBOARD` in condensed display caps is what makes it read as a wordmark rather than as a ' +
      'heading, and it is the only element in the app whose job is to be the app.',
  ],
  [
    '-0.01em',
    "`.vb-readout` in web/src/ui/primitives.css — one third of the signature's own definition in " +
      'docs/design-system.md (*The signature: the readout*), beside `font-family: var(--font-mono)` and ' +
      '`font-variant-numeric: tabular-nums`. NEGATIVE, and the tracking token is positive: this is the ' +
      'opposite decision from the chrome treatment rather than a different amount of it.',
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

// The walk and the line counter are `tools/lib/source.mjs` — one copy for all the gates, because
// `lineOf` was written out four times and every gate's `file:line` depends on it.
const cssFiles = () => walk(ROOT, CORPUS, '.css', 2);

// The tokens the stylesheet actually defines, so a name can be resolved and not merely recognised.
const defined = () => {
  const text = readFileSync(join(ROOT, TOKENS_FILE), 'utf8');
  return new Set([...text.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
};

const FONT_SIZE = /font-size:\s*([^;}]+?)\s*(?=[;}])/g;
// `gap` and its long forms, `padding` and its sides, and `margin` and its sides. Anchored on a boundary
// so `grid-template-columns:` cannot match — and so a custom property spelling one of these names inside
// itself cannot either, which is what `--tile-gap:` and `--board-gap:` used to do before both went.
const SPACE =
  /(?:^|[;{\s])(gap|row-gap|column-gap|margin(?:-top|-right|-bottom|-left)?|padding(?:-top|-right|-bottom|-left)?):([^;}]*)/g;
const LETTER_SPACING = /letter-spacing:\s*([^;}]+?)\s*(?=[;}])/g;
// One level of nesting is enough for every `calc()` a space value has: the contents are an EXPRESSION and
// not a list of atoms, so they are lifted out and checked separately before the value is split.
const CALC = /calc\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
// Everything that is a decision about nothing: a zero has no size, and a keyword defers.
const SPACE_KEYWORDS = new Set(['0', 'auto', 'inherit', 'initial', 'revert', 'unset']);
const PERCENTAGE = /^-?\d*\.?\d+%$/;

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
  if (!TYPE_SCALE.includes(token))
    return `font-size: var(${token}) — not one of the ${TYPE_SCALE.length} steps`;
  if (!known.has(token)) return `font-size: var(${token}) — defined in no stylesheet`;
  return null;
}

// ONE ATOM of a space value — one side of a shorthand.
function spaceAtomFault(atom) {
  if (SPACE_KEYWORDS.has(atom) || PERCENTAGE.test(atom)) return null;
  const token = /^var\((--[\w-]+)\)$/.exec(atom)?.[1];
  if (!token) return `${atom} — not on the space scale`;
  if (!SPACE_SCALE.includes(token)) return `var(${token}) — not one of the ${SPACE_SCALE.length} steps`;
  if (!known.has(token)) return `var(${token}) — defined in no stylesheet`;
  return null;
}

// A `calc()` IS ALLOWED AND IS NOT A LOOPHOLE. A negative margin cannot be written any other way once the
// literal is gone — `.inline-view` pulls its own box out by a step so an editable field does not move when
// it becomes an input — and `-2px` in an exception map is the hand-written value this phase exists to
// remove. So the expression must name at least one step and may contain no length of its own.
function calcFault(inner) {
  const names = [...inner.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((m) => m[1]);
  if (names.length === 0) return `calc(${inner}) — names no step of the space scale`;
  const off = names.find((name) => !SPACE_SCALE.includes(name));
  if (off) return `calc(${inner}) — var(${off}) is not one of the ${SPACE_SCALE.length} steps`;
  const length = LENGTH.exec(inner.replace(/var\(\s*--[\w-]+\s*\)/g, ' '));
  return length ? `calc(${inner}) — the hand-written length ${length[0]}` : null;
}

function spaceFaults(property, rawValue) {
  const faults = [];
  const value = rawValue.replace(CALC, (_whole, inner) => {
    const fault = calcFault(inner);
    if (fault) faults.push(fault);
    return ' ';
  });
  for (const atom of value.trim().split(/\s+/).filter(Boolean)) {
    const fault = spaceAtomFault(atom);
    if (fault) faults.push(fault);
  }
  return faults.map((fault) => `${property}: ${fault}`);
}

// `inherit` IS NOT ALLOWED HERE, AND IT WAS. The claim this arm makes is `var(--track)`, `normal`, or a
// named exception with its reason — and a bare `inherit` branch was neither: no rule in the tree used it,
// so nothing exercised it, and it sat OUTSIDE `TRACKING_ON_PURPOSE` where the stale-row check cannot see
// it. This file's own doctrine two screens up is that an exception nothing exercises is an exception that
// would pass an empty tree; an allowance hardcoded into a condition is that with the audit removed. It
// belongs in the map with a reason on the day a rule needs it.
function trackingFault(value) {
  if (value === 'normal' || TRACKING_ON_PURPOSE.has(value)) return null;
  if (value !== `var(${TRACK})`) {
    return `letter-spacing: ${value} — not var(${TRACK}), \`normal\`, or a named exception`;
  }
  return known.has(TRACK) ? null : `letter-spacing: var(${TRACK}) — defined in no stylesheet`;
}

// ONE ARM EACH, and the split is forced rather than tidy: `scan` scored 16 on the cognitive-complexity
// metric against a ceiling of 15 — four loops, a branch in each, and a loop inside one of them. The
// metric punishes NESTING far harder than length, so lifting the arms out flattens it while moving no
// pattern at all: every regex still lives at the top of this file and every arm is still reached only
// through `scan`, which is what keeps `parserSelfTest` honest about the code the census runs.
//
// THE ORDER OF THE THREE CALLS IN `scan` IS LOAD-BEARING: `SELF_TEST_WANT` is a single joined string, so
// the arms' findings are compared in sequence. Reordering them fails the self-test, which is correct.

/** @returns {{ count: number, findings: {site: string, detail: string}[], used: {key: string, site: string}[] }} */
function typeArm(text, site) {
  const findings = [];
  const used = [];
  let count = 0;
  for (const match of text.matchAll(FONT_SIZE)) {
    count += 1;
    if (OFF_SCALE_ON_PURPOSE.has(match[1])) {
      used.push({ key: `font-size:${match[1]}`, site: site(match.index) });
    }
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
  return { count, findings, used };
}

/** @returns {{ count: number, findings: {site: string, detail: string}[], used: {key: string, site: string}[] }} */
function spaceArm(text, site) {
  const findings = [];
  let count = 0;
  for (const match of text.matchAll(SPACE)) {
    count += 1;
    for (const detail of spaceFaults(match[1], match[2])) {
      findings.push({ site: site(match.index), detail });
    }
  }
  // No exception map on this arm ON PURPOSE: a space value is a fixed length, so "the nearest step" is
  // always defined for it and the judgement a person would have to record does not exist.
  return { count, findings, used: [] };
}

/** @returns {{ count: number, findings: {site: string, detail: string}[], used: {key: string, site: string}[] }} */
function trackingArm(text, site) {
  const findings = [];
  const used = [];
  let count = 0;
  for (const match of text.matchAll(LETTER_SPACING)) {
    count += 1;
    if (TRACKING_ON_PURPOSE.has(match[1])) {
      used.push({ key: `letter-spacing:${match[1]}`, site: site(match.index) });
    }
    const fault = trackingFault(match[1]);
    if (fault) findings.push({ site: site(match.index), detail: fault });
  }
  return { count, findings, used };
}

export function scan(file, raw) {
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

  const type = typeArm(text, site);
  const space = spaceArm(text, site);
  const tracking = trackingArm(text, site);

  return {
    fontSizes: type.count,
    spaces: space.count,
    trackings: tracking.count,
    findings: [...type.findings, ...space.findings, ...tracking.findings],
    // Keyed `property:value`, not by value alone: `inherit` is a legal font-size exception, and one
    // shared key on the value alone would let either arm prune the other's row.
    //
    // A LIST OF SITES RATHER THAN A SET OF KEYS, and that is what makes the uniqueness claim below
    // checkable: an exception keyed by VALUE spreads silently, so the number of rules using it has to
    // be visible to the run.
    exceptionsUsed: [...type.used, ...space.used, ...tracking.used],
  };
}

// THE ANTI-VACUITY TEST, and it is a self-test rather than a count — see the note where the floors
// used to be. What can silently break here is the PARSER: `FONT_SIZE`, `FONT_SHORTHAND`, `LENGTH`,
// `SPACE`, `LETTER_SPACING`, `CALC`, the comment blanking, and the `var(--…)` resolution against `known`.
// Each of them is exercised once, and a broken one changes either a count or a finding.
//
// The fixture is a stylesheet the tree cannot move. Its comment names `font-size` and `padding` in
// prose, which is the Phase 4 fault; the two lines AFTER it are what says the blanking did not shift
// the offsets, because their findings must report lines 7 and 8 rather than 5 and 6. `.delta` is
// written in the compact no-whitespace form, which is what a reformatting run produces and what a
// pattern anchored on `font-size: ` would miss.
//
// `.alpha`'s `1rem` IS A FINDING NOW AND WAS NOT BEFORE, and that single line is the whole difference
// this file's rewrite makes: 16px is above the band that used to be the claim, and it is not a step.
const FIXTURE = `
/* font-size: 0.99rem and padding: 0.42rem in prose are NOT declarations, and this check read them as
   declarations until Phase 4. */
.alpha { font-size: var(--t-body); padding: 1rem }
.beta { font: 14px/1.2 sans-serif }
.gamma { gap: 0.4rem; padding-left: var(--s-3) }
.delta{font-size:0.81rem}
.epsilon { font-size: var(--t-nope); font: inherit }
.zeta { font-size: inherit }
.eta { margin: 0.35rem auto 0 50% }
.theta { margin-left: calc(-1 * var(--s-3)); letter-spacing: var(--track) }
.iota { letter-spacing: 0.05em }
.kappa { letter-spacing: normal; margin: calc(-1 * 4px) }
.lambda { padding: calc(var(--s-3) + 3px) }
.mu { padding: calc(var(--ctl-h) - var(--s-2)) }
`;

// 4 font-size (alpha, delta, epsilon, zeta — NOT the comment's), 8 gap/padding/margin (alpha, gamma's
// two, eta, theta, kappa, lambda, mu — NOT the comment's) and 3 letter-spacing (theta, iota, kappa).
// `.zeta` is counted and is not a finding, which is `OFF_SCALE_ON_PURPOSE` working; `.epsilon`'s
// `font: inherit` carries no finding either, which is the shorthand's length test. `.eta` shows the three
// atoms a space value may hold beside a step — `auto`, `0` and a percentage — with one off-scale length
// among them, so the per-atom walk is exercised in both directions on one declaration. `.theta`'s
// negative margin is the legal `calc()`; `.kappa`'s names no step at all, `.lambda`'s names one and then
// adds a literal to it, and `.mu` names a token that IS defined and is NOT on the space scale — three
// separate ways a `calc()` can be a loophole, and `calcFault` has exactly three branches. `.mu` is the
// third, which nothing exercised: a `--ctl-h`-tall gap would have passed a check whose whole claim is
// that a space value is one of seven steps.
const SELF_TEST_WANT = [
  '4 font-size',
  '8 gap/padding/margin',
  '3 letter-spacing',
  'fixture.css:7 font-size: 0.81rem — not a step on the scale',
  'fixture.css:8 font-size: var(--t-nope) — not one of the 5 steps',
  // Two spaces after `sans-serif`, and that is the parser's real output rather than a typo here:
  // `FONT_SHORTHAND` captures `[^;}]*`, so a declaration with no trailing semicolon carries the space
  // before its `}` into the message. Cosmetic, pre-existing, and recorded rather than smoothed over —
  // an expectation written to look tidy is an expectation that stops matching the code.
  'fixture.css:5 font: 14px/1.2 sans-serif  — the shorthand sets a font size; name the step with font-size instead',
  'fixture.css:4 padding: 1rem — not on the space scale',
  'fixture.css:6 gap: 0.4rem — not on the space scale',
  'fixture.css:10 margin: 0.35rem — not on the space scale',
  'fixture.css:13 margin: calc(-1 * 4px) — names no step of the space scale',
  'fixture.css:14 padding: calc(var(--s-3) + 3px) — the hand-written length 3px',
  'fixture.css:15 padding: calc(var(--ctl-h) - var(--s-2)) — var(--ctl-h) is not one of the 7 steps',
  'fixture.css:12 letter-spacing: 0.05em — not var(--track), `normal`, or a named exception',
].join(' | ');

function parserSelfTest() {
  const { fontSizes, spaces, trackings, findings } = scan('fixture.css', FIXTURE);
  const got = [
    `${fontSizes} font-size`,
    `${spaces} gap/padding/margin`,
    `${trackings} letter-spacing`,
    ...findings.map(({ site, detail }) => `${site} ${detail}`),
  ].join(' | ');
  return got === SELF_TEST_WANT ? null : `expected\n  ${SELF_TEST_WANT}\ngot\n  ${got}`;
}

/** @type {{ site: string, detail: string }[]} */
const findings = [];
/** @type {Map<string, string[]>} keyed `property:value`, valued by the sites that use it */
const exceptionsUsed = new Map();
let fontSizes = 0;
let spaces = 0;
let trackings = 0;

for (const file of cssFiles()) {
  const seen = scan(file, readFileSync(join(ROOT, file), 'utf8'));
  fontSizes += seen.fontSizes;
  spaces += seen.spaces;
  trackings += seen.trackings;
  findings.push(...seen.findings);
  for (const { key, site } of seen.exceptionsUsed) {
    if (!exceptionsUsed.has(key)) exceptionsUsed.set(key, []);
    exceptionsUsed.get(key)?.push(site);
  }
}

console.log(
  `scale: ${fontSizes} font-size, ${spaces} gap/padding/margin and ${trackings} letter-spacing ` +
    `declaration(s) across ${cssFiles().length} file(s) in ${CORPUS}`,
);

// Before the findings, because a green run on a pattern that matched nothing is the worse failure.
const parserFault = parserSelfTest();
if (parserFault) {
  console.error(`\nthe scale parser is broken: ${parserFault}`);
  console.error(`\nThis check is vacuous — it would report nothing whatever the stylesheets hold. Fix the`);
  console.error(`pattern in tools/check-scale.mjs; do NOT relax the fixture.`);
  process.exit(1);
}

// An exception nothing exercises is an exception that would pass an empty tree, so a stale row is a
// finding in its own right — the mechanism check-tokens.mjs applies to `UNCONSUMED`.
//
// AND A SECOND CONSUMER IS A FINDING TOO, which it was not: both maps are keyed by VALUE, and the
// reason written down for that — *"both values are unique in the tree, and a selector-keyed map would
// need this check to become rule-aware for two rows"* — was an ASSUMPTION the run never tested.
// Pasting `.brand`'s wordmark tracking onto `.dock-tab` exited 0: one rule's argued exception had
// silently become the app's second-choice tracking value, and nothing here could see it. Counting the
// sites turns the stated reason into a checked one without making this file rule-aware, which is the
// cheapest repair that closes it. `inherit` is the row that must be allowed many consumers — it is
// allowed BY CONSTRUCTION rather than by exception (see its reason), so it is excluded by name.
const EXCEPTION_MAY_REPEAT = new Set(['font-size:inherit']);
const EXCEPTIONS = [
  ...[...OFF_SCALE_ON_PURPOSE].map(([value, reason]) => ['font-size', value, reason]),
  ...[...TRACKING_ON_PURPOSE].map(([value, reason]) => ['letter-spacing', value, reason]),
];
for (const [property, value, reason] of EXCEPTIONS) {
  const key = `${property}:${value}`;
  const sites = exceptionsUsed.get(key);
  if (!sites) {
    findings.push({
      site: 'tools/check-scale.mjs',
      detail: `\`${property}: ${value}\` is written down as off the scale on purpose (${reason.slice(0, 60)}…) and no rule uses it — delete the row`,
    });
    continue;
  }
  if (sites.length > 1 && !EXCEPTION_MAY_REPEAT.has(key)) {
    findings.push({
      site: 'tools/check-scale.mjs',
      detail:
        `\`${property}: ${value}\` is one rule's argued exception (${reason.slice(0, 60)}…) and ` +
        `${sites.length} rules use it: ${sites.join(', ')} — an exception with a second consumer is a ` +
        `value, so either put the second one on the scale or the reason no longer holds`,
    });
  }
}

if (findings.length > 0) {
  console.error(`\n${findings.length} declaration(s) off the scale:\n`);
  for (const { site, detail } of findings) console.error(`  ${site} — ${detail}`);
  console.error(`\nGive each one the nearest step: --t-micro 11px, --t-small 12px, --t-body 13px,`);
  console.error(`--t-lead 15px, --t-title 18px; --s-1 2px, --s-2 4px, --s-3 6px, --s-4 8px, --s-5 12px,`);
  console.error(`--s-6 16px, --s-7 24px; --track 0.08em.`);
  console.error(`Do NOT add a step. If a surface looks wrong on the nearest one, the surface is wrong —`);
  console.error(`see docs/design-system.md. A value that is off the scale ON PURPOSE goes in`);
  console.error(`OFF_SCALE_ON_PURPOSE or TRACKING_ON_PURPOSE with its reason.`);
  process.exit(1);
}

console.log(
  `all ${fontSizes} font-size declarations are one of the ${TYPE_SCALE.length} type steps; all ${spaces} ` +
    `space declarations are on the ${SPACE_SCALE.length}-step grid; all ${trackings} letter-spacings are ` +
    `var(${TRACK}) or one of the ${TRACKING_ON_PURPOSE.size} named exceptions`,
);
