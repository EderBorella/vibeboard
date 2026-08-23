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
import { codeOf, lineOf, walk as walkFiles } from './lib/source.mjs';

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
// against this census before making it, which is the only reason it was not found as 187 findings
// across the 191 classes this claim checks.
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

// Every class a sheet defines, with the line it is defined on and whether that rule DECLARES anything.
// `declares` is load-bearing rather than informational — see `ownedByOpen`: an empty rule used to confer
// ownership, and therefore exemption from both claims.
export function definitionsOf(file, css) {
  const out = [];
  for (const rule of shapedRules(rulesOf(file, css))) {
    // Comments are already blanked by `rulesOf`, so a rule holding nothing but one is empty here too.
    const declares = rule.body.trim().length > 0;
    for (const cls of classesOf(rule.selector)) out.push({ cls, line: rule.line, declares });
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

// WHETHER THE OPEN LAYER REALLY OWNS A SPLIT CLASS, which is what makes a split the ordinary shape of this
// tree rather than a fault: `.vb-ctl` is the Control atom's and eight surfaces say where their own copy
// sits, `.gate` and `.gate-card` are a template's specialised by the page inside the frame.
//
// "REALLY" MEANS THE OPEN RULE DECLARES SOMETHING, and that word is a repair. Ownership followed from the
// open layer merely being IN the set, and that was an escape hatch with nothing behind it: an EMPTY rule —
// `.board-columns { }` in atoms/text.css — exempted the class from BOTH claims. It changes no rendering and
// adds no class NAME, so `check:class-budget`'s ratchet did not move either. A real cross-surface read plus
// that one plant exited 0. A finding in this gate could be erased by a change with no effect whatsoever,
// which is the thing the paragraph at the foot of this file forbids in words.
const ownedByOpen = (owner) => owner.scopes.has(null) && owner.openDeclares;
const orphaned = (owner) => owner.scopes.size > 1 && !ownedByOpen(owner);

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
  // AND WHETHER EACH ONE DECLARES ANYTHING, which is what `ownedByOpen` turns on. The fixture already held
  // one rule of each kind and reported neither, so a `declares` frozen at `true` would have passed here.
  if (defs.map((d) => (d.declares ? '1' : '0')).join('') !== '10') {
    return `definitionsOf: declares [${defs.map((d) => d.declares)}]`;
  }
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
//
// BOTH DIRECTIONS OF THE HATCH ARE PINNED HERE, because it is the pair that decides whether this gate can
// be zeroed by a no-op: an EMPTY open rule must confer nothing (that plant exited 0 for a whole phase), and
// a real one must still confer ownership, or every ordinary split in this tree turns into a finding and the
// gate points at a backlog again.
function orphanSelfTest() {
  const owner = (scopes, openDeclares) => ({ scopes: new Set(scopes), openDeclares });
  if (orphaned(owner([null, 'board'], true))) return 'orphaned: an open layer plus a surface';
  if (!orphaned(owner(['board', 'cards'], false))) return 'orphaned: two surfaces';
  if (orphaned(owner(['board'], false))) return 'orphaned: one surface is not a split at all';
  if (!orphaned(owner([null, 'board'], false))) return 'orphaned: an EMPTY open rule owns nothing';
  if (!ownedByOpen(owner([null, 'board'], true))) return 'ownedByOpen: a real open rule does own it';
  if (ownedByOpen(owner(['board', 'cards'], false))) return 'ownedByOpen: no open layer at all';
  return null;
}

// `names()` over an already-parsed file, so the census does not re-read every source once per class.
const namedBy = ({ words, prefixes }, cls) =>
  words.has(cls) || prefixes.some((prefix) => cls.startsWith(`${prefix}-`));

// Where each class is defined, which scopes declare it, and whether an OPEN rule really declares it.
function ownersOf(sheets) {
  const owners = new Map();
  for (const { file, scope, css } of sheets) {
    for (const { cls, line, declares } of definitionsOf(file, css)) {
      if (!owners.has(cls)) owners.set(cls, { sites: [], scopes: new Set(), openDeclares: false });
      const owner = owners.get(cls);
      owner.sites.push(`${file}:${line}`);
      owner.scopes.add(scope);
      if (scope === null && declares) owner.openDeclares = true;
    }
  }
  return owners;
}

// A finding is a class owned by a surface and named from a file that is not that surface.
//
// A CLASS THE OPEN LAYER OWNS IS EXEMPT AND EVERY OTHER SPLIT IS NOT, which is narrower than it was. The
// test used to be `scopes.size > 1`, so ANY second declaration anywhere took the class off this claim. A
// split with no declaring open rule is now checked against the UNION of the scopes that declare it, which
// for the 191 single-scope classes is the same comparison as before, term for term.
function crossSurfaceReads(scoped, sources) {
  const findings = [];
  for (const [cls, owner] of scoped) {
    if (ownedByOpen(owner)) continue;
    const outside = sources.filter((source) => !owner.scopes.has(source.surface) && namedBy(source, cls));
    if (outside.length === 0) continue;
    const scope = [...owner.scopes]
      .filter((s) => s !== null)
      .sort()
      .join(' and ');
    findings.push({ cls, scope, site: owner.sites[0], readers: outside.map(({ file }) => file) });
  }
  return findings;
}

// THE SIZE OF THE BLIND SPOT, RATCHETED. A class the open layer owns is exempt from the cross-surface
// claim, which is right — `.vb-ctl` is the Control atom's — but it also means ADDING an open-layer
// declaration erases a finding, and the report printed `22 class(es) shared then specialised` beside
// `0 cross-surface read(s)` as if it were a decoration rather than the size of what is not checked. With
// the count ratcheted, laundering a finding through the open layer is a commit somebody has to write.
const SPLIT_CEILING = 22;

// THE SAME POPULATION `check:class-budget` COUNTS, so the floor is set against that number and not an
// order of magnitude below it. 40 was: a planted `classesOf` narrowed to `/\.([a-z]+)/g` lost 244 of the
// 307 classes in this tree — an 80%-blind parser — and walked straight past a floor of 40 while
// `check:class-budget` and `check:name-resolution` both failed. **305 today**, and 250 is the floor: the
// commit that takes the budget below 250 lowers this in the same commit, which is the ratchet discipline
// every other number in this repository already follows.
// ---------------------------------------------------------------------------------------------------
// CLAIM 3 — THE ARROWS POINT ONE WAY. Blocking at zero.
//
// The other two claims are about STYLESHEETS: which surface may read which class. This one is about
// MODULES, and nothing in this repository could see it — which is how `atoms/Chip.tsx` came to import
// `molecules/state-tones`, putting the base of the pyramid in debt to the layer above it. Eight phases
// of work on tokens, atoms, molecules and organisms, and the one thing that decides whether any of it is
// a HIERARCHY rather than six directories went unchecked the whole time.
//
// A module may import its own layer or any layer BELOW it, never above:
//     design -> atoms -> molecules -> organisms -> templates -> pages -> shell
// `lib/` and the loose modules at the root of `web/src` have no layer: they are data and plumbing, and
// anyone may import them. That is not a loophole — a layer is about what draws, and `lib/api` draws
// nothing.
//
// WHY `shell` IS ABOVE `pages` AND NOT A TEMPLATE. `App.tsx` and `WorkArea.tsx` choose WHICH page renders.
// That is a router, and a router is above the things it routes to. They sat in `templates/` and produced
// seven upward imports on their own — which read as seven violations when the real fault was one
// misfiling. The frames they draw are still templates; `templates/app-shell.css` and `work-area.css` did
// not move.
const LAYERS = ['design', 'atoms', 'molecules', 'organisms', 'templates', 'pages', 'shell'];
const NO_LAYER = -1;
const layerOf = (rel) => {
  const seg = rel.split('/')[0];
  const at = LAYERS.indexOf(seg);
  return at === -1 ? NO_LAYER : at;
};

// Resolve a relative specifier against the importing file's own directory, the way the bundler does.
export const resolveSpec = (fromRel, spec) => {
  const out = fromRel.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/').replace(/\.(ts|tsx|js|jsx)$/, '');
};

const importFaults = (files, read) => {
  const faults = [];
  for (const rel of files) {
    const mine = layerOf(rel);
    if (mine === NO_LAYER) continue;
    const code = codeOf(read(rel));
    for (const m of code.matchAll(/from '(\.[^']*)'/g)) {
      const target = resolveSpec(rel, m[1]);
      const theirs = layerOf(target);
      if (theirs === NO_LAYER || theirs <= mine) continue;
      faults.push({
        line: lineOf(code, m.index ?? 0),
        rel,
        target,
        from: LAYERS[mine],
        to: LAYERS[theirs],
      });
    }
  }
  return faults;
};

// SELF-TEST, and it has to carry BOTH directions plus the no-layer case, because a resolver that returned
// a constant would satisfy a one-sided fixture. The three rows are: an atom reaching up (a fault), a page
// reaching down (never a fault), and an organism reaching into `lib/` (never a fault, and the row that
// stops the arm being tightened into nonsense later).
const IMPORT_FIXTURE = new Map([
  ['atoms/Alpha.tsx', "import { x } from '../molecules/beta';\n"],
  ['pages/gate/Gamma.tsx', "import { y } from '../../atoms/Alpha';\n"],
  ['organisms/runs/Delta.tsx', "import { z } from '../../lib/api';\n"],
]);

const importSelfTest = () => {
  const got = importFaults([...IMPORT_FIXTURE.keys()], (rel) => IMPORT_FIXTURE.get(rel) ?? '');
  const want = 'atoms/Alpha.tsx atoms->molecules';
  const seen = got.map((f) => `${f.rel} ${f.from}->${f.to}`).join(' | ');
  if (got.length !== 1 || seen !== want) {
    console.error(
      `tools/check-layers.mjs — the import reader is broken: expected exactly \`${want}\`, got \`${seen || '(nothing)'}\`.`,
    );
    return false;
  }
  return true;
};

// A SMOKE ALARM AND NOT A TARGET, and this number was 250 while the tree held 305 — so the first phase to
// delete its way to 249 failed the run FOR SUCCEEDING. That is the third anti-vacuity floor in this
// repository to do exactly that, and the rule the corpus walk already states is the fix: set it far below
// the real count, because a floor near the true number is a second ratchet nobody meant to add. The
// ratchet on the count lives in check-class-budget.mjs and is the only place it should.
const PARSE_FLOOR = 100;

// TWO CLAIMS, BOTH AT ZERO, BOTH BLOCKING. A cross-surface READ, and a split no open-layer rule owns.
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

function printReport({ owners, sheets, scoped, findings, split, exempt }) {
  const perScope = new Map();
  for (const { scope } of findings) perScope.set(scope, (perScope.get(scope) ?? 0) + 1);
  console.log(
    `layers: ${owners.size} class(es) across ${sheets.length} sheet(s) — ${scoped.length} owned by a ` +
      `surface, ${owners.size - scoped.length} in the shared layers`,
  );
  const breakdown = [...perScope]
    .sort((a, b) => b[1] - a[1])
    .map(([scope, n]) => `${scope} ${n}`)
    .join(', ');
  console.log(
    `layer scope: ${findings.length} scoped class(es) read from outside their own surface` +
      (breakdown ? ` — ${breakdown}` : ''),
  );
  for (const { cls, scope, site, readers } of findings) {
    console.log(`  .${cls} (${scope}, ${site}) read from ${[...new Set(readers)].join(', ')}`);
  }
  for (const [cls, owner] of split) {
    // `null` is the open layer, and it printed as an empty string — `defined in autopilot and settings and`.
    const where = [...owner.scopes].map((scope) => scope ?? 'the shared layer').join(' and ');
    const mark = orphaned(owner) ? ' — UNOWNED' : '';
    console.log(`  .${cls} is defined in ${where}${mark}: ${owner.sites.join(', ')}`);
  }
  // NAMED, not counted. These are the classes the cross-surface claim does not examine, so a reader asking
  // what the zero does not cover gets the list rather than a number beside it.
  console.log(
    `layer scope: ${exempt.length} class(es) exempt from the cross-surface claim because an open-layer ` +
      `rule declares them, against a ceiling of ${SPLIT_CEILING}: ` +
      exempt.map(([cls]) => `.${cls}`).join(' '),
  );
}

function main() {
  const fault = scopeSelfTest() ?? readerSelfTest() ?? orphanSelfTest();
  if (fault) {
    console.error(`\nthe layer reader is broken: ${fault}.`);
    console.error(`The report would be about nothing. Fix tools/check-layers.mjs; do NOT relax the fixture.`);
    process.exit(1);
  }

  const sheets = walk('.css').map((file) => ({ file, scope: scopeOf(file), css: read(file) }));
  // PARSED ONCE PER FILE AND NOT ONCE PER CLASS. `names()` reads the whole file to answer one question, and
  // the census asks it 305 times — 43,000 full-file scans, which is the difference between a gate people
  // run and one they do not.
  const sources = [...walk('.ts'), ...walk('.tsx')].map((file) => {
    const code = codeOf(read(file));
    return { file, surface: surfaceOf(file), ...namedClasses(code) };
  });

  const owners = ownersOf(sheets);
  const scoped = [...owners].filter(([, o]) => [...o.scopes].some((s) => s !== null));
  const split = scoped.filter(([, o]) => o.scopes.size > 1);
  const orphans = scoped.filter(([, o]) => orphaned(o));
  const exempt = scoped.filter(([, o]) => ownedByOpen(o));
  const findings = crossSurfaceReads(scoped, sources);

  if (owners.size < PARSE_FLOOR) {
    console.error(`\nonly ${owners.size} class(es) found across ${sheets.length} sheet(s), against a floor`);
    console.error(`of ${PARSE_FLOOR}. The selector reader has stopped matching, so this report is vacuous.`);
    process.exit(1);
  }

  printReport({ owners, sheets, scoped, findings, split, exempt });

  let failed = false;
  if (orphans.length > 0) {
    console.error(
      `\n${orphans.length} class(es) declared in more than one scope with no open-layer rule that declares` +
        ` anything, so nothing owns them. Move to organisms/shared/, atoms/ or molecules/, or give the` +
        ` copies two names. An EMPTY rule in an open sheet is not an owner.`,
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
  if (exempt.length > SPLIT_CEILING) {
    console.error(
      `\n${exempt.length} class(es) exempt from the cross-surface claim, against ${SPLIT_CEILING}. Adding an` +
        ` open-layer declaration takes a class off that claim, so this number is the size of what the zero` +
        ` does not cover. Lower it or argue the new one here; do NOT raise it to erase a finding.`,
    );
    failed = true;
  }

  // CLAIM 3 — the arrows. Walked over every `.tsx`/`.ts` under the corpus, stories excluded by the shared
  // walk for the reason `tools/lib/source.mjs` gives: a story is a demonstration, not a call site.
  const modules = [...walkFiles(ROOT, CORPUS, '.tsx', 40), ...walkFiles(ROOT, CORPUS, '.ts', 20)].map((f) =>
    f.slice(`${CORPUS}/`.length),
  );
  const arrows = importFaults(modules, (rel) => readFileSync(join(ROOT, CORPUS, rel), 'utf8'));
  if (!importSelfTest()) failed = true;
  if (arrows.length > 0) {
    console.error(
      `\n${arrows.length} import(s) point UP the layers, against zero. A module may import its own layer` +
        ` or any below it — ${LAYERS.join(' -> ')} — and never above. \`lib/\` and the loose modules have no` +
        ` layer and may be imported by anyone. Move the shared thing DOWN, or move the importer up.`,
    );
    for (const a of arrows) {
      console.error(`  ${CORPUS}/${a.rel}:${a.line}  ${a.from} -> ${a.to}  (${a.target})`);
    }
    failed = true;
  }

  console.log(
    `layer scope: ${findings.length} cross-surface read(s) and ${orphans.length} unowned split(s) — both ` +
      `blocking at zero; ${exempt.length}/${SPLIT_CEILING} shared then specialised`,
  );
  console.log(
    `layer direction: ${arrows.length} upward import(s) across ${modules.length} module(s) — blocking at` +
      ` zero; ${LAYERS.join(' -> ')}`,
  );
  if (failed) process.exit(1);
}

// THE CENSUS RUNS ONLY WHEN THIS FILE IS THE COMMAND. It was top-level straight-line code, and with six
// exported functions that made the exports a trap rather than an interface: `await import()` of this module
// walked 41 stylesheets, printed 24 lines and — with a finding in the tree — called `process.exit(1)` from
// inside the import, so the importing process DIED and the statement after the `await` never ran. It has
// caught three agents, one of them reading this gate's own numbers by importing it, which means those
// numbers came out of a process that may have died mid-report. Same one line as check-scale.mjs.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
