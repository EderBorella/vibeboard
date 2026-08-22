#!/usr/bin/env node
//
// FOUR CLAIMS ABOUT THE BOXES, over every `.css` under web/src. Phase 4 of notes/atomic-revamp-plan.md.
//
// Run it with: npm run check:box-scale
//
//   1. Every authored `height`/`min-height` is `var(--ctl-h)`, `var(--mark-h)`, `0`, `auto`, `100%`, a
//      `vh`/`dvh` value, `var(--tile-h)`, or a named exception with its reason.
//   2. Every authored border WIDTH is `1px`, `var(--rule)`, `0`, or a named exception.
//   3. Every `box-shadow` is `var(--glow)`, `var(--lift)`, a comma-pair of the two, or `none`.
//   4. Every `z-index` is one of the four `--z-*` tokens.
//
// All four blocking at zero, because all four reached zero in the commit that added the file — the rule
// this repository keeps: a gate pointed at a backlog gets bypassed on every commit, which teaches
// everyone to ignore it.
//
// WHY A NEW FILE RATHER THAN ARMS ON `check-radius-scale.mjs`. That gate's second instrument is a RATCHET
// ON A CLASS COUNT — how many button-shaped classes declare their own geometry — and a count cannot see a
// new PROPERTY on a class it has already counted. `height: 30px` on `.tab-btn` moves no count: the class
// was in the census before and after. A property-level claim needs a property-level census, which is this.
// (`height` and `min-height` joined that gate's geometry list in the same commit, and joined the chip and
// control geometry lists in `check-shape-coverage.mjs`. Same classes, so its three numbers did not move.)
//
// WHY EACH CLAIM, and every one is a defect this tree really had:
//
//   1. TEN CONTROL HEIGHTS, and the diagnosis is the whole reason the revamp exists. A height nobody
//      declares is a height nobody chose — it is padding plus a line box plus a border — so a BADGE
//      inside a tab made the tab 1px taller than the tab beside it, and a `Button size="md"` was a
//      different box from a `Button size="sm"` in a way nobody asked for. Two tokens now: one for a box
//      you operate and one for a box you read.
//   2. ELEVEN `border-left` RAILS DOING ONE JOB, split 6:5 between 3px and 2px by nothing at all —
//      `--tone`, `--accent` and `--border` each appeared on both sides of that split. `1px` stays a bare
//      literal on purpose: it SEPARATES, it does not MEAN, and a token for it would be a token for every
//      edge in the app.
//   3. FOUR SHADOWS OVER SEVEN BLUR RADII making one statement — "this surface is off the page". The
//      four disagreed only by accident.
//   4. NINE `z-index` VALUES AND A 20/21 ADJACENCY, where two siblings one apart meant DOM order was
//      really deciding, and a `.halt-backdrop` whose own comment says it is above the confirm dialog sat
//      20 BELOW it.
//
// WHAT IT DELIBERATELY DOES NOT CATCH:
//   - `max-height`. A ceiling is not a height: `max-height: 70vh` on a help body and
//     `calc(var(--tile-h) * 3 + var(--s-4) * 4)` on a column are measures of how much of the viewport a
//     scrolling region may take, and they are answerable by no token.
//   - A height from an INLINE STYLE or a `style={{…}}` prop. Nothing in `web/src` sets one today; that is
//     the browser harness's business, and checks 12 and 13 measure the boxes themselves.
//   - WHETHER A VALUE IS RIGHT. `--ctl-h: 3px` passes here. Also the harness's business.
//   - `border-style` and `border-color`. The dashed ghost is a deliberate style and the tone rails are
//     deliberately five colours; only the WIDTH is a geometry.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rulesOf, shapedRules } from './lib/css.mjs';
import { walk as walkFiles } from './lib/source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = 'web/src';
const TOKENS_FILE = 'web/src/design/tokens.css';

// A SMOKE ALARM, NOT A TARGET — see walk() in lib/source.mjs. 53 sheets today, floored an order of
// magnitude below so that deleting one never fails the run.
const FLOOR = { '.css': 3 };

const HEIGHTS = ['--ctl-h', '--mark-h', '--tile-h'];
const Z_LAYERS = ['--z-chrome', '--z-pop', '--z-modal', '--z-alert'];

