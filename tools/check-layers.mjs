#!/usr/bin/env node
//
// WHICH DIRECTORY A CLASS LIVES IN, against who reads it — the claim the split exists to make possible.
// A stylesheet per layer is only worth having if the layer means something, and the thing it means is:
//
//   1. A class defined under `atoms/`, `molecules/`, `organisms/shared/`, `templates/` or `design/` may
//      be referenced from anywhere. That is what a shared layer IS.
//   2. A class defined under `organisms/<name>/` or `pages/<name>/` may be referenced only from
//      `<name>`. A surface's own class read by a second surface is either a shared shape wearing a
//      private name, or a coincidence waiting to be broken by whoever edits it.
//
// Run it with: npm run check:layers
//
// STILL REPORTING ONLY, AND THE ORGANISM PHASE IS WHERE IT WAS MEANT TO GO BLOCKING. It did not, and the
// number is why: **44 cross-surface reads remain**, against 0 orphans. That is not a refusal to finish the
// job, it is what the job turned out to be — and it is measured rather than estimated:
//
//   ORPHANS ARE AT ZERO AND THAT CLAIM COULD BLOCK TODAY. 23 split classes became 18, and all 18 are a
//   shared class a surface specialises (`.vb-ctl` and eight surfaces saying where their own copy sits),
//   which has an owner. The seven that were genuine — `.push`, `.link-title`, `.raw-pane`,
//   `.control-editor`, `.execution`, `.explorer-list`, `.suggestions-pane`, `.diary-about` — are gone.
//
//   THE 44 THAT REMAIN ARE ONE FAULT, NOT 44: the STYLESHEETS have moved into the §5.1 tree and the
//   COMPONENTS have not. `pages/execution/execution.css` holds eight classes and every one of them is read
//   from `web/src/runs/ExecutionView.tsx` — which §5.2 says IS `pages/Execution`. `organisms/topbar/`'s
//   seven are read from `web/src/app/TopBar.tsx`, which §5.2 says is a chrome organism. Between them those
//   two files account for 15 of the 44. Phase 7 moves the 67 `.tsx` and 61 `.ts` files, and this claim
//   goes blocking in that commit — not because the count is inconvenient here, but because the thing that
//   fixes it is a file move this phase's boundary does not contain.
//
// WHAT THIS PHASE DID FIX IS THE INSTRUMENT, and that was the larger of the two problems: 72 findings
// became 44 by narrowing the READER (see below), and 28 of the 72 were a class name that happens to be an
// ordinary English word. A gate whose report is 39% noise cannot be made blocking whatever the tree holds,
// because nobody can tell which line to act on.
//
// THE SCOPE IS A SURFACE NAME AND NOT A PATH, and that is deliberate rather than sloppy: the stylesheets
// moved into `organisms/<name>/` and `pages/<name>/` in this phase while the components that wear the
// classes are still at `web/src/<name>/`. Comparing full paths would report every scoped class in the
// tree as a violation — a number with no information in it — so `organisms/board/board.css` and
// `web/src/board/CardTile.tsx` are read as the same surface, `board`. When the components move, the
// comparison keeps meaning exactly what it means now.
//
// A REFERENCE IS A CLASS NAME IN A `className` POSITION, and the paragraph that stood here said the
// opposite. It claimed a reference was "counted GENEROUSLY, in the direction that UNDER-reports … an
// over-generous reference makes it quieter rather than wronger". BOTH HALVES OF THAT ARE FALSE, and the
// second is the one that mattered: a finding here IS a reference, so a looser reader produces MORE
// accusations, not fewer. Measured on this tree — **72** findings with a bare token match, **44** with the
// reader below, and all 28 of the difference were a class name that happens to be an ordinary English
// word. `.board` was "read from" `api/cards.ts` because that file declares `board: string`;
// `.control` from `api/control.ts`; `.report`, `.options`, `.resolved`, `.tag`, `.gate`, `.filed`, `.msg`,
// `.ctx`, `.diary`, `.dock`, `.copilot`, `.blockers` the same way. A gate whose report is 94% noise cannot
// be made blocking, and the noise was the instrument rather than the tree.
//
// SO THE READER IS NARROWED TO WHERE A CLASS NAME CAN ACTUALLY BE: the text of a `className=` attribute or
// a `classList` call — string literals and the static parts of template literals inside it, split on
// whitespace — plus a composed `` `prefix-${ `` inside the same expression. It is still looser than
// `check-class-budget.mjs`, which resolves BOTH halves of a composed name because it deletes code on the
// answer.
//
// WHAT IT NOW MISSES, and both are safe in the direction that matters: a class reached through
// `querySelector` (none in `web/src`), and a class name held in a variable that is passed to `className`
// — `stateClass()` is the one such helper and it returns `vb-tone-*`, which is an open-layer name. Missing
// a reference makes this gate quieter, which is the direction the old paragraph claimed for the wrong
// reason.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classesOf, rulesOf, shapedRules } from './lib/css.mjs';
import { codeOf, walk as walkFiles } from './lib/source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = 'web/src';

