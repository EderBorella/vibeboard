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

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = ['src', 'web/src', 'test'];
const REGISTER = 'docs/decisions.md';
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

const lineOf = (text, offset) => {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
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

const found = scan();
const rows = registered();
const missing = [...found.keys()].filter((id) => !rows.has(id.toLowerCase())).sort();

const total = [...found.values()].reduce((sum, sites) => sum + sites.length, 0);
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

console.log(`all ${found.size} identifiers have a row in ${REGISTER}`);
