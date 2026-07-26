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

  // Every module that has real tests, and nothing else — a file with no test scores 100%
  // survivors and reports a gap we already know about, which only drags the number down without
  // adding information.
  //
  // Deliberately NOT here:
  // - static.ts, opencode-server.ts, main.ts: they spawn processes and serve files. Mutating a
  //   spawn lifecycle produces timeouts, not insight.
  // - types.ts / web/src/shared.ts: type declarations. The src<->web mirror is guarded by
  //   test/mirror.test.ts instead.
  // - web/src/api.ts: every test that touches it mocks it or imports only its types, so no
  //   mutant there can be killed.
  // - the React components with no test (Board, Column, the copilot panels, …) —
  //   see notes/quality-backlog.md.
  // - CardTile.tsx: test/card-tile.test.tsx covers its tag row only, deliberately. The rest is
  //   the drag/render shell that item 5 of notes/quality-backlog.md has yet to rule on.
  mutate: [
    'src/core/**/*.ts',
    '!src/core/types.ts',
    'src/server/routes/**/*.ts',
    // Server modules with their own tests. control-files.ts first: it is the path sandbox behind
    // Project Control (the `..` rejection, the symlink realpath walk, the category allow-list)
    // and the closest thing here to a security boundary.
    'src/server/control-files.ts',
    'src/server/skill-catalogue.ts',
    'src/server/run-store.ts',
    'src/server/run-prompt.ts',
    'src/server/agent-runner.ts',
    'src/server/agent-turn.ts',
    'src/server/copilot-events.ts',
    'src/server/session.ts',
    'src/server/snapshot.ts',
    'src/server/chat-store.ts',
    'src/server/discover.ts',
    'src/server/app-state.ts',
    'src/server/route-context.ts',
    // Web modules with their own tests.
    'web/src/markdown.tsx',
    'web/src/viewmodel.ts',
    'web/src/ws.ts',
    'web/src/dock/panes.ts',
    'web/src/dock/tabs.ts',
    'web/src/dock/useCardTabs.ts',
    'web/src/dock/useDock.ts',
    'web/src/skills/filter.ts',
    'web/src/skills/useSkills.ts',
    'web/src/runs/useCardRuns.ts',
    'web/src/copilot/choice.ts',
    'web/src/copilot/format.ts',
    'web/src/useSnapshot.ts',
    'web/src/useLocalPrefs.ts',
    'web/src/useCopilotChoice.ts',
    'web/src/copilot/useCopilot.ts',
    'web/src/components/CardView.tsx',
    'web/src/components/CardLinks.tsx',
    'web/src/components/InlineField.tsx',
    'web/src/components/LinkPicker.tsx',
    'web/src/components/RawPane.tsx',
    'web/src/components/CardsPane.tsx',
    'web/src/components/CardSkills.tsx',
    'web/src/components/DispatchPane.tsx',
    'web/src/components/CardReports.tsx',
    'web/src/components/CardTabs.tsx',
    'web/src/components/ReportPane.tsx',
    'web/src/components/UtilityDock.tsx',
    'web/src/components/ModelPicker.tsx',
    'web/src/components/model-format.ts',
    'web/src/components/TagFilter.tsx',
    'web/src/components/TopBar.tsx',
  ],

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

  // Static mutants (module-level constants and regexes) re-run the WHOLE suite per mutant, and
  // with one worker per core that contention alone blows the timeout — so they were scoring as
  // kills without any test having failed. Proof: twelve mutants of one regex on markdown.tsx:15
  // split 5 timeout / 4 killed / 2 survived, same code, different scheduling. Ignoring them drops
  // them out of the denominator instead of crediting 55 phantom kills; the constants concerned are
  // asserted directly by tests anyway.
  ignoreStatic: true,

  // Report colouring only. `break` stays null deliberately: a blocking gate belongs in the commit
  // that reaches the target, not pointed at a backlog that has to be bypassed.
  thresholds: { high: 95, low: 85, break: null },

  // concurrency is left at Stryker's default (cpuCount - 1) on purpose — pinning it low is the
  // easiest way to make this look slower than it is.
};
