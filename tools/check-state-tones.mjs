#!/usr/bin/env node
//
// ONE STATE VOCABULARY. Phase 13 of docs/design-system.md, and five claims about it — all of them
// BLOCKING AT ZERO, because this gate lands in the commit that reaches zero rather than being pointed
// at a backlog.
//
//   1. Every row of `STATE_TONES` maps to one of `Tone`'s five names, and every one of the five is used
//      by at least one row. The second half is the anti-vacuity guard AND the ruling on `--ok`: a tone
//      no state reaches is a promise nobody kept, which is what `--ok` was.
//   2. Every row is NAMED in web/src. A table row nothing can produce is a dead row, and the direction
//      nothing else asks.
//   3. Every `data-state=` in web/src resolves to a row — literally, or through a `StateName`-typed
//      channel the compiler checks.
//   4. NO STYLESHEET SELECTOR CONTAINS `[data-state`. This is the claim the phase exists for, and it is
//      checkable only because the state → tone half moved into TypeScript.
//   5. `--tone` is ASSIGNED by exactly the five `.vb-tone-*` rules and by nothing else. That is what
//      makes "one table" a fact rather than a description: any other assignment is a second opinion.
//
// WHY EACH OF THE FIVE, and every one is a defect this tree really had rather than a hypothesis.
//
//   Twenty-six `[data-state]` rules across six surfaces each picked a token by hand, so `running` was
//   `--text` on a report chip, `--accent-2` on the top bar's chip and `--accent` on the auto-pilot
//   bar's rail — one fact, three colours, three surfaces read in one glance. Claim 4 is what stops that
//   coming back, and claim 5 is what stops it coming back one level down as a second `--tone`.
//
//   `.copilot-status.ok` and `.copilot-status.down` were a SEVENTH vocabulary that the census of six
//   missed entirely, because neither name looked like a state. Claim 3 is what closes that shape: a
//   surface's state has to reach the DOM as a `data-state` through a typed channel, so there is no
//   longer a bare class pair for a rule to hang a colour on. An arm aimed at the class NAMES was
//   written and removed — see stateNamingRules for the twelve correct rules it reported.
//
//   `data-state={s.state}` compiles whatever `s.state` is — React types every `data-*` as `any`. A
//   value with no row leaves `--tone` unset, the declaration invalid at computed-value time, and the
//   colour falls through to whatever was inherited, which reads as deliberate. That is the `--ink`
//   defect (tools/check-name-resolution.mjs) in a state's clothes, and claim 3 is why every raw
//   `data-state` sits beside a `stateClass(…)` or an `asState(…)`.
//
// WHAT IT DELIBERATELY DOES NOT CATCH:
//   - A ROLE THAT READS THE WRONG PROPERTY. A surface that spent `--tone` on `background` where it
//     meant `color` passes here; the role list is PRINTED on every run so it is at least visible, and
//     test/state-tones.test.tsx is what asserts what each surface renders.
//   - A TONE WHOSE TOKEN IS WRONG. `.vb-tone-ok { --tone: var(--danger) }` passes. That is the browser
//     harness's contrast check and test/state-inks.test.tsx's business.
//   - A STATE REACHED THROUGH A VARIABLE. `className={cls}` where `cls` was built elsewhere is invisible
//     to claim 3, the same blind spot check-shape-coverage.mjs names for its own arm 2.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rulesOf, shapedRules } from './lib/css.mjs';
import { openTagEnd } from './lib/jsx.mjs';
import { codeOf, lineOf, walk as walkFiles } from './lib/source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = 'web/src';
const TABLE = 'web/src/molecules/state-tones.ts';

// A SMOKE ALARM, NOT A TARGET — see walk() in lib/source.mjs. An order of magnitude under the real
// counts (26 rows, 9 `data-state` sites, 3 stylesheets).
const FLOOR = { rows: 8, sites: 4, sheets: 2 };

const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const walk = (corpus, ext, atLeast) => walkFiles(ROOT, corpus, ext, atLeast);

