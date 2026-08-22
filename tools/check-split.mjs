#!/usr/bin/env node
//
// THE SPLIT IS A MOVE, AND THIS IS THE PROOF: concatenating the 47 layer sheets in the order
// `web/src/styles.ts` imports them gives `web/src/styles.css` back byte for byte, comments included.
//
// Run it with: npm run check:split
//
// Three claims, all blocking at zero:
//   1. The concatenation equals `tools/fixtures/styles-pre-split.css`, the file as it stood at the
//      commit before the split. Not a checksum: a mismatch has to be readable, so it reports the first
//      differing byte with the part it falls in and the line it is on.
//   2. Every `.css` file under `web/src` is imported by the manifest exactly once. An orphan sheet is
//      invisible twice over — the app never loads it and the concatenation never sees it — so a part
//      dropped from the list would otherwise read as a clean run with a surface missing.
//   3. The three sheets that are not parts are the first three imports. Claim 1 CANNOT MAKE THIS ONE,
//      and that is not a nuance: the non-parts are filtered out before the join, so the concatenation
//      only ever sees the parts' order relative to EACH OTHER. Both reorders across that boundary were
//      planted and both exited 0 here — `design/reset.css` lifted above `ui/primitives.css`, and
//      `ui/primitives.css` moved to the end, which put a 15.5px span in a 14.0px flex row on all three
//      themes. `styles.ts` is the cascade, so the boundary between the parts and the sheets every part
//      overrides has to be pinned where the parts' own order is.
//
// WHY BYTES AND NOT "THE SAME RULES": the failure this exists to catch is a cascade change, not a typo.
// Equal-specificity rules are decided by source order, and `styles.css` leaned on that in both
// directions — `.conn-status:hover .conn-text` is written last on purpose, `.ap-kill`'s danger hover
// beats `.vb-btn-ghost` only because it is later. A rule lifted out of the `@container` block at
// `styles.css:527` or moved between two parts keeps every declaration it had and renders differently,
// and only the byte order says so.
//
// WHAT IT COSTS AND WHEN IT RETIRES. The witness is a 116KB copy of a file that no longer exists, which
// is worth carrying for exactly one phase: this gate is `npm run check:split` and is deliberately NOT
// in `npm run check`, because the next phase in the sweep puts hand-written lengths onto the space
// scale and the first such edit makes the claim false by design. THE COMMIT THAT CHANGES A DECLARATION
// DELETES THIS GATE, its witness and its `package.json` line — a gate that has to be bypassed is worse
// than no gate. Until then it is the only instrument that can tell a move from an edit.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineOf } from './lib/source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = 'web/src';
const MANIFEST = 'web/src/styles.ts';
const WITNESS = 'tools/fixtures/styles-pre-split.css';

// The three sheets that were already their own files when `styles.css` was split, so they are not
// slices of it: the token block and the palettes (split out in the phase before this one) and the
// primitives. Everything else the manifest imports is a part.
// Geometry, then colour, then the primitives every surface overrides — in that order, ahead of all 47.
const HEAD = ['design/tokens.css', 'design/themes.css', 'ui/primitives.css'];
const NOT_A_PART = new Set(HEAD);

// A SMOKE ALARM, NOT A TARGET — the same argument as walk() in lib/source.mjs. A manifest parser that
// stopped matching would find no parts, concatenate nothing, and an empty string compared against an
// empty list of parts is not a clean tree: it is a gate that has stopped asking. Floored an order of
// magnitude under the 47 parts so that merging parts in a later phase never fails the run for
// succeeding.
const PART_FLOOR = 5;

const read = (file) => readFileSync(join(ROOT, file), 'utf8');

// Bare side-effect imports of a `.css`, in source order. `import './x.css';` only — a specifier with a
// binding is not a stylesheet, and the order of these is the cascade.
export const sheetsOf = (manifest) =>
  [...manifest.matchAll(/^\s*import\s+'\.\/([^']+\.css)';/gm)].map((m) => m[1]);

// Every `.css` under the corpus, as a manifest-relative specifier.
const sheetsOnDisk = () =>
  readdirSync(join(ROOT, CORPUS), { recursive: true })
    .filter((entry) => typeof entry === 'string' && entry.endsWith('.css'))
    .sort();

// WHERE THE TWO DIVERGE, in the terms a person can act on: the part, and the line inside the original.
// A checksum would say "different" and leave the reader to bisect 116KB by hand.
export function firstDifference(parts, witness) {
  const joined = parts.map(({ text }) => text).join('');
  if (joined === witness) return null;
  let at = 0;
  while (at < joined.length && at < witness.length && joined[at] === witness[at]) at += 1;
  let offset = 0;
  let where = 'past the end of the last part';
  for (const part of parts) {
    if (at < offset + part.text.length) {
      where = `${part.file} (its own line ${lineOf(part.text, at - offset)})`;
      break;
    }
    offset += part.text.length;
  }
  return {
    at,
    line: lineOf(witness, at),
    where,
    got: JSON.stringify(joined.slice(at, at + 60)),
    want: JSON.stringify(witness.slice(at, at + 60)),
  };
}

