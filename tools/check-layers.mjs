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
// FULLY BLOCKING, AT ZERO, AS OF THE COMMIT THAT MOVED THE TREE. Both claims. The organism phase could not
// get here — it recorded **44 cross-surface reads** and ratcheted them, because a blocking gate pointed at a
// backlog is a gate everybody learns to bypass — and it said exactly what would close them:
//
//   THE 44 WERE ONE FAULT, NOT 44: the STYLESHEETS were in the layer tree and the COMPONENTS were not.
//   Phase 7 moved 115 files, and **13 of the 44 closed on the move alone with no rule touched** — a class
//   read only by the surface that owns it, once that surface's components live in its directory. The eight
//   `.exec-*` read from `runs/ExecutionView.tsx`, which the tree says IS `pages/Execution`, and the top
//   bar's seven read from `app/TopBar.tsx`, which is a chrome organism, were 15 of them between them.
//
//   THE OTHER 31 WERE NOT A PATH PROBLEM AND NO FILE MOVE COULD HAVE CLOSED THEM: a shared shape wearing a
//   private name. Two surfaces really do each render a card's tag, a filed suggestion, a signed-in browser,
//   a panel section heading, a report chip. **Thirteen classes moved to `organisms/shared/shared.css`** —
//   this gate's own prescription, and the comment at the head of that section says plainly which of them
//   are candidates for an atom option instead, and that the move buys the structure and not the count.
//   `.control` and the three `.gate*` went to `templates/` (a frame two PAGES wear IS a template),
//   `.pop-wrap` to `molecules/popover.css` (the anchor belongs to the thing it anchors, and a MOLECULE was
//   reading a surface's class, which is the one direction this gate refuses outright), the nine
//   `.dispatch*` and `.blockers`/`.ready-ok` and `.report-dismiss` to the surface that actually names them,
//   and two — `.filed-text` and `.reports-forgive-error` — were deleted as `Text` options.
//
//   ORPHANS WERE ALREADY AT ZERO AND ALREADY BLOCKED. They did not block when the organism phase shipped
//   the claim, and "it could block today" is what the file said — so `.zz-orphan` declared in two scoped
//   directories printed `— ORPHAN` and exited 0. Every split in this tree includes the open layer, which is
//   an owner: `.vb-ctl` and eight surfaces saying where their own copy sits, `.vb-modal.ap-help`'s own
//   measure, `.gate` and `.gate-card` specialised by the page inside the frame.
//
// WHAT THIS PHASE DID FIX IS THE INSTRUMENT, and that was the larger of the two problems: 72 findings
// became 44 by narrowing the READER (see below), and 28 of the 72 were a class name that happens to be an
// ordinary English word. A gate whose report is 39% noise cannot be made blocking whatever the tree holds,
// because nobody can tell which line to act on.
//
// THE SCOPE IS A SURFACE NAME AND NOT A PATH, and now that the components have moved it is one rule applied
// on both sides — see `surfaceOf`, which was the other half of the fault. A name rather than a path is also
// what makes `pages/<name>/` and `organisms/<name>/` ONE surface, which the tree needs:
// `ProjectControl.tsx` is `pages/control/` and `ControlFileList.tsx` is `organisms/control/`, and they
// share one stylesheet because they are one feature seen from two layers.
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

