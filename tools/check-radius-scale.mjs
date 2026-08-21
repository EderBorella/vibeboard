#!/usr/bin/env node
//
// Two claims about the FILES, both of them things the browser harness cannot make.
//
//   1. Every `border-radius` authored in web/src/*.css is one of the four steps of the radius scale,
//      or `50%`. BLOCKING at zero.
//   2. No rule outside the primitive stylesheet declares `border-radius`, `padding` or `font-size`
//      for a class that is rendered on a `<button>`. A RATCHET, not zero — see below.
//
// WHY THIS EXISTS BESIDE `npm run visual`, WHICH ALREADY ASSERTS THE FIRST ONE.
//
// It does not assert the same thing, and Phase 2 proved the gap by planting a defect: `0.81rem` on
// `.exec-head`, an Execution-tab-only rule, made `npm run check:type-scale` exit 1 while `npm run
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
// WHAT CLAIM 2 CATCHES: a `<button className="x">` OR a `<Button className="x">` in a .tsx file whose
// class `x` is given a `border-radius`, a `padding` (or `padding-top`, `-right`, `-bottom`, `-left`) or
// a `font-size` by any rule in a stylesheet other than the primitive one.
// WHAT IT DOES NOT CATCH, and none of these is hypothetical:
//   - a class reaching a button through a variable or a helper, rather than as a literal in the
//     element's own `className`. It reads the attribute text, not the render — which is why
//     `.confirm-go`, whose class arrives through a ternary, never appeared in the census.
//   - geometry applied by a selector that never names the class — `.dock-strip > button`,
//     `.copilot-actions button`, `button, input, select, textarea`. Element-selector rules are
//     invisible to it, and `.copilot-actions button` really is one of them.
//   - anything about an `<a>`, a `<div role="button">` or an `<input type="submit">`.
// The `<Button className>` hole USED to be on this list, and reading `<Button>` closed it — see the
// comment on TAGS. It was not hypothetical either: it opened up the moment 27 classes migrated.
// It is a real subset of "no rule outside the primitive block declares geometry for a button-shaped
// element", stated so nobody mistakes it for the whole.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = 'web/src';
const TOKENS_FILE = 'web/src/themes.css';
// The primitive stylesheet. Rules here are the ONE place a button's geometry may be decided.
const PRIMITIVES = join('web', 'src', 'ui', 'primitives.css');
const RADIUS_SCALE = ['--r-sm', '--r-md', '--r-lg', '--r-pill'];

// A VALUE MAY BE OFF THE SCALE ON PURPOSE, and then it is written here with its reason rather than
// left to be rediscovered.
/** @type {Map<string, string>} */
const OFF_SCALE_ON_PURPOSE = new Map([
  [
    '50%',
    "A CIRCLE, and it cannot be expressed as a length without knowing the box width — `--r-pill`'s " +
      '999px would be a claim about a stadium. Owned by the Dot primitive; the one other consumer is ' +
      '`.copilot-status .status-dot`, which Phase 5 folds into Dot.',
  ],
  [
    'var(--radius)',
    'THE SAME 10px AS `--r-lg`, and both names are live on purpose. Phase 1 of docs/design-system.md ' +
      'ruled that `--radius` is deleted in the phase where a surface primitive owns its four ' +
      'consumers (.archive-drawer, .column, .exec-column, .halt) — that is Panel, in Phase 4. ' +
      'Renaming a token while no caller exists buys nothing and splits the revert.',
  ],
]);

// The floor. A REGEX THAT STOPS MATCHING IS THE FAILURE MODE OF A CHECK LIKE THIS: it reports zero
// findings, exits 0, and looks exactly like success. Set well under what the tree holds, so it catches
// "matched nothing" and not ordinary editing.
//
// THERE IS NO FLOOR ON THE BUTTON-CLASS POPULATION ANY MORE, and removing it was forced rather than
// chosen. It was 30 against a population of 50, and this commit's migration took the population to 23 —
// so a floor that was doing its job failed the run for SUCCEEDING. The flaw is structural: claim 2's
// population shrinks to zero as the backlog clears, which is the goal, so any floor on it must
// eventually be bypassed or deleted. Its replacement is `parserSelfTest` below, which asserts the
// pattern still matches a fixture the tree cannot move — it works identically at a population of 50 and
// at 0. Do NOT put a count floor back here.
const FLOOR = { radius: 60 };