// A HEIGHT THAT IS NOT A TOKEN, ON PURPOSE, keyed on `selector | value` so the row is exercised by one
// rule and one rule only — the lesson from `check-scale.mjs`, whose tracking exceptions were keyed on
// the VALUE and so silently excused a second consumer that pasted it.
/** @type {Map<string, string>} */
const OFF_SCALE_ON_PURPOSE = new Map([
  [
    '.vb-dot | 8px',
    'A CIRCLE IS A WIDTH AND A HEIGHT, and it cannot be one of the two box heights without ceasing to ' +
      'be a circle. `50%` is off the radius scale in the same file for the same reason. ONE ROW WHERE ' +
      'THERE WERE THREE: `.vb-dot-7`, `-8` and `-12` were the agent chip, the transport and the ' +
      'connection light, and nothing chose the spread — the light was 12px because it was written first ' +
      'and largest. `StatusChip` absorbed the pip and one size is left, which is what the atom phase ' +
      'said this row was waiting for.',
  ],
  [
    '.popover::before | 8px',
    'A ROTATED SQUARE. The popover’s pointer is an 8×8 box turned 45°, so its height IS its width by ' +
      'construction and a box height would make it a rectangle.',
  ],
  [
    '*::-webkit-scrollbar | 9px',
    'A SCROLLBAR METRIC: a horizontal bar’s thickness is its HEIGHT, so the same 9px has to be said twice. ' +
      'The plan names two scrollbar rows and there is one — `.column-body::-webkit-scrollbar` sets a wider ' +
      'bar for a board column, and it sets only the `width`, which this gate does not read.',
  ],
  [
    '.raw-pane .raw-area | 14rem',
    'A TEXTAREA FLOOR, not a height: `--ctl-h` is one line and this holds a whole card file. How much ' +
      'room the box STARTS with is the surface’s, which is why atoms/control.css withdraws the height ' +
      'for `textarea` and says so.',
  ],
  ['.diary-compose > .vb-ctl | 2.6rem', 'The diary composer’s floor — see .raw-pane .raw-area.'],
  [
    '.cv-tags-edit | 1.4rem',
    'The card view’s inline tag editor floor. The plan counted two rem floors and there are THREE; this ' +
      'is the third, and it is the same kind — an inline field that grows with what is typed into it.',
  ],
  [
    '.drop-line | 2px',
    'A DRAG INDICATOR IS A LINE, and it is the one place in the app where a height IS the ink: it draws ' +
      'where the card will land. Not `--rule`: that is an edge that carries meaning ON a box, and this ' +
      'is not on a box.',
  ],
  [
    '.ctx-bar | 5px',
    'A PROGRESS TRACK. Its height is a proportion of the row it sits in rather than a box you operate ' +
      'or read, and `.ctx-fill` inside it is `100%`.',
  ],
]);

// A BORDER WIDTH THAT IS NEITHER 1px NOR `--rule`, keyed on `selector | value` for the reason the height
// map is: a row is exercised by one rule and one rule only.
/** @type {Map<string, string>} */
const BORDER_ON_PURPOSE = new Map([
  [
    '.column-body::-webkit-scrollbar-thumb | 3px solid transparent',
    'A PADDING WEARING A BORDER’S NAME. `background-clip: content-box` makes a transparent border the ' +
      'only way to inset a scrollbar thumb inside its track, so this 3px is a SPACE and not an edge — ' +
      'which is why it is not `--rule`, even though it spells the same number. `--rule` is the edge that ' +
      'CARRIES MEANING, and giving it to this thumb would mean a rail widened because an owner could not ' +
      'see it silently made the thumb thinner. The eleven rails the token was created for are all ' +
      '`border-left`. Same family as the 9px scrollbar row in the height map above.',
  ],
]);

const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const walk = (ext) => walkFiles(ROOT, CORPUS, ext, FLOOR[ext] ?? 1);

// The tokens the primitive layer really DEFINES, so a name can be resolved rather than merely
// recognised: `var(--ctl-hh)` matches the shape of a name, resolves to nothing, and leaves the box its
// content height while passing a check that only read the shape.
const defined = new Set([...read(TOKENS_FILE).matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));

const site = (rule) => `${rule.file}:${rule.line}`;
// The FIRST class in the selector, or the selector itself: what the exception maps are keyed on. Keyed
// on the whole selector rather than the value, so a row is exercised by exactly one rule.
const key = (selector, value) => `${selector.trim()} | ${value.trim()}`;

