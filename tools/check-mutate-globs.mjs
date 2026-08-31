// EVERY GLOB IN `mutate` MATCHES AT LEAST ONE FILE.
//
// It exists because one did not. `stryker.config.mjs` listed `web/src/templates/WorkArea.tsx` after the
// component moved to `web/src/shell/`, and the entry matched nothing for the whole of the layer phase.
// A glob that matches nothing DOES NOT FAIL — Stryker mutates the files it found and reports a score
// over them, so a component with a real test file left the measurement silently and the run stayed
// green. Nothing in the output distinguishes "clean" from "absent".
//
// That is the same shape as every anti-vacuity finding in this repository: a check whose subject has
// gone away reports success. `stryker.config.mjs` warns about it three times in prose; this is the
// version a machine reads.
//
// NEGATIONS ARE NOT CHECKED, and that is deliberate rather than lazy. `!src/core/types.ts` exists to
// exclude a file, and an exclusion that matches nothing is harmless — it is the inclusion that carries
// a claim about coverage. A negation whose target is gone is dead config, not a false measurement.
//
// Run by `npm run check:mutate-globs`, and part of `npm run check`.
import { globSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { default: config } = await import(join(ROOT, 'stryker.config.mjs'));
const patterns = config.mutate ?? [];

if (patterns.length === 0) {
  console.error('mutate globs: `mutate` is empty or missing from stryker.config.mjs');
  process.exit(1);
}

// Inclusions only — see the note above on negations.
const included = patterns.filter((p) => !p.startsWith('!'));
const empty = [];
let matched = 0;

for (const pattern of included) {
  // `globSync` from `node:fs` rather than a dependency: this runs in the same gate chain as nine other
  // scripts that take none, and the pattern language Stryker uses here is plain minimatch over paths.
  const hits = globSync(pattern, { cwd: ROOT });
  matched += hits.length;
  if (hits.length === 0) empty.push(pattern);
}

console.log(
  `mutate globs: ${included.length} inclusion(s) matching ${matched} file(s), ` +
    `${patterns.length - included.length} exclusion(s) not checked`,
);

if (empty.length > 0) {
  console.error(`\n${empty.length} glob(s) matching NO file:\n`);
  for (const pattern of empty) console.error(`  ${pattern}`);
  console.error(
    '\nA glob that matches nothing does not fail the mutation run — it silently shrinks what is\n' +
      'measured and the score stays green. Either the path moved (repoint it) or the file is gone\n' +
      '(delete the line). Do not leave it: this is exactly how web/src/templates/WorkArea.tsx left\n' +
      'the measurement without anyone noticing.',
  );
  process.exit(1);
}
