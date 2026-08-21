import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `docs/by-file.md` EXISTS TO ANSWER "given a file, which page explains it", and it indexed two of the
// five gates in `tools/`. Three were missing — `check-radius-scale.mjs`, `check-class-budget.mjs` and
// `check-shape-coverage.mjs` — so a reader holding a failing `npm run check` had nowhere to go for the
// radius ratchet, the class budget or the six shape censuses, which are between them the reason four
// numbers in this repository are allowed to be ratchets at all.
//
// A GATE IS THE ONE CLASS OF FILE THAT CANNOT EXPLAIN ITSELF AT THE POINT OF USE. `by-file.md`'s own
// preamble says an absent file is the normal case and not a defect, because most modules explain
// themselves in their own comments — but a gate is met as a red exit code in a terminal, by somebody
// who has not opened it, and the page that argues why the number is what it is lives elsewhere. That is
// exactly the condition the index is for.
//
// Asserted BY CLASS and not against a list of five, so the sixth gate is covered by existing.
const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('docs/by-file.md', () => {
  it('indexes every gate in tools/', () => {
    const gates = readdirSync(`${ROOT}tools`).filter(
      (entry) => entry.startsWith('check-') && entry.endsWith('.mjs'),
    );
    // Anti-vacuity: a glob that stopped matching would make every assertion below trivially true, and
    // an empty list is exactly what "all indexed" looks like then.
    expect(
      gates.length,
      'no tools/check-*.mjs found — has this test stopped looking in the right place?',
    ).toBeGreaterThanOrEqual(5);
    const index = readFileSync(`${ROOT}docs/by-file.md`, 'utf8');
    const missing = gates.filter((gate) => !index.includes(`tools/${gate}`));
    expect(
      missing,
      `these gates have no row in docs/by-file.md: ${missing.join(', ')}. A gate is met as a red exit ` +
        `code by somebody who has not read it, so the page that explains its number has to be findable ` +
        `from the file name.`,
    ).toEqual([]);
  });
});