// The surface a reference is made FROM, and it is `scopeOf`'s rule applied to a component rather than a
// second rule: `organisms/board/CardTile.tsx` → `board`, `lib/markdown.tsx` → `lib`, `main.tsx` → null.
//
// IT READ THE FIRST PATH SEGMENT UNTIL THIS PHASE, and that was the other half of the fault. Once
// `CardTile.tsx` lived at `organisms/board/` it reported the surface as `organisms`, so EVERY scoped class
// in the tree became a finding — the organism phase's comment claimed "when the components move, the
// comparison keeps meaning exactly what it means now", and it did not. Found by simulating the move
// against this census before making it, which is the only reason it was not found as 231 findings.
//
// AN OPEN-LAYER FILE IS `null` AND THAT IS THE POINT, not an omission: an atom, a molecule or a template
// that names a surface's class matches no scope, so it is ALWAYS a finding. `Popover.tsx` reaching for
// `.pop-wrap` out of the top bar's sheet was exactly that, and it is the one direction of this fault that
// is never a naming accident — a shared component cannot depend on a feature.
export function surfaceOf(file) {
  const path = file.slice(`${CORPUS}/`.length);
  if (OPEN.some((layer) => path.startsWith(layer))) return null;
  const scoped = SCOPED.find((layer) => path.startsWith(layer));
  if (scoped) return path.slice(scoped.length).split('/')[0] ?? null;
  const parts = path.split('/');
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
//
// THE QUOTES ARE KEPT and that is not cosmetic: the caller reads STRING LITERALS out of each region, so a
// region that is already the bare contents of one holds no literal for it to find. Planted by accident and
// caught by the fixture below, which is what a self-test is for.
function quotedRegion(code, i) {
  const quote = code[i];
  if (quote !== '"' && quote !== "'") return null;
  const end = code.indexOf(quote, i + 1);
  return end === -1 ? '' : code.slice(i, end + 1);
}

// An unterminated expression yields everything to the end of the file rather than nothing: a region that is
// too long makes the reader looser, and a reference this gate misses is a finding it does not make.
function bracedRegion(code, i) {
  const open = code[i];
  if (open !== '{' && open !== '(') return null;
  const close = open === '{' ? '}' : ')';
  let depth = 0;
  for (let j = i; j < code.length; j += 1) {
    if (code[j] === open) depth += 1;
    else if (code[j] === close) {
      depth -= 1;
      if (depth === 0) return code.slice(i, j + 1);
    }
  }
  return code.slice(i);
}

export function classAttributes(code) {
  const out = [];
  for (const m of code.matchAll(/\bclassName\s*=\s*|\bclassList\.(?:add|remove|toggle|contains)\s*\(/g)) {
    let i = m.index + m[0].length;
    while (code[i] === ' ' || code[i] === '\n') i += 1;
    const region = quotedRegion(code, i) ?? bracedRegion(code, i);
    if (region) out.push(region);
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
//
// THREE FUNCTIONS AND NOT ONE, for the reason `check-shape-coverage.mjs` composes five: one chain of
// twenty assertions scores 20 on the cognitive-complexity gate, and the answer to that is smaller
// functions rather than a suppression on the file that decides what this gate can see.
function scopeSelfTest() {
  if (scopeOf(`${CORPUS}/organisms/board/board.css`) !== 'board') return 'scopeOf: an organism';
  if (scopeOf(`${CORPUS}/pages/log/log.css`) !== 'log') return 'scopeOf: a page';
  if (scopeOf(`${CORPUS}/organisms/shared/modal.css`) !== null) return 'scopeOf: shared is not open';
  if (scopeOf(`${CORPUS}/molecules/popover.css`) !== null) return 'scopeOf: a molecule is not open';
  if (surfaceOf(`${CORPUS}/organisms/board/CardTile.tsx`) !== 'board') return 'surfaceOf: a component';
  // BOTH HALVES OF THE PAIR, because the whole gate turns on the two functions agreeing. `pages/control/`
  // and `organisms/control/` are ONE surface and a sheet in either is that surface's; an open-layer
  // component is no surface at all, which is what makes a molecule reading a feature's class a finding.
  if (surfaceOf(`${CORPUS}/pages/control/ProjectControl.tsx`) !== 'control') return 'surfaceOf: a page';
  if (surfaceOf(`${CORPUS}/molecules/Popover.tsx`) !== null) return 'surfaceOf: a molecule is no surface';
  if (surfaceOf(`${CORPUS}/lib/api/http.ts`) !== 'lib') return 'surfaceOf: lib is its own surface';
  if (surfaceOf(`${CORPUS}/main.tsx`) !== null) return 'surfaceOf: a loose file';
  // THE PRELUDE CARRIES A CLASS TOKEN ON PURPOSE. With `@media (min-width: 1px)` this fixture could not
  // distinguish `shapedRules()` from no filter at all — a prelude with no dot in it reads as zero
  // definitions either way — and dropping the call was planted and passed here.
  const defs = definitionsOf('fixture.css', '.alpha { color: red }\n@supports selector(.gamma) { .beta {} }');
  if (defs.map((d) => d.cls).join(',') !== 'alpha,beta') return `definitionsOf: [${defs.map((d) => d.cls)}]`;
  return null;
}

function readerSelfTest() {
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
  // first `}` stops inside the interpolation of the first. The ternary is a template literal with the
  // placeholder escaped, for line 195's reason: the two characters have to be in the fixture, and a lint
  // suppression must not stand where the reason should be.
  const ternary = `const a = <div className={on ? \`alpha \${x}\` : "beta"} />;`;
  if (!names(codeOf(ternary), 'alpha') || !names(codeOf(ternary), 'beta')) return 'names: a ternary';
  const joined = "const b = <div className={['alpha', flag && 'beta'].join(' ')} />;";
  if (!names(codeOf(joined), 'beta')) return 'names: a joined array';
  return null;
}

// A class defined in a SCOPED directory and in the OPEN layer has an owner — the open layer — and is not
// an orphan. Two scoped directories and no open one is.
function orphanSelfTest() {
  if (orphaned(new Set([null, 'board']))) return 'orphaned: an open layer plus a surface';
  if (!orphaned(new Set(['board', 'cards']))) return 'orphaned: two surfaces';
  if (orphaned(new Set(['board']))) return 'orphaned: one surface is not a split at all';
  return null;
}

const fault = scopeSelfTest() ?? readerSelfTest() ?? orphanSelfTest();
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

// THE SAME POPULATION `check:class-budget` COUNTS, so the floor is set against that number and not an
// order of magnitude below it. 40 was: a planted `classesOf` narrowed to `/\.([a-z]+)/g` lost 244 of the
// 307 classes in this tree — an 80%-blind parser — and walked straight past a floor of 40 while
// `check:class-budget` and `check:name-resolution` both failed. **305 today**, and 250 is the floor: the
// commit that takes the budget below 250 lowers this in the same commit, which is the ratchet discipline
// every other number in this repository already follows.
const PARSE_FLOOR = 250;
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
  console.log(
    `  .${cls} is defined in ${where}${orphaned(owner.scopes) ? ' — ORPHAN' : ''}: ${owner.sites.join(', ')}`,
  );
}

// TWO CLAIMS, BOTH AT ZERO, BOTH BLOCKING. A cross-surface READ and a split across two SCOPED directories
// with no open layer in it. A split that includes the open layer is neither — see `orphaned`.
//
// THE CEILING IS ZERO AND IT IS NOT A RATCHET ANY MORE. It was 44 for one phase, on the rule this
// repository follows and has broken: never point a blocking gate at a backlog, because a gate that must be
// bypassed teaches everybody to ignore it. The backlog is gone, so the ceiling goes with it in the same
// commit — which is the other half of that rule and the half that is usually forgotten.
//
// DO NOT RAISE IT, and do not widen the reader to make a number look better: 28 of the 72 findings this
// gate once reported were a class name that happens to be an ordinary English word, and narrowing the
// reader is what made a blocking gate possible at all. A new cross-surface read has three honest answers
// and they are in preference order: move the class to `atoms/` or `molecules/` as an option on a component
// that already exists; move it to `organisms/shared/`; or move the READER into the surface that owns the
// class. Adding a second copy under a second name is not one of them.
const CROSS_SURFACE_CEILING = 0;
let failed = false;

if (orphans.length > 0) {
  console.error(
    `\n${orphans.length} orphan(s): a class declared in two scoped directories and no open layer has no` +
      ` owner. Move it to organisms/shared/, atoms/ or molecules/, or give the two copies two names.`,
  );
  failed = true;
}
if (findings.length > CROSS_SURFACE_CEILING) {
  console.error(
    `\n${findings.length} cross-surface read(s), against zero. A surface's own class read by a second` +
      ` surface is a shared shape wearing a private name. Make it an option on an atom or a molecule, or` +
      ` move it to organisms/shared/, or move the reader into the surface that owns the class.`,
  );
  failed = true;
}

console.log(
  `layer scope: ${findings.length} cross-surface read(s) and ${orphans.length} orphan(s) — both ` +
    `blocking at zero; ${split.length} class(es) shared then specialised`,
);
if (failed) process.exit(1);
