#!/usr/bin/env node
//
// Every `decision NN` / `ruling NN` and every `S`/`C` slice reference in the source must have a row
// in docs/decisions.md. The rulings themselves were argued in documents that are gitignored, so a
// bare number in a comment is unresolvable to anyone who clones this repo — the register is the only
// thing that makes those citations mean something, and this gate is what keeps it complete.
//
// Run it with: npm run check:citations
//
// Citations wrap across lines (`// … (decision` / `// 45)`), so this cannot be a grep. Each file is
// flattened — newline plus the next line's comment marker collapses to one space — with an index map
// back to the original offsets, so a match still reports the line it started on.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
// The line counter is shared: `tools/lib/source.mjs`. Its own `walk` stays here — this gate reads
// three source trees rather than one directory, so the two walks are different questions.
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineOf } from './lib/source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = ['src', 'web/src', 'test'];
const REGISTER = 'docs/decisions.md';
// Both hand-written docs that point AT source. The register resolves a citation to a place; the index
// answers the other direction — "I am holding this file, what explains it". A stale path in either sends
// a reader who trusted it to a file that is not there, so both are checked. `decisions.md` alone was
// checked first and `by-file.md` went stale within the hour, on a path the same refactor had moved.
const PATH_DOCS = [REGISTER, 'docs/by-file.md'];
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.css'];

// `decisions 10 and 21` cites two. The tail repeats the number without repeating the noun, so the
// first number is matched by the head and the rest by this continuation.
//
// The lookahead rejects `ruling 2026-08-11`. A handful of rulings are cited by date rather than by
// number; they are a different notation, they are not numbered identifiers, and treating `2026` as
// one puts a nonsense row in the register.
const CITE = /\b(?:decision|ruling)s?\s+#?(\d+)(?![\d-])((?:\s*(?:,|and|,\s*and|\/|&)\s*#?\d+)*)/gi;
const CONTINUED = /\d+/g;
const SLICE = /\b([SC]\d{1,2})\b/g;

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
};

// Collapses a line break and the following comment marker into a single space, keeping the original
// offset of every character it emits so a match can be reported at the line where it starts.
const flatten = (text) => {
  let flat = '';
  const offsets = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\n') {
      flat += ' ';
      offsets.push(i);
      i += 1;
      while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i += 1;
      const marker = /^(\/\/+|\*+\/?|#+)[ \t]*/.exec(text.slice(i, i + 8));
      if (marker) i += marker[0].length;
      continue;
    }
    flat += text[i];
    offsets.push(i);
    i += 1;
  }
  return { flat, offsets };
};

// One file's citations, in both notations. Split out of `scan` for the NESTING, not the length: two
// notations inside a file inside a directory is four levels of loop, and depth is what the complexity
// metric punishes. Flattening the walk was worth 3 points; extracting the record helper was worth 0.
const citationsInFile = (file, shown, record) => {
  const text = readFileSync(file, 'utf8');
  const { flat, offsets } = flatten(text);
  for (const match of flat.matchAll(CITE)) {
    const line = lineOf(text, offsets[match.index] ?? 0);
    record(`decision ${match[1]}`, shown, line);
    for (const extra of (match[2] ?? '').matchAll(CONTINUED)) record(`decision ${extra[0]}`, shown, line);
  }
  for (const match of flat.matchAll(SLICE)) {
    record(match[1], shown, lineOf(text, offsets[match.index] ?? 0));
  }
};

const scan = () => {
  const found = new Map();
  const record = (id, file, line) => {
    if (!found.has(id)) found.set(id, []);
    found.get(id).push(`${file}:${line}`);
  };
  for (const dir of CORPUS) {
    for (const file of walk(join(ROOT, dir))) citationsInFile(file, relative(ROOT, file), record);
  }
  return found;
};

// A row is `| `decision 45` | …` or `| `S10` | …`. Only the identifier in the first cell counts, so a
// number mentioned in prose elsewhere in the register cannot satisfy the gate by accident.
const registered = () => {
  const rows = new Set();
  const text = readFileSync(join(ROOT, REGISTER), 'utf8');
  for (const match of text.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)) rows.add(match[1].toLowerCase());
  return rows;
};