// WHAT CLAIM 2 STANDS AT. 56 before Phase 3; 46 when the primitives landed; **22** after the adoption
// was finished, which is the number here. The 24 that went in that second pass are `.btn-primary`,
// `.btn-secondary` and `.btn-danger` (37 call sites between them, and exactly `primary`, `default` and
// `danger` at `md` under their old names), `.archive-restore`, `.confirm-cancel`, `.chat-new`,
// `.cards-raw`, `.copilot-reset`, `.cs-action`, `.dispatch-back`, `.option-btn`, `.switch-btn`, and the
// twelve bare glyph buttons that became `Button`'s fifth variant — `.modal-close`, `.mp-modal-close`,
// `.cards-tab-x`, `.res-del`, `.chat-del`, `.tile-archive`, `.column-add`, `.control-new`, `.mp-star`,
// `.dock-collapse`, `.tag-filter-clear`, `.cv-link-edit`.
//
// The 22 that remain each have a reason recorded in docs/design-system.md, and they are four kinds:
// tabs and segmented cells (the group owns the border), select triggers, list rows, and chips. Phases 4
// and 5 own them. NEVER raise this: a ratchet that moves the wrong way is a gate switched off in place.
const BUTTON_GEOMETRY_CEILING = 22;

const GEOMETRY = [
  'border-radius',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-size',
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

// The tokens the stylesheet actually defines, so a name can be RESOLVED and not merely recognised:
// `var(--r-mdd)` matches any `--r-*` shape, resolves to nothing, and makes the declaration invalid at
// computed-value time — so the corner silently squares off and the file passes a check that only ever
// read the shape of the name.
const defined = new Set(
  [...readFileSync(join(ROOT, TOKENS_FILE), 'utf8').matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]),
);

// Every rule in a stylesheet, as `{ file, line, selector, body }`. Brace-matched rather than
// regex-split, because `@media`/`@container`/`@supports` nest and a flat regex reads their prelude as
// a selector.
function rules(file) {
  const raw = readFileSync(join(ROOT, file), 'utf8');
  // Comments blanked rather than removed, so every offset still maps to its real line.
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out = [];
  const stack = [];
  let selStart = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{') stack.push({ selector: text.slice(selStart, i).trim(), start: i + 1 });
    else if (c === '}') {
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

/** @type {{ site: string, detail: string }[]} */
const findings = [];
let radiusDecls = 0;

// ---------- claim 1: every authored radius is on the scale ----------
for (const file of walk('.css')) {
  for (const rule of rules(file)) {
    for (const match of rule.body.matchAll(/border-radius:\s*([^;}]+?)\s*(?=[;}])/g)) {
      radiusDecls += 1;
      const whole = match[1].trim();
      if (OFF_SCALE_ON_PURPOSE.has(whole)) continue;
      const site = `${file}:${rule.line}`;
      // The shorthand takes up to four values — the chat bubbles' tail corner is one of them — so each
      // is checked on its own. A single off-scale corner is exactly as visible as four.
      for (const value of whole.split(/\s+/)) {
        if (OFF_SCALE_ON_PURPOSE.has(value)) continue;
        const token = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
        if (!token) {
          findings.push({ site, detail: `border-radius: ${value} — not a step on the scale` });
        } else if (!RADIUS_SCALE.includes(token)) {
          findings.push({ site, detail: `border-radius: var(${token}) — not one of the four steps` });
        } else if (!defined.has(token)) {
          findings.push({ site, detail: `border-radius: var(${token}) — defined in no stylesheet` });
        }
      }
    }
  }
}

// ---------- claim 2: geometry for a button-shaped class lives in the primitive stylesheet ----------
// Every class that appears as a literal in a `<button>`'s own `className`. A `${...}` hole is skipped:
// that is a composed class, which Phase 3 exists to remove and which this cannot resolve anyway.
// The end of an element's opening tag: the first `>` outside any `{}`. A naive `indexOf('>')` stops
// inside `onClick={() => ...}` and reads half a tag, which silently loses every className written
// after a handler. Its own function because the brace scan is a separate concern from the census, and
// because the complexity metric punishes nesting far more than length.
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
  // Neither of these is a button, and a pattern that swept them up would inflate the census.
  '<ButtonRow className="epsilon">x</ButtonRow>',
  '<div className="zeta">x</div>',
].join('\n');