// The layers whose classes are public by construction. `design/` holds the reset and the user-preference
// overrides — no classes today, and if one arrives it is app-wide by definition; `templates/` holds the
// shell and the two layout frames, whose classes are worn by the pages they wrap.
const OPEN = ['atoms/', 'molecules/', 'organisms/shared/', 'templates/', 'design/'];
// The layers whose directory name IS the scope.
const SCOPED = ['organisms/', 'pages/'];

// A SMOKE ALARM, NOT A TARGET — see walk() in lib/source.mjs. Floored an order of magnitude below the
// real counts so that deleting a file never fails the run.
const FLOOR = { '.css': 2, '.ts': 10, '.tsx': 20 };
const walk = (ext) => walkFiles(ROOT, CORPUS, ext, FLOOR[ext] ?? 1);
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

// `web/src/organisms/board/board.css` → `board`; `web/src/atoms/text.css` → null, which reads as
// open: the primitives are the layer every surface spends.
export function scopeOf(file) {
  const path = file.slice(`${CORPUS}/`.length);
  if (OPEN.some((layer) => path.startsWith(layer))) return null;
  const scoped = SCOPED.find((layer) => path.startsWith(layer));
  if (!scoped) return null;
  return path.slice(scoped.length).split('/')[0] ?? null;
}

// The surface a reference is made FROM: `web/src/board/CardTile.tsx` → `board`, and a loose file at the
// root of the corpus → null, which matches no scope and so is always a finding rather than never one.
export function surfaceOf(file) {
  const parts = file.slice(`${CORPUS}/`.length).split('/');
  return parts.length > 1 ? parts[0] : null;
}

// Every class a sheet defines, with the line it is defined on.
export function definitionsOf(file, css) {
  const out = [];
  for (const rule of shapedRules(rulesOf(file, css))) {
    for (const cls of classesOf(rule.selector)) out.push({ cls, line: rule.line });
  }
  return out;
}