// ---------- arm 1: heights ----------
// `0`, `auto`, `100%`, a viewport unit, one of the two box heights, or the board's tile.
function heightFault(prop, value, selector, exceptions) {
  if (exceptions.has(key(selector, value))) return null;
  if (/^(0|auto|100%|fit-content|min-content|max-content|inherit)$/.test(value)) return null;
  if (/^\d*\.?\d+(?:vh|dvh|svh|lvh)$/.test(value)) return null;
  const token = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  if (!token) return `${prop}: ${value} — not a declared box height`;
  if (!HEIGHTS.includes(token)) return `${prop}: var(${token}) — not one of ${HEIGHTS.join(', ')}`;
  if (!defined.has(token)) return `${prop}: var(${token}) — defined in no stylesheet`;
  return null;
}

// ---------- arm 2: border widths ----------
// The shorthand's width is whichever part is a length or a width word; `border: none` has none to check,
// a bare colour (`border-color`) is not this arm's business, and `var(--rule)` is the token form — which
// needs no clause of its own, because it is not a length and not a width word.
//
// EVERY LENGTH IN THE VALUE, AND NOT THE FIRST ACCEPTABLE ONE. The first draft returned `null` the moment
// it saw a `1px`, which read `border-width: 1px 4px` — four longhands in one declaration — as compliant on
// the strength of its first part. A declaration carrying two widths is precisely where the second hides.
const WIDTH_WORD = /^(thin|medium|thick)$/;
const LENGTH = /^\d*\.?\d+(?:px|rem|em)?$/;
function borderFault(prop, value, selector, exceptions) {
  if (exceptions.has(key(selector, value))) return null;
  const parts = value.split(/\s+/).filter(Boolean);
  for (const part of parts) {
    if (WIDTH_WORD.test(part)) return `${prop}: ${value} — \`${part}\` is a width nobody chose`;
    if (!LENGTH.test(part)) continue;
    if (part !== '1px' && part !== '0') return `${prop}: ${value} — ${part} is neither 1px nor var(--rule)`;
  }
  return null;
}

// ---------- arm 3: shadows ----------
const SHADOW_PART = /^var\((--glow|--lift)\)$/;
function shadowFault(value) {
  if (value === 'none') return null;
  const parts = value.split(',').map((p) => p.trim());
  // A comma-pair of the two tokens is the one composite the tree makes: a lit surface that also floats.
  if (parts.every((p) => SHADOW_PART.test(p))) return null;
  return `box-shadow: ${value} — not var(--glow), var(--lift), a comma-pair of the two, or none`;
}

// ---------- arm 4: layers ----------
function layerFault(value) {
  const token = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  if (!token) return `z-index: ${value} — not one of the four layers`;
  if (!Z_LAYERS.includes(token)) return `z-index: var(${token}) — not one of ${Z_LAYERS.join(', ')}`;
  if (!defined.has(token)) return `z-index: var(${token}) — defined in no stylesheet`;
  return null;
}

// ---------- the census ----------
// One pass, four arms, so a rule is parsed once and the four counts are of the same population.
const HEIGHT_PROP = /(?:^|[;{\s])(height|min-height)\s*:\s*([^;}]+?)\s*(?=[;}])/g;
const BORDER_PROP =
  /(?:^|[;{\s])(border|border-top|border-right|border-bottom|border-left|border-width|border-top-width|border-right-width|border-bottom-width|border-left-width)\s*:\s*([^;}]+?)\s*(?=[;}])/g;
const SHADOW_PROP = /(?:^|[;{\s])box-shadow\s*:\s*([^;}]+?)\s*(?=[;}])/g;
const Z_PROP = /(?:^|[;{\s])z-index\s*:\s*([^;}]+?)\s*(?=[;}])/g;