// THE PARSER AND THE LOCATOR, ON A FIXTURE THE TREE CANNOT MOVE — the lesson this repository learned
// twice: a self-test that carries its own regex has no opinion about the code under test. Both
// functions the claims rest on are exercised here, in both directions.
const FIXTURE_MANIFEST = `
import './design/tokens.css';
import { App } from './app/App';
import './a/one.css';
// import './commented/out.css';
import './b/two.css';
`;

function selfTest() {
  const sheets = sheetsOf(FIXTURE_MANIFEST);
  if (sheets.join(',') !== 'design/tokens.css,a/one.css,b/two.css') {
    return `manifest parse: got [${sheets.join(',')}]`;
  }
  const parts = [
    { file: 'a/one.css', text: '.alpha { color: red }\n' },
    { file: 'b/two.css', text: '@media (min-width: 1px) { .beta { color: red } }\n' },
  ];
  const whole = parts.map((p) => p.text).join('');
  if (firstDifference(parts, whole) !== null) return 'locator: an identical pair reported a difference';
  // The planted defect this gate exists for, in miniature: the rule lifted OUT of the at-rule. Same
  // declarations, different bytes, and the report has to name the part rather than the byte offset.
  const lifted = [parts[0], { file: 'b/two.css', text: '.beta { color: red }\n' }];
  const found = firstDifference(lifted, whole);
  if (!found) return 'locator: a rule lifted out of an at-rule read as identical';
  if (!found.where.startsWith('b/two.css')) return `locator: blamed ${found.where}`;
  // A reordering, which is the other half of the claim: the parts are the same bytes in the wrong order.
  const swapped = [parts[1], parts[0]];
  if (!firstDifference(swapped, whole)) return 'locator: a reordering read as identical';
  return null;
}

const fault = selfTest();
if (fault) {
  console.error(`\nthe split checker is broken: ${fault}.`);
  console.error(`Both claims are vacuous — they would pass whatever the tree holds. Fix the parser or`);
  console.error(`the locator in tools/check-split.mjs; do NOT relax the fixture.`);
  process.exit(1);
}

if (!existsSync(join(ROOT, WITNESS))) {
  console.error(`\n${WITNESS} is missing, so there is nothing to compare the parts against.`);
  console.error(`If the sweep has moved past the split, delete this gate rather than leaving it green.`);
  process.exit(1);
}

const manifest = read(MANIFEST);
const imported = sheetsOf(manifest);
const parts = imported
  .filter((file) => !NOT_A_PART.has(file))
  .map((file) => ({ file, text: read(join(CORPUS, file)) }));

if (parts.length < PART_FLOOR) {
  console.error(`\nonly ${parts.length} part(s) read out of ${MANIFEST}, against a floor of ${PART_FLOOR}.`);
  console.error(`The manifest parser has stopped matching, so the concatenation is a claim about nothing.`);
  process.exit(1);
}

const witness = read(WITNESS);
const bytes = parts.reduce((sum, part) => sum + part.text.length, 0);
console.log(`split: ${parts.length} part(s), ${bytes} byte(s), against ${witness.length} in ${WITNESS}`);

let failed = false;

const head = imported.slice(0, HEAD.length);
if (head.join(', ') !== HEAD.join(', ')) {
  console.error(`\nthe manifest does not open with the three sheets that are not parts.`);
  console.error(`  expected: ${HEAD.join(', ')}`);
  console.error(`  found:    ${head.join(', ')}`);
  console.error(`\nA part loaded before the tokens reads them as unset; a part loaded before the`);
  console.error(`primitives loses every colour override the primitive header describes. Neither is`);
  console.error(`visible in the concatenation, because the non-parts are not in it.`);
  failed = true;
}

const difference = firstDifference(parts, witness);
if (difference) {
  console.error(`\nthe concatenation is NOT the pre-split file.`);
  console.error(`\n  first difference at byte ${difference.at}, ${WITNESS} line ${difference.line}`);
  console.error(`  in ${difference.where}`);
  console.error(`  parts hold: ${difference.got}`);
  console.error(`  the file held: ${difference.want}`);
  console.error(`\nA part was edited, resliced or reordered. This phase is a MOVE: no declaration`);
  console.error(`changes, no class is renamed, and a rule lifted out of an @media or @container block`);
  console.error(`changes what renders even though it keeps every declaration it had.`);
  failed = true;
}

const orphans = sheetsOnDisk().filter((file) => !imported.includes(file));
if (orphans.length > 0) {
  console.error(`\n${orphans.length} stylesheet(s) under ${CORPUS} that ${MANIFEST} does not import:\n`);
  for (const file of orphans) console.error(`  ${file}`);
  console.error(`\nAn unimported sheet is loaded by nothing and proved by nothing. Import it at the`);
  console.error(`position its bytes held, or delete it.`);
  failed = true;
}

const twice = imported.filter((file, i) => imported.indexOf(file) !== i);
if (twice.length > 0) {
  console.error(`\n${twice.length} sheet(s) imported more than once by ${MANIFEST}: ${twice.join(', ')}.`);
  console.error(`A sheet loaded twice is a cascade nobody chose.`);
  failed = true;
}

if (failed) process.exit(1);

console.log(`the parts concatenate to the pre-split file exactly, behind ${HEAD.length} non-parts;`);
console.log(`every sheet in ${CORPUS} is imported exactly once`);