// IT MUST GO THROUGH THE SAME FUNCTIONS THE CENSUS USES, and the first version did not: it carried its
// own `/<button\b/` and so had no opinion about `TAGS` at all. Planting `TAGS = ['<buttonXX', …]` made
// the census find 0 classes and 0 findings and exit **0** — the exact vacuous green this test exists to
// refuse, sailing straight past the test meant to refuse it. A self-test that does not call the code
// under test is decoration.
function parserSelfTest() {
  const seen = TAGS.flatMap((tag) => openTagsOf(FIXTURE, tag)).flatMap((t) => classesIn(t.attrs));
  const want = 'alpha,beta,gamma,delta';
  // Not sorted: TAGS' order is part of what is asserted, so `<button`'s two come before `<Button`'s.
  return seen.join(',') === want ? null : `expected [${want}], parsed [${seen.join(',')}]`;
}

// BOTH `<button>` AND `<Button>`, and the second half was forced by a hole this check's own header
// admitted to and the Phase 3 adoption then drove a bus through. It read literal `<button>` only, so
// migrating 27 classes onto `<Button className="…">` moved every one of them OUT of the population —
// and a `padding` planted on `.cs-action` after the migration exited **0**. The ratchet would have gone
// on falling while the geometry it was counting quietly moved somewhere it could not look.
//
// `<Button>`'s `className` is documented as layout-only. This is what makes that documentation a gate:
// a class on a `<Button>` is a class on a button-shaped element, and the primitive owns its box.
const TAGS = ['<button', '<Button'];

// Every opening tag of `tag` in `text`, as `{ attrs, line }`. Its own function because the two nested
// loops it removes cost more in the complexity metric than the whole of the rest of this file — the
// metric punishes nesting far harder than length, and flattening beat extracting the body.
function openTagsOf(text, tag) {
  // `\b` would let `<button` match `<Button` under a case-insensitive read, and would let `<Button`
  // match `<ButtonRow`; the next character must not continue the name.
  return [...text.matchAll(new RegExp(`${tag}(?![\\w-])`, 'g'))]
    .map((open) => ({ open: open.index, end: openTagEnd(text, open.index + tag.length) }))
    .filter(({ end }) => end >= 0)
    .map(({ open, end }) => ({ attrs: text.slice(open, end), line: lineOf(text, open) }));
}

function buttonClasses() {
  /** @type {Map<string, string[]>} */
  const found = new Map();
  const tags = walk('.tsx').flatMap((file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    return TAGS.flatMap((tag) => openTagsOf(text, tag).map((t) => ({ file, ...t })));
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
  .filter((file) => file !== PRIMITIVES)
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
  `button geometry: ${onButton.size} class(es) literal on a <button> or <Button>, ${geometry.length} of them given geometry outside ${PRIMITIVES}`,
);

// Before the findings, because a green run on a pattern that matched nothing is the worse failure.
if (radiusDecls < FLOOR.radius) {
  console.error(`\nonly ${radiusDecls} border-radius found, against a floor of ${FLOOR.radius}.`);
  console.error(`This check is vacuous: the pattern has stopped matching the tree. Fix the pattern in`);
  console.error(`tools/check-radius-scale.mjs — do NOT lower the floor.`);
  process.exit(1);
}

const parserFault = parserSelfTest();
if (parserFault) {
  console.error(`\nthe <button> parser is broken: ${parserFault}.`);
  console.error(`Claim 2 is vacuous — it would report zero findings whatever the tree holds. Fix the`);
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
  console.error(`increase, not the backlog. Render the new control with <Button> from web/src/ui/Button.tsx`);
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