// A CUSTOM PROPERTY IS NOT A DECLARATION OF THE THING IT IS NAMED AFTER: `--border: #1f333b` in a theme
// block is a colour, and a border arm that read it would report every palette as a fault. The leading
// boundary in each pattern above is what excludes `--border`, and this is the test that says so.
//
// THE TWO EXCEPTION MAPS ARE ARGUMENTS AND NOT CLOSED-OVER CONSTANTS, and it is the self-test that forced
// it. `key()` and the two `has()` calls were the one path in this file no fixture could reach: with the
// real maps closed over, a `key()` that returned a CONSTANT would have excused every declaration in the
// tree and marked every row exercised, so all four arms would go silently blind and the run would exit 0.
// Passing the maps in lets the fixture carry two rows the tree cannot move — one that must suppress, and
// one with the SAME VALUE on a different selector that must NOT — which is Phase 3's finding stated as a
// test rather than as a comment.
export function censusOf(ruleList, heights = OFF_SCALE_ON_PURPOSE, borders = BORDER_ON_PURPOSE) {
  const counts = { height: 0, border: 0, shadow: 0, layer: 0 };
  /** @type {{ site: string, detail: string }[]} */
  const findings = [];
  for (const rule of shapedRules(ruleList)) {
    const add = (detail) => detail && findings.push({ site: site(rule), detail });
    for (const m of rule.body.matchAll(HEIGHT_PROP)) {
      counts.height += 1;
      add(heightFault(m[1], m[2].trim(), rule.selector, heights));
    }
    for (const m of rule.body.matchAll(BORDER_PROP)) {
      counts.border += 1;
      add(borderFault(m[1], m[2].trim(), rule.selector, borders));
    }
    for (const m of rule.body.matchAll(SHADOW_PROP)) {
      counts.shadow += 1;
      add(shadowFault(m[1].trim()));
    }
    for (const m of rule.body.matchAll(Z_PROP)) {
      counts.layer += 1;
      add(layerFault(m[1].trim()));
    }
  }
  return { counts, findings };
}

// ---------- the self-test ----------
// THROUGH THE CENSUS'S OWN FUNCTIONS, for the reason every gate in this directory states: a self-test
// carrying its own copy of a pattern has no opinion about the code under test, and that mistake has been
// made twice in this repository.
//
// Every branch that can silently stop matching is exercised once: a comment naming all four properties in
// prose (which must NOT be read as declarations, and must not shift the line numbers of what follows);
// the compact no-whitespace form these stylesheets are written in; `min-height` as well as `height`;
// `--border` as a DEFINITION, which the border arm must not read; a `border-left` shorthand whose width
// is in the middle of the value; a shadow comma-pair, which is legal, against a hand-written shadow,
// which is not; `line-height`, which the height pattern must not match; and a rule nested in an at-rule,
// the case a flat regex reads as a selector.
//
// AND THE EXCEPTION MAPS THEMSELVES, WHICH NO FIXTURE REACHED BEFORE. `.lambda` and `.mu` declare the
// SAME height and the SAME border, and only `.lambda` is excused — so the pair fails if `key()` stops
// composing the selector with the value, which is the exact way `check-scale.mjs`'s tracking exceptions
// silently excused a pasted duplicate in Phase 3. A fixture with one row could not tell the two apart.
// `.nu` is the two-width declaration: `1px 4px` must report the 4px, not pass on the 1px.
const FIXTURE = `
/* height: 30px, border-left: 4px solid red, box-shadow: 0 1px 2px red and z-index: 21 in prose are
   not declarations. */
:root { --border: #1f333b; --ctl-h: 28px; }
.alpha { height: var(--ctl-h); line-height: 1.45; }
.beta{height:30px;min-height:3rem;}
.gamma { border-left: var(--rule) solid var(--accent); border: 1px solid transparent; }
.delta { border-left: 4px solid var(--accent); border-width: thick; }
.epsilon { box-shadow: var(--glow), var(--lift); }
.zeta { box-shadow: 0 8px 24px rgba(0,0,0,.35); }
.eta { z-index: var(--z-pop); }
.theta { z-index: 21; }
.iota { height: var(--mark-h); min-height: 0; }
@media (min-width: 1px) { .kappa { height: 44px; } }
.lambda { height: 5px; border: 2px dashed var(--border); }
.mu { height: 5px; border: 2px dashed var(--border); }
.nu { border-width: 1px 4px; }
`;

// The fixture's OWN exception maps, and they are the fixture's rather than the tree's for the reason
// every self-test in this directory is: a row keyed on a real selector would make the test move whenever
// the tree did, and this fixture exists precisely because the tree cannot move it.
const FIXTURE_HEIGHTS = new Map([['.lambda | 5px', 'the suppressed row']]);
const FIXTURE_BORDERS = new Map([['.lambda | 2px dashed var(--border)', 'the suppressed row']]);

const SELF_TEST_WANT = [
  'counts height 8 border 7 shadow 2 layer 2',
  'fixture.css:6 height: 30px — not a declared box height',
  'fixture.css:6 min-height: 3rem — not a declared box height',
  'fixture.css:8 border-left: 4px solid var(--accent) — 4px is neither 1px nor var(--rule)',
  'fixture.css:8 border-width: thick — `thick` is a width nobody chose',
  'fixture.css:10 box-shadow: 0 8px 24px rgba(0,0,0,.35) — not var(--glow), var(--lift), a comma-pair of the two, or none',
  'fixture.css:12 z-index: 21 — not one of the four layers',
  'fixture.css:14 height: 44px — not a declared box height',
  'fixture.css:16 height: 5px — not a declared box height',
  'fixture.css:16 border: 2px dashed var(--border) — 2px is neither 1px nor var(--rule)',
  'fixture.css:17 border-width: 1px 4px — 4px is neither 1px nor var(--rule)',
].join(' | ');