// THE OTHER HALF OF "THE REGISTER RESOLVES A CITATION": every source path it names must EXIST.
//
// The rows are hand-written prose, so nothing stopped them rotting — and they rotted the same day they
// were written. A refactor moved eleven modules into `src/store/` and four large files into directories,
// and three rows were left pointing at paths that no longer resolve. A register whose "where it binds"
// column is wrong is worse than no register: it sends a reader who trusted it to the wrong file.
//
// A DELETED FILE NAMED AS DELETED IS NOT ROT, which is why this needs an allow-list rather than a bare
// existence check. `decision 42`'s row says the rollup "and `src/core/rollup.ts` are gone with it" — the
// path is the subject of the sentence and must stay. Anything else absent is a stale pointer.
const GONE_ON_PURPOSE = new Set([
  'src/core/rollup.ts',
  'src/core/eligibility.ts',
  'src/index.ts', // `decision 68` — the root barrel, deleted; the row exists so it is not re-added
]);
const PATH_IN_ROW = /`((?:src|web\/src|test|tools)\/[\w./-]+\.(?:ts|tsx|mjs|js|css|md))`/g;

// `decisions.md` writes full paths in prose. `by-file.md` is a set of TABLES under a heading that
// carries the directory — `## \`src/core/\`` — with bare filenames in the first cell, so a row resolves
// only against its section. Checking it with the full-path regex alone matched NINE incidental paths in
// its prose and none of its ~100 index rows: coverage that looks real and is not, which is the failure
// this gate exists to catch in the first place.
const SECTION = /^#{2,3}\s+`([\w./-]+\/)`/;
const ROW_FIRST_CELL = /^\|\s*`([\w./-]+\.(?:ts|tsx|mjs|js|css|md))`\s*\|/;

// One document's path claims, as [path, site] pairs. Split out because the nesting — per doc, per line,
// per match — is what the complexity rule objects to, and flattening it is the fix rather than raising
// the ceiling. (Depth, not length: this file was already flattened once today for the same rule.)
function claimsIn(doc) {
  const claims = [];
  let prefix = '';
  const lines = readFileSync(join(ROOT, doc), 'utf8').split('\n');
  for (const [i, line] of lines.entries()) {
    if (line.startsWith('#')) {
      const heading = line.match(SECTION);
      // A section with no directory heading ("Repository configuration") holds full paths already.
      prefix = heading ? heading[1] : '';
      continue;
    }
    const site = `${doc}:${i + 1}`;
    const row = line.match(ROW_FIRST_CELL);
    if (row) claims.push([`${prefix}${row[1]}`, site]);
    for (const m of line.matchAll(PATH_IN_ROW)) claims.push([m[1], site]);
  }
  return claims;
}

const stalePaths = () => {
  const stale = new Map();
  for (const doc of PATH_DOCS) {
    for (const [path, site] of claimsIn(doc)) {
      if (GONE_ON_PURPOSE.has(path)) continue;
      if (!existsSync(join(ROOT, path))) stale.set(path, site);
    }
  }
  return stale;
};

const found = scan();
const rows = registered();
const missing = [...found.keys()].filter((id) => !rows.has(id.toLowerCase())).sort();
const stale = stalePaths();

const total = [...found.values()].reduce((sum, sites) => sum + sites.length, 0);

// A SMOKE ALARM ON THE CORPUS, because this gate keeps its own `walk` — a recursive one taking a full
// path — rather than the shared one in lib/source.mjs, and so is the one gate the shared floor cannot
// protect. A discovery that matched nothing reports "0 distinct, 0 references" and exits 0, which is
// byte-for-byte what a clean tree looks like. Floored an order of magnitude under the real count so
// that deleting a file never fails the run: this is not a target, and the two anti-vacuity floors this
// repository has already withdrawn were both targets pretending to be alarms.
const REFERENCE_FLOOR = 100;
if (total < REFERENCE_FLOOR) {
  console.error(
    `\nonly ${total} citation reference(s) found, against a floor of ${REFERENCE_FLOOR}. ` +
      `The corpus is missing, so "every identifier has a row" is a claim about nothing.`,
  );
  process.exit(1);
}

console.log(`citations: ${found.size} distinct, ${total} references across ${CORPUS.join(', ')}`);

if (missing.length > 0) {
  console.error(`\n${missing.length} citation(s) with no row in ${REGISTER}:\n`);
  for (const id of missing) {
    const sites = found.get(id);
    console.error(`  ${id} — ${sites.length} reference(s), first at ${sites[0]}`);
  }
  console.error(`\nAdd a row for each to ${REGISTER}, restating the ruling in one sentence.`);
  process.exit(1);
}

if (stale.size > 0) {
  console.error(`\n${stale.size} path(s) in ${PATH_DOCS.join(' / ')} that no longer exist:\n`);
  for (const [path, site] of [...stale].sort()) console.error(`  ${path} — ${site}`);
  console.error(`\nRetarget each to where the code lives now, or add it to GONE_ON_PURPOSE if the row is`);
  console.error(`about its deletion.`);
  process.exit(1);
}

console.log(
  `all ${found.size} identifiers have a row in ${REGISTER}; every path in ${PATH_DOCS.length} docs resolves`,
);
