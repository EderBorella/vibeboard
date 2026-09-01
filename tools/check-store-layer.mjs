#!/usr/bin/env node
//
// `src/store/` MUST NOT REACH INTO `src/server/`. Blocking, at zero, with one named exception.
//
// The store extraction created three upward edges and nothing was watching for a fourth. Two of them
// were closed by moving the code DOWN rather than by allowing the edge: `fs-sandbox.ts` and
// `redaction.ts` now live in `src/store/`, because confining a path to the project root and keeping a
// run's credential out of a record are properties of writing to disk, not of serving HTTP.
//
// THE GRAPH, NOT A GREP, and the distinction is the whole point. `src/core/`'s purity has already been
// wrong in this repository in exactly this way: a module that looks pure reaches `node:fs` in three
// hops, and grepping the directory proves nothing about that. So this resolves each store module's
// imports transitively and reports the PATH by which the server is reached, not just the fact.
//
// TYPE-ONLY IMPORTS ARE STILL EDGES HERE, deliberately, and this is the one place it differs from what
// the compiler cares about. `import type` erases, so it costs nothing at run time — but the reason for
// the boundary is not run-time cost, it is that a lower layer must be understandable without the higher
// one. A store module whose types are defined by a route module cannot be read, tested or moved on its
// own. `chat-store.ts`'s two type imports are real findings by that reading, and they are listed.
//
// Run it with: npm run check:store-layer
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = join(ROOT, 'src', 'store');
const SERVER = join(ROOT, 'src', 'server');

// THE ONE HONEST EDGE, named and reasoned rather than silently allowed.
//
// `reaper.ts` signals process groups, which is `src/exec/`'s subject if it is anything, and `run-store`
// calling it is genuinely "the record layer asking whether these children are still alive". Moving it
// would relocate the question rather than answer it. It is an exception because somebody decided it was,
// and the day that stops being true this line is what gets deleted.
const ALLOWED = new Set(['src/server/runs/reaper.ts']);

const IMPORT = /(?:^|\n)\s*(?:import|export)\b[^;\n]*?from\s*['"]([^'"]+)['"]/g;

function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

// ESM here always carries `.js`, including for `.ts` sources — so resolving means swapping it back.
function resolveSpecifier(from, spec) {
  if (!spec.startsWith('.')) return undefined; // bare = a package, not our tree
  const abs = resolve(dirname(from), spec);
  for (const candidate of [abs.replace(/\.js$/, '.ts'), abs, `${abs}.ts`, join(abs, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* next candidate */
    }
  }
  return undefined;
}

function importsOf(file) {
  const text = readFileSync(file, 'utf8');
  const out = [];
  for (const m of text.matchAll(IMPORT)) {
    const target = resolveSpecifier(file, m[1]);
    if (target) out.push(target);
  }
  return out;
}

// Breadth-first so the reported path is the SHORTEST way in, which is the one worth reading.
function pathToServer(entry) {
  const seen = new Set([entry]);
  const queue = [[entry]];
  while (queue.length > 0) {
    const trail = queue.shift();
    for (const next of importsOf(trail.at(-1))) {
      if (seen.has(next)) continue;
      seen.add(next);
      const rel = relative(ROOT, next).split('\\').join('/');
      if (next.startsWith(`${SERVER}/`)) {
        if (ALLOWED.has(rel)) continue; // named exception — and nothing beyond it is explored
        return [...trail, next];
      }
      queue.push([...trail, next]);
    }
  }
  return undefined;
}

const files = sources(STORE);
const findings = [];
for (const file of files) {
  const trail = pathToServer(file);
  if (trail) findings.push(trail.map((p) => relative(ROOT, p).split('\\').join('/')));
}

console.log(
  `store layer: ${files.length} module(s) resolved, ${findings.length} reaching src/server/, ` +
    `${ALLOWED.size} named exception(s)`,
);

if (findings.length > 0) {
  console.error(`\n${findings.length} upward edge(s) out of src/store/:\n`);
  for (const trail of findings) console.error(`  ${trail.join('\n    -> ')}\n`);
  console.error(
    'A lower layer reaching a higher one is the boundary failing, not a shortcut. Move what the store\n' +
      'needs DOWN into store/ or core/ — that is how fs-sandbox.ts and redaction.ts were resolved. Adding\n' +
      'a name to ALLOWED is for an edge somebody has decided is honest, with the reason written beside it.',
  );
  process.exit(1);
}