// ---------- the table ----------
// READ OUT OF THE SOURCE rather than imported, and that is not squeamishness about running TypeScript:
// the point of the check is that ONE object is the table, so the gate must read the same characters a
// person reads. Comments are blanked first, so a state named in the prose above the object — and there
// are several — is not mistaken for a row.
export function tableOf(source) {
  const code = codeOf(source);
  const open = code.indexOf('STATE_TONES = {');
  if (open < 0) return { tones: [], rows: new Map() };
  const body = code.slice(open, code.indexOf('} satisfies', open));
  const rows = new Map();
  for (const m of body.matchAll(/^\s*([a-z][\w-]*)\s*:\s*'([a-z][\w-]*)'\s*,/gm)) rows.set(m[1], m[2]);
  const decl = /export type Tone =([^;]*);/.exec(code);
  const tones = [...(decl?.[1] ?? '').matchAll(/'([a-z][\w-]*)'/g)].map((m) => m[1]);
  return { tones, rows };
}

// ---------- claim 3: where a state reaches the DOM ----------
// The opening tag a `data-state=` sits in: back to the nearest `<`, forward to the first `>` outside
// any `{}`. `openTagEnd` is shared with the other gates for the reason lib/jsx.mjs gives — a naive
// `indexOf('>')` stops inside `onClick={() => x > 1 && go()}`.
export function tagAround(code, at) {
  const open = code.lastIndexOf('<', at);
  if (open < 0) return '';
  const end = openTagEnd(code, open);
  return end < 0 ? code.slice(open) : code.slice(open, end);
}

// The value written after `data-state=`, as `{ literal }` or `{ expression }`.
export function stateValueAt(code, from) {
  if (code[from] === '"' || code[from] === "'") {
    const close = code.indexOf(code[from], from + 1);
    return { literal: code.slice(from + 1, close < 0 ? undefined : close) };
  }
  if (code[from] !== '{') return {};
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return { expression: code.slice(from + 1, i).trim() };
    }
  }
  return {};
}