function selfTest() {
  const { counts, findings } = censusOf(rulesOf('fixture.css', FIXTURE), FIXTURE_HEIGHTS, FIXTURE_BORDERS);
  const got = [
    `counts height ${counts.height} border ${counts.border} shadow ${counts.shadow} layer ${counts.layer}`,
    ...findings.map(({ site: where, detail }) => `${where} ${detail}`),
  ].join(' | ');
  return got === SELF_TEST_WANT ? null : `box census: expected\n  ${SELF_TEST_WANT}\ngot\n  ${got}`;
}

// ---------- the run ----------
const sheets = walk('.css');
const { counts, findings } = censusOf(sheets.flatMap((file) => rulesOf(file, read(file))));

console.log(
  `box scale: ${counts.height} height, ${counts.border} border-width, ${counts.shadow} box-shadow and ` +
    `${counts.layer} z-index declaration(s) across ${sheets.length} sheet(s) in ${CORPUS}`,
);

// Before the findings, because a green run on a pattern that matched nothing is the worse failure. There
// is no COUNT floor on any of the four: every number this file measures shrinks as the sweep succeeds,
// which is how two floors in this repository came to fail a run FOR SUCCEEDING. See the note in
// check-radius-scale.mjs where its floors used to be.
const parserFault = selfTest();
if (parserFault) {
  console.error(`\nthe box reader is broken: ${parserFault}`);
  console.error(`All four claims are vacuous — they would report nothing whatever the sheets hold. Fix the`);
  console.error(`patterns in tools/check-box-scale.mjs; do NOT relax the fixture.`);
  process.exit(1);
}

// AN EXCEPTION LIST NOBODY PRUNES WOULD PASS AN EMPTY TREE, which is the hole `check-tokens.mjs` closed
// on `UNCONSUMED` and `check-scale.mjs` closed on its tracking map. A row here that no rule exercises is
// a finding of its own.
const exercised = new Set();
for (const rule of shapedRules(sheets.flatMap((file) => rulesOf(file, read(file))))) {
  for (const m of rule.body.matchAll(HEIGHT_PROP)) exercised.add(key(rule.selector, m[2].trim()));
  for (const m of rule.body.matchAll(BORDER_PROP)) exercised.add(key(rule.selector, m[2].trim()));
}
const unused = [...OFF_SCALE_ON_PURPOSE.keys(), ...BORDER_ON_PURPOSE.keys()].filter(
  (row) => !exercised.has(row),
);

let failed = false;

if (findings.length > 0) {
  console.error(`\n${findings.length} box declaration(s) that no token accounts for:\n`);
  for (const { site: where, detail } of findings) console.error(`  ${where} — ${detail}`);
  console.error(`\nA box you OPERATE is var(--ctl-h) (28px) and a box you READ is var(--mark-h) (16px).`);
  console.error(`An edge that MEANS something is var(--rule); an edge that merely separates is 1px. A`);
  console.error(`surface that is off the page is var(--lift). A layer is one of the four --z-* names. Do`);
  console.error(`NOT add a token — a value that is off the scale ON PURPOSE goes in OFF_SCALE_ON_PURPOSE`);
  console.error(`or BORDER_ON_PURPOSE, keyed on its selector, with the reason a person can act on.`);
  failed = true;
}

if (unused.length > 0) {
  console.error(`\n${unused.length} exception row(s) that no rule exercises:\n`);
  for (const row of unused) console.error(`  ${row}`);
  console.error(`\nDelete each one. An exception list nobody prunes is a list that would pass an empty`);
  console.error(`tree, which is exactly what \`--scan\` did for three palettes.`);
  failed = true;
}

if (failed) process.exit(1);

console.log(
  `every height is a declared box height, every edge is 1px or var(--rule), every shadow is var(--glow) ` +
    `and/or var(--lift), and every layer is one of the four; ` +
    `${OFF_SCALE_ON_PURPOSE.size + BORDER_ON_PURPOSE.size} named exception(s), each exercised`,
);