// THE TEXT OF EVERY `className` / `classList` EXPRESSION IN A FILE. Brace-matched rather than
// regex-terminated, because the expression is routinely a ternary or a template with nested braces and a
// flat regex stops at the first `}` — which is inside the interpolation, not at the end of the attribute.
export function classAttributes(code) {
  const out = [];
  for (const m of code.matchAll(/\bclassName\s*=\s*|\bclassList\.(?:add|remove|toggle|contains)\s*\(/g)) {
    let i = m.index + m[0].length;
    while (code[i] === ' ' || code[i] === '\n') i += 1;
    const open = code[i];
    if (open === '"' || open === "'") {
      const end = code.indexOf(open, i + 1);
      // THE QUOTES ARE KEPT and that is not cosmetic: the caller reads STRING LITERALS out of each region,
      // so a region that is already the bare contents of one holds no literal for it to find. Planted by
      // accident and caught by the fixture below, which is what a self-test is for.
      if (end !== -1) out.push(code.slice(i, end + 1));
      continue;
    }
    if (open !== '{' && open !== '(') continue;
    const close = open === '{' ? '}' : ')';
    let depth = 0;
    let j = i;
    for (; j < code.length; j += 1) {
      if (code[j] === open) depth += 1;
      else if (code[j] === close && (depth -= 1) === 0) break;
    }
    out.push(code.slice(i, j + 1));
  }
  return out;
}

// The class names a file NAMES: every whitespace-delimited word inside a quoted or templated string in a
// `className` expression, plus the left-hand half of any composed name in one.
export function namedClasses(code) {
  const words = new Set();
  const prefixes = [];
  for (const region of classAttributes(code)) {
    for (const m of region.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
      for (const word of (m[1] ?? m[2] ?? m[3] ?? '').split(/[\s${}]+/)) if (word) words.add(word);
    }
    for (const m of region.matchAll(/([\w-]*[a-z\d])-\$\{/g)) prefixes.push(m[1]);
  }
  return { words, prefixes };
}

// Whether `code` names `cls`, either literally or as the left-hand half of a composed name.
export function names(code, cls) {
  const { words, prefixes } = namedClasses(code);
  return words.has(cls) || prefixes.some((prefix) => cls.startsWith(`${prefix}-`));
}

// WHETHER A SPLIT CLASS IS AN ORPHAN. A class declared in two SCOPED directories has no owner and is a
// finding; a class declared in a scoped directory AND in an open layer has one — the open layer — and is
// the ordinary shape of this tree: `.vb-ctl` is the Control atom's and eight surfaces say where their own
// copy sits. All 18 split classes on this tree are the second kind, which is why the claim can block.
const orphaned = (scopes) => scopes.size > 1 && ![...scopes].includes(null);

// THE READER AND THE SCOPE RULE, ON A FIXTURE THE TREE CANNOT MOVE. Both directions are exercised: a
// scoped class read from its own surface is silent, the same class read from another surface is a
// finding, and an open-layer class read from anywhere is silent — a self-test that only proved the
// finding would pass with the scope rule inverted.
function selfTest() {
  if (scopeOf(`${CORPUS}/organisms/board/board.css`) !== 'board') return 'scopeOf: an organism';
  if (scopeOf(`${CORPUS}/pages/log/log.css`) !== 'log') return 'scopeOf: a page';
  if (scopeOf(`${CORPUS}/organisms/shared/modal.css`) !== null) return 'scopeOf: shared is not open';
  if (scopeOf(`${CORPUS}/molecules/popover.css`) !== null) return 'scopeOf: a molecule is not open';
  if (surfaceOf(`${CORPUS}/board/CardTile.tsx`) !== 'board') return 'surfaceOf: a component';
  if (surfaceOf(`${CORPUS}/markdown.tsx`) !== null) return 'surfaceOf: a loose file';
  // THE PRELUDE CARRIES A CLASS TOKEN ON PURPOSE. With `@media (min-width: 1px)` this fixture could not
  // distinguish `shapedRules()` from no filter at all — a prelude with no dot in it reads as zero
  // definitions either way — and dropping the call was planted and passed here.
  const defs = definitionsOf('fixture.css', '.alpha { color: red }\n@supports selector(.gamma) { .beta {} }');
  if (defs.map((d) => d.cls).join(',') !== 'alpha,beta') return `definitionsOf: [${defs.map((d) => d.cls)}]`;
  if (!names(codeOf('const a = <div className="alpha" />;'), 'alpha')) return 'names: a literal';
  if (names(codeOf('// .alpha is named only here\n'), 'alpha')) return 'names: a comment counted';
  // BOTH BOUNDARIES, because an accusation is the only thing this gate produces. `names()` reduced to
  // `code.includes(cls)` was planted and passed everything above it while moving the report from 82
  // findings to 84 — a scoped class read nowhere gets blamed on whatever longer name contains it.
  if (names(codeOf('const x = "alpha-beta";'), 'alpha')) return 'names: a longer name on the right';
  if (names(codeOf('const x = "an-alpha";'), 'alpha')) return 'names: a longer name on the left';
  // A template literal with the placeholder escaped, so the fixture holds the two characters the
  // composed-prefix arm looks for without a lint suppression standing where the reason should be.
  if (!names(codeOf(`const c = <b className={\`msg-\${kind}\`} />;`), 'msg-error')) {
    return 'names: a composed prefix';
  }
  // THE CLAIM THE NARROWED READER RESTS ON, and the one that took 68 of the 72 findings off the report:
  // an identifier that happens to spell a class name is not a reference. Without this the gate cannot be
  // made blocking at all — `.board` was accused because `api/cards.ts` declares `board: string`.
  if (names(codeOf('interface P { alpha: string }'), 'alpha')) return 'names: a bare identifier counted';
  if (names(codeOf("const t = useLocalPrefs('alpha');"), 'alpha')) return 'names: a string outside className';
  // AND THE OTHER DIRECTION, because a reader that finds nothing reports nothing and exits 0. A ternary
  // and a joined array are the two spellings this tree actually writes, and a flat regex reading up to the
  // first `}` stops inside the interpolation of the first.
  const ternary = 'const a = <div className={on ? `alpha ${x}` : "beta"} />;';
  if (!names(codeOf(ternary), 'alpha') || !names(codeOf(ternary), 'beta')) return 'names: a ternary';
  const joined = "const b = <div className={['alpha', flag && 'beta'].join(' ')} />;";
  if (!names(codeOf(joined), 'beta')) return 'names: a joined array';
  // A class defined in a SCOPED directory and in the OPEN layer has an owner — the open layer — and is not
  // an orphan. Two scoped directories and no open one is.
  if (orphaned(new Set([null, 'board']))) return 'orphaned: an open layer plus a surface';
  if (!orphaned(new Set(['board', 'cards']))) return 'orphaned: two surfaces';
  if (orphaned(new Set(['board']))) return 'orphaned: one surface is not a split at all';
  return null;
}

const fault = selfTest();
if (fault) {
  console.error(`\nthe layer reader is broken: ${fault}.`);
  console.error(`The report would be about nothing. Fix tools/check-layers.mjs; do NOT relax the fixture.`);
  process.exit(1);
}

const sheets = walk('.css').map((file) => ({ file, scope: scopeOf(file), css: read(file) }));
// PARSED ONCE PER FILE AND NOT ONCE PER CLASS. `names()` reads the whole file to answer one question, and
// the loop below asks it 308 times — 43,000 full-file scans, which is the difference between a gate people
// run and one they do not.
const sources = [...walk('.ts'), ...walk('.tsx')].map((file) => {
  const code = codeOf(read(file));
  return { file, surface: surfaceOf(file), ...namedClasses(code) };
});
const namedBy = ({ words, prefixes }, cls) =>
  words.has(cls) || prefixes.some((prefix) => cls.startsWith(`${prefix}-`));

// Where each class is defined, and which scope owns it.
const owners = new Map();
for (const { file, scope, css } of sheets) {
  for (const { cls, line } of definitionsOf(file, css)) {
    if (!owners.has(cls)) owners.set(cls, { sites: [], scopes: new Set() });
    owners.get(cls).sites.push(`${file}:${line}`);
    owners.get(cls).scopes.add(scope);
  }
}

const scoped = [...owners].filter(([, o]) => [...o.scopes].some((s) => s !== null));
const split = scoped.filter(([, o]) => o.scopes.size > 1);
const orphans = scoped.filter(([, o]) => orphaned(o.scopes));

// A finding is a class whose owning scope is `x` and which is named from a file whose surface is not `x`.
const findings = [];
for (const [cls, owner] of scoped) {
  if (owner.scopes.size > 1) continue;
  const scope = [...owner.scopes][0];
  const outside = sources.filter((source) => source.surface !== scope && namedBy(source, cls));
  if (outside.length > 0) {
    findings.push({ cls, scope, site: owner.sites[0], readers: outside.map(({ file }) => file) });
  }
}

// A backlog counted per surface is a backlog somebody can take one bite out of; a single total is one
// nobody can start on.
const perScope = new Map();
for (const { scope } of findings) perScope.set(scope, (perScope.get(scope) ?? 0) + 1);

const PARSE_FLOOR = 40;
if (owners.size < PARSE_FLOOR) {
  console.error(`\nonly ${owners.size} class(es) found across ${sheets.length} sheet(s), against a floor`);
  console.error(`of ${PARSE_FLOOR}. The selector reader has stopped matching, so this report is vacuous.`);
  process.exit(1);
}

console.log(
  `layers: ${owners.size} class(es) across ${sheets.length} sheet(s) — ${scoped.length} owned by a ` +
    `surface, ${owners.size - scoped.length} in the shared layers`,
);
console.log(
  `layer scope: ${findings.length} scoped class(es) read from outside their own surface` +
    (perScope.size > 0
      ? ` — ${[...perScope]
          .sort((a, b) => b[1] - a[1])
          .map(([scope, n]) => `${scope} ${n}`)
          .join(', ')}`
      : ''),
);
for (const { cls, scope, site, readers } of findings) {
  console.log(`  .${cls} (${scope}, ${site}) read from ${[...new Set(readers)].join(', ')}`);
}
for (const [cls, owner] of split) {
  // `null` is the open layer, and it printed as an empty string — `defined in autopilot and settings and`.
  const where = [...owner.scopes].map((scope) => scope ?? 'the shared layer').join(' and ');
  console.log(`  .${cls} is defined in ${where}${orphaned(owner.scopes) ? ' — ORPHAN' : ''}: ${owner.sites.join(', ')}`);
}

// TWO CLAIMS, AND THEY ARE AT DIFFERENT PLACES. A cross-surface READ is a finding; a split across two
// SCOPED directories is an ORPHAN. A split that includes the open layer is neither — see `orphaned`.
//
// EXIT 0 WHILE THE READS ARE NON-ZERO, and the header says why: what closes them is Phase 7's file move,
// not a rule anybody can rewrite here. Do NOT widen the reader to make the number look better — 28 of the
// 72 findings this gate used to report were a class name that happens to be an ordinary word.
console.log(
  `reporting only: ${findings.length} cross-surface read(s), ${orphans.length} orphan(s), ` +
    `${split.length} class(es) shared then specialised`,
);