// Is this site's value checked by the compiler? Three ways, and each is a real call site rather than a
// category invented to make the gate pass.
//
//   `stateClass(` IN THE SAME TAG — the surface that also takes a colour from the state. The call is
//   what the compiler checks; the attribute beside it is a hook.
//   `asState(` AROUND IT — the one surface that carries the attribute and takes NO colour from it.
//   A PROP THE SAME FILE ANNOTATES `StateName` — the three primitives, where the value arrives already
//   typed and re-wrapping it would be noise.
export function checkedBy(expression, tag, fileCode) {
  if (/\bstateClass\s*\(/.test(tag)) return 'stateClass() in the same tag';
  if (/\basState\s*\(/.test(expression)) return 'asState()';
  const bare = /^([A-Za-z_$][\w$]*)$/.exec(expression);
  if (bare && new RegExp(`\\b${bare[1]}\\??\\s*:\\s*StateName\\b`).test(fileCode)) {
    return `${bare[1]} is annotated StateName in this file`;
  }
  return null;
}

export function stateSites(sources) {
  const out = [];
  for (const { file, code } of sources) {
    for (const m of code.matchAll(/data-state=/g)) {
      const from = m.index + m[0].length;
      const { literal, expression } = stateValueAt(code, from);
      out.push({
        file,
        line: lineOf(code, m.index),
        literal,
        expression,
        checked: expression === undefined ? null : checkedBy(expression, tagAround(code, m.index), code),
      });
    }
  }
  return out;
}

// ---------- claims 4 and 5: what the stylesheets say ----------
// A rule NAMES A STATE if its selector carries `[data-state` at all. That is the whole arm, and it is
// enough BY CONSTRUCTION rather than by hope: claim 3 forces every state to reach the DOM through
// `data-state` plus a typed channel, so a rule that colours by state has nowhere else to say so.
//
// A SECOND ARM WAS WRITTEN, RAN, AND WAS REMOVED — "a class token that is one of the table's rows" —
// and the removal is the finding rather than a retreat. It was aimed at `.copilot-status.ok` and
// `.down`, the fifth mechanism no census counted. It reported TWELVE rules, every one of them correct:
// `.tab-btn.active`, `.tag-chip.active`, `.control-item.active` and nine more. `active` is a row in the
// table (a filed finding nobody has acted on) AND this app's selection modifier, on twelve elements
// none of which carries a `data-state`. Two different facts wearing one word — a real readability
// collision, and worth fixing by renaming one of them, but a gate that fires on twelve correct rules is
// a gate that gets switched off, which is worse than no gate. See docs/design-system.md.
//
// The arm it would have caught is closed another way: `.copilot-status`'s state IS a `data-state` now,
// so an `.ok`/`.down` pair there could not decide a colour without claim 3 refusing the value first.
export function stateNamingRules(sheets) {
  const out = [];
  for (const { file, css } of sheets) {
    for (const rule of shapedRules(rulesOf(file, css))) {
      if (rule.selector.includes('[data-state')) {
        out.push({ at: `${file}:${rule.line}`, selector: rule.selector, why: ['a [data-state] selector'] });
      }
    }
  }
  return out;
}

// Every rule that ASSIGNS `--tone`, and every rule that READS it. The first must be exactly the five
// tone rules; the second is the role census, printed rather than constrained.
export function tonePlumbing(sheets) {
  const assigns = [];
  const reads = [];
  for (const { file, css } of sheets) {
    for (const rule of shapedRules(rulesOf(file, css))) {
      const at = `${file}:${rule.line}`;
      if (/--tone\s*:/.test(rule.body)) assigns.push({ at, selector: rule.selector, body: rule.body });
      for (const m of rule.body.matchAll(/([\w-]+)\s*:\s*[^;]*var\(\s*--tone/g)) {
        reads.push({ at, selector: rule.selector, property: m[1] });
      }
    }
  }
  return { assigns, reads };
}

// ---------- the self-test ----------
// Through the run's OWN functions, for the reason every other gate here states: a self-test carrying its
// own copy of a pattern has no opinion about the code under test, and that mistake has been made twice
// in this repository.
//
// Every row is a branch that can silently stop matching: a table row and a row whose tone is not one of
// the five; a state named ONLY in the prose above the object (which must NOT be a row — the comments in
// state-tones.ts name a dozen); a literal `data-state` that is a row and one that is not; an expression
// checked by `stateClass(` in the same tag, one checked by `asState(`, one checked by a `StateName`
// annotation, and one checked by NOTHING; an expression in a tag whose `>` sits inside a handler's
// arrow body (the `openTagEnd` trap); a `[data-state]` selector; a class that is a state name; a
// `--tone` assignment; and a `--tone` read.
const FIXTURE_TS = `
// A comment naming online and failed, neither of which is a row.
export type Tone = 'neutral' | 'ok';
export const STATE_TONES = {
  ready: 'ok',
  broken: 'nonesuch',
} satisfies Record<string, Tone>;
`;

const FIXTURE_TSX = `
const a = <div data-state="ready" />;
const b = <div data-state="nowhere" />;
const c = <div className={\`x \${stateClass(m.s)}\`} data-state={m.s} />;
const d = <div data-state={asState(s.state)} />;
const e = <Tag data-state={state} onClick={() => n > 1 && go()} />;
const f = <div data-state={who.ever} />;
interface P { state?: StateName }
`;

const FIXTURE_CSS = `
.ready { color: red }
.zeta[data-state='ready'] { color: red }
.vb-tone-ok { --tone: var(--ok); }
.vb-chip.vb-chip-tone { color: var(--tone); }
`;

const SELF_TEST_WANT = [
  'tones neutral,ok',
  'rows ready=ok,broken=nonesuch',
  'sites ready=row|nowhere=UNKNOWN|{m.s}=stateClass() in the same tag|{asState(s.state)}=asState()|' +
    '{state}=state is annotated StateName in this file|{who.ever}=UNCHECKED',
  // ONE finding and not two. The fixture keeps a `.ready` CLASS rule on purpose: the class arm was
  // written, ran, reported twelve correct rules and was removed — see stateNamingRules — and this row
  // is what makes its absence deliberate rather than an omission a reader has to guess about.
  "naming fixture.css:3 .zeta[data-state='ready'] (a [data-state] selector)",
  'assigns .vb-tone-ok',
  'reads .vb-chip.vb-chip-tone color',
];

function selfTest() {
  const { tones, rows } = tableOf(FIXTURE_TS);
  const sources = [{ file: 'fixture.tsx', code: codeOf(FIXTURE_TSX) }];
  const sheets = [{ file: 'fixture.css', css: FIXTURE_CSS }];
  const sites = stateSites(sources);
  const { assigns, reads } = tonePlumbing(sheets);
  const got = [
    `tones ${tones.join(',')}`,
    `rows ${[...rows].map(([k, v]) => `${k}=${v}`).join(',')}`,
    `sites ${sites
      .map((s) =>
        s.literal !== undefined
          ? `${s.literal}=${rows.has(s.literal) ? 'row' : 'UNKNOWN'}`
          : `{${s.expression}}=${s.checked ?? 'UNCHECKED'}`,
      )
      .join('|')}`,
    `naming ${stateNamingRules(sheets)
      .map((f) => `${f.at} ${f.selector} (${f.why.join(', ')})`)
      .join(', ')}`,
    `assigns ${assigns.map((a) => a.selector).join(',')}`,
    `reads ${reads.map((r) => `${r.selector} ${r.property}`).join(',')}`,
  ];
  for (const [i, want] of SELF_TEST_WANT.entries()) {
    if (got[i] !== want) return `row ${i}: expected\n  ${want}\ngot\n  ${got[i]}`;
  }
  return null;
}

// ---------- the run ----------
const { tones, rows } = tableOf(read(TABLE));
const sheets = walk(CORPUS, '.css', FLOOR.sheets).map((file) => ({ file, css: read(file) }));
const sources = [...walk(CORPUS, '.ts', 10), ...walk(CORPUS, '.tsx', 20)].map((file) => ({
  file,
  code: codeOf(read(file)),
}));
const sites = stateSites(sources);
const { assigns, reads } = tonePlumbing(sheets);

console.log(
  `state tones: ${rows.size} state name(s) mapped onto ${tones.length} tone(s) by ${TABLE}, ` +
    `${sites.length} data-state site(s) across ${sources.length} file(s), ${sheets.length} stylesheet(s)`,
);

// Before any finding, because a green run on a reader that matched nothing is the worse failure.
if (rows.size < FLOOR.rows || sites.length < FLOOR.sites) {
  console.error(`\nonly ${rows.size} row(s) and ${sites.length} data-state site(s) found.`);
  console.error(`This check is vacuous: a reader has stopped matching. Fix the pattern in`);
  console.error(`tools/check-state-tones.mjs — do NOT lower the floor.`);
  process.exit(1);
}
const parserFault = selfTest();
if (parserFault) {
  console.error(`\nthe state reader is broken: ${parserFault}.`);
  console.error(`All five claims are vacuous — they would report nothing whatever the tree holds. Fix`);
  console.error(`the pattern in tools/check-state-tones.mjs; do NOT relax the fixture.`);
  process.exit(1);
}

let failed = false;
const fail = (head, lines, why) => {
  console.error(`\n${head}\n`);
  for (const line of lines) console.error(`  ${line}`);
  console.error(`\n${why}`);
  failed = true;
};

// ---- claim 1
const strays = [...rows].filter(([, tone]) => !tones.includes(tone));
if (strays.length > 0) {
  fail(
    `${strays.length} state(s) mapped to something that is not one of the ${tones.length} tones:`,
    strays.map(([state, tone]) => `${state} → ${tone}`),
    `The tone set is closed. Widening it means widening \`Tone\` and adding a \`.vb-tone-*\` rule to\n` +
      `web/src/molecules/tones.css, which is a decision rather than a typo.`,
  );
}
const unusedTones = tones.filter((tone) => ![...rows.values()].includes(tone));
if (unusedTones.length > 0) {
  fail(
    `${unusedTones.length} tone(s) that no state reaches: ${unusedTones.join(', ')}`,
    unusedTones.map((tone) => `.vb-tone-${tone} is offered and nothing asks for it`),
    `A tone in the vocabulary that no surface can produce is a promise nobody kept — which is exactly\n` +
      `what \`--ok\` was before Phase 13: one of Chip's five tone names, referenced by no chip.\n` +
      `Give it a state or delete it.`,
  );
}

// ---- claim 2
const named = sources.map((s) => s.code).join('\n');
const dead = [...rows.keys()].filter((state) => !named.includes(`'${state}'`));
if (dead.length > 0) {
  fail(
    `${dead.length} row(s) named nowhere in ${CORPUS}: ${dead.join(', ')}`,
    dead.map((state) => `${state} → ${rows.get(state)}`),
    `A row no code can produce is a dead row, and nothing else in the tree asks this direction.\n` +
      `Delete it, or name the state where it is decided.`,
  );
}

// ---- claim 3
const unknown = sites.filter((s) => s.literal !== undefined && !rows.has(s.literal));
if (unknown.length > 0) {
  fail(
    `${unknown.length} data-state literal(s) with no row in the table:`,
    unknown.map((s) => `${s.file}:${s.line} — data-state="${s.literal}"`),
    `A state the table does not know leaves \`--tone\` unset, so the declaration is invalid at\n` +
      `computed-value time and the colour falls through to whatever was inherited — which looks\n` +
      `deliberate. Add the row, or use one that exists.`,
  );
}
const unchecked = sites.filter((s) => s.expression !== undefined && s.checked === null);
if (unchecked.length > 0) {
  fail(
    `${unchecked.length} data-state expression(s) the compiler cannot check:`,
    unchecked.map((s) => `${s.file}:${s.line} — data-state={${s.expression}}`),
    `React types every \`data-*\` as \`any\`. Put a \`stateClass(…)\` in the same tag if the surface takes\n` +
      `a colour from the state, or wrap it in \`asState(…)\` if it does not. See web/src/molecules/state-tones.ts.`,
  );
}

// ---- claim 4
const naming = stateNamingRules(sheets);
if (naming.length > 0) {
  fail(
    `${naming.length} stylesheet rule(s) name a state:`,
    naming.map((f) => `${f.at} — ${f.selector}  (${f.why.join(', ')})`),
    `A STATE'S COLOUR IS DECIDED IN ONE PLACE, and it is web/src/molecules/state-tones.ts. A rule that names a\n` +
      `state is a second opinion about it, and twenty-six of them made \`running\` three different\n` +
      `colours on three surfaces a person reads together. Say WHICH PROPERTY the tone lands on —\n` +
      `\`color: var(--tone)\`, \`border-left-color: var(--tone)\` — and let the table say which colour.`,
  );
}

// ---- claim 5
const expected = tones.map((tone) => `.vb-tone-${tone}`);
const assigned = assigns.map((a) => a.selector);
const extra = assigns.filter((a) => !expected.includes(a.selector));
const missing = expected.filter((sel) => !assigned.includes(sel));
if (extra.length > 0 || missing.length > 0) {
  fail(
    `\`--tone\` is assigned by ${assigns.length} rule(s) and the table is ${expected.length}:`,
    [
      ...extra.map((a) => `EXTRA ${a.at} — ${a.selector}`),
      ...missing.map((sel) => `MISSING ${sel} — declared in \`Tone\` and assigned by no rule`),
    ],
    `One table means one assignment per tone and nothing else. A sixth assignment somewhere down the\n` +
      `cascade is the same defect as a sixth vocabulary, one level lower and harder to see.`,
  );
}

if (failed) process.exit(1);

// PRINTED IN FULL ON A PASSING RUN. A table nobody sees is a table nobody keeps, and the roles are the
// only remaining place a surface has an opinion — so they are listed with the property each one spends
// the tone on, which is what makes "one tone, two properties" auditable rather than assumed.
console.log(`\nthe table — ${rows.size} states, ${tones.length} tones:`);
for (const tone of tones) {
  const mine = [...rows].filter(([, t]) => t === tone).map(([s]) => s);
  const rule = assigns.find((a) => a.selector === `.vb-tone-${tone}`);
  const token = /--tone\s*:\s*([^;]+)/.exec(rule?.body ?? '')?.[1]?.trim() ?? '?';
  console.log(`  ${tone.padEnd(8)} ${token.padEnd(16)} ${mine.join(' ')}`);
}
console.log(`\nthe roles — ${reads.length} declaration(s) spending \`--tone\`:`);
for (const r of reads) console.log(`  ${r.property.padEnd(18)} ${r.selector}  (${r.at})`);
console.log(`\nthe sites — ${sites.length} data-state attribute(s):`);
for (const s of sites) {
  const what = s.literal !== undefined ? `"${s.literal}"` : `{${s.expression}} — ${s.checked}`;
  console.log(`  ${s.file}:${s.line} ${what}`);
}
console.log(
  `\nno stylesheet names a state; \`--tone\` is assigned by exactly ${expected.length} rule(s); ` +
    `every one of ${sites.length} site(s) resolves to a row.`,
);
