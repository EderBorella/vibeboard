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
// REPORTING ONLY, AND EXIT 0, FOR ONE STATED REASON: it is pointed at a backlog. The split moved rules
// without re-homing them — a move that gathered a scattered rule would move it in the cascade too, and
// the phase that split the file is not the phase that may change what renders. A blocking gate over a
// backlog of hundreds has to be bypassed on every commit, which teaches everybody to ignore it. It goes
// BLOCKING in the commit that reaches zero, which is the phase that moves the components; that commit
// deletes this paragraph and turns the report into an exit code.
//
// THE SCOPE IS A SURFACE NAME AND NOT A PATH, and that is deliberate rather than sloppy: the stylesheets
// moved into `organisms/<name>/` and `pages/<name>/` in this phase while the components that wear the
// classes are still at `web/src/<name>/`. Comparing full paths would report every scoped class in the
// tree as a violation — a number with no information in it — so `organisms/board/board.css` and
// `web/src/board/CardTile.tsx` are read as the same surface, `board`. When the components move, the
// comparison keeps meaning exactly what it means now.
//
// A REFERENCE IS COUNTED GENEROUSLY, in the direction that UNDER-reports. A class name appearing as a
// token in a `.ts`/`.tsx` is a reference from that file's surface, and a template literal `` `prefix-${ ``
// counts as a reference to every class starting with `prefix-`. That is looser than
// `check-class-budget.mjs`, which resolves both halves of a composed name because it deletes code on the
// answer; this one only accuses, so an over-generous reference makes it quieter rather than wronger.

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

// `web/src/organisms/board/board.css` → `board`; `web/src/ui/primitives.css` → null, which reads as
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

// Whether `code` names `cls`, either literally or as the left-hand half of a composed name.
export function names(code, cls) {
  if (new RegExp(`(?<![\\w-])${cls.replace(/-/g, '\\-')}(?![\\w-])`).test(code)) return true;
  return [...code.matchAll(/([\w-]*[a-z\d])-\$\{/g)].some(([, prefix]) => cls.startsWith(`${prefix}-`));
}

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
  const defs = definitionsOf('fixture.css', '.alpha { color: red }\n@media (min-width: 1px) { .beta {} }');
  if (defs.map((d) => d.cls).join(',') !== 'alpha,beta') return `definitionsOf: [${defs.map((d) => d.cls)}]`;
  if (!names(codeOf('const a = <div className="alpha" />;'), 'alpha')) return 'names: a literal';
  if (names(codeOf('// .alpha is named only here\n'), 'alpha')) return 'names: a comment counted';
  if (!names(codeOf('const c = `msg-${kind}`;'), 'msg-error')) return 'names: a composed prefix';
  return null;
}

const fault = selfTest();
if (fault) {
  console.error(`\nthe layer reader is broken: ${fault}.`);
  console.error(`The report would be about nothing. Fix tools/check-layers.mjs; do NOT relax the fixture.`);
  process.exit(1);
}

const sheets = walk('.css').map((file) => ({ file, scope: scopeOf(file), css: read(file) }));
const sources = [...walk('.ts'), ...walk('.tsx')].map((file) => ({
  file,
  surface: surfaceOf(file),
  code: codeOf(read(file)),
}));

// Where each class is defined, and which scope owns it. A class defined in two scoped directories has no
// owner, which is its own finding.
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

// A finding is a class whose owning scope is `x` and which is named from a file whose surface is not `x`.
const findings = [];
for (const [cls, owner] of scoped) {
  if (owner.scopes.size > 1) continue;
  const scope = [...owner.scopes][0];
  const outside = sources.filter(({ surface, code }) => surface !== scope && names(code, cls));
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
  console.log(`  .${cls} is defined in ${[...owner.scopes].join(' and ')}: ${owner.sites.join(', ')}`);
}

// REPORTING, so the exit code is 0 whatever the count — see the header for when that changes and why it
// has not changed yet.
console.log(`reporting only: ${findings.length} finding(s), ${split.length} class(es) split across scopes`);
