// Mutation testing: Stryker rewrites the source in small ways ("mutants") and checks whether any
// test fails. A surviving mutant is code the suite executes but does not actually constrain — the
// gap coverage percentages cannot see.
//
// Not a per-commit gate. Coverage and typecheck answer "did this run"; this answers "would anyone
// notice if it broke", which is worth minutes of CPU on demand, not seconds on every push.
// Run it with: npm run mutate  (add -- --force to rebuild the incremental baseline from scratch)

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',

  // Deliberately narrower than "all of src". The first full run scored 66.49% total / 79.89%
  // covered over 2446 mutants, and the untested remainder was almost entirely process plumbing:
  // static.ts (0%), opencode-server.ts (3.3%) and models.ts (18%) exist to spawn things and serve
  // files. Mutating a spawn lifecycle produces timeouts, not insight. Core logic and the HTTP
  // routes are where a surviving mutant means something.
  mutate: ['src/core/**/*.ts', 'src/server/routes/**/*.ts', '!src/core/types.ts'],

  // perTest runs only the tests that actually cover each mutant, which is what keeps this in
  // minutes rather than hours.
  coverageAnalysis: 'perTest',

  // The runner defaults `related` to TRUE, which narrows the run to vitest's --related module
  // graph. That hid 137 of our 299 tests, so anything reaching the code without a static import
  // (the route tests go through app.inject) scored its mutants as survivors. Costs ~4s.
  vitest: { related: false },

  // Reuse results for mutants whose code and covering tests are both unchanged, so a re-run after
  // touching one file costs seconds. --force ignores the cache.
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',

  // progress-append-only instead of the default progress bar: the bar needs a TTY and renders
  // nothing when output is piped to a file or a CI log.
  reporters: ['progress-append-only', 'clear-text', 'html'],

  // Some mutants in the filesystem and watcher paths turn a guard into an await that never settles.
  // 30s is enough to let a genuinely slow test finish while still killing those as timeouts.
  timeoutMS: 30000,

  // concurrency is left at Stryker's default (cpuCount - 1) on purpose — pinning it low is the
  // easiest way to make this look slower than it is.
};
