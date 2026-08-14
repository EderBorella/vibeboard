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
  // agent-runner.ts IS in scope, but note why its tests are slow on purpose: they drive a real child
  // process through the VIBEBOARD_CLAUDE_BIN shim, and with 19 concurrent runners a spawn can take
  // seconds to start. At a 5s run timeout that lost the race and failed the DRY RUN — before any
  // mutant existed — so the timeouts there are deliberately generous.
  // - types.ts / web/src/shared.ts: type declarations. The src<->web mirror is guarded by
  //   test/mirror.test.ts instead.
  // - web/src/api.ts and all of web/src/api/ EXCEPT http.ts: the twenty-six test files that touch the
  //   feature modules mock the whole module, and the rest import only its types, so no mutant in them
  //   can be killed. Verified against Stryker's own FileMatcher after the split rather than assumed —
  //   no pattern below reaches `web/src/api/`, which is the same trap the block above warns about
  //   arriving through a split. http.ts is the exception and IS listed with the web block, because
  //   test/api-honesty.test.ts loads the real module and asserts on the chokepoint itself.
  // - the React components with no test — App, Board, Column, CardTile, ArchiveDrawer, the two
  //   control-file editors, ProjectControl, ProjectGate, ResourcesEditor, SettingsModal and the four
  //   copilot panels. They are largely presentational: the decision logic was already extracted into
  //   viewmodel.ts and the hooks, which ARE tested and measured here, so the reward is much lower
  //   than the file count suggests and most of what is left would be asserting on markup.
  // - CardTile.tsx: test/card-tile.test.tsx covers its tag row only, deliberately. The rest is the
  //   drag/render shell, and it is the same open judgement as the render-heavy panes below — whether
  //   JSX string and attribute mutants are worth chasing anywhere. Nothing has ruled on it, and the
  //   answer should be applied consistently rather than file by file.
  mutate: [
    'src/core/**/*.ts',
    '!src/core/types.ts',
    // The store layer, as a DIRECTORY. Eleven of these modules were measured by `src/core/**` and five
    // more were named individually under `src/server/`; moving them all into `src/store/` would have
    // dropped sixteen files out of the measurement with nothing to say so, because `.mjs` is invisible
    // to both biome and tsc and a glob that matches nothing scores green over zero mutants. Verified
    // against Stryker's own FileMatcher (minimatch over path.resolve) before and after the move, not
    // assumed: 136 files before, 139 after.
    //
    // The three extra are diary-store.ts, suggestion-store.ts and autopilot-store.ts, which each have
    // their own test file and were simply never listed. This block's rule is "every module that has real
    // tests, and nothing else", so they belong here; the count going UP is the correction of an omission,
    // not a widening of scope.
    //
    // Two of the individually-named entries this replaces carried reasons worth keeping:
    // project/control-files.ts is the path sandbox behind Project Control (the `..` rejection, the symlink
    // realpath walk, the category allow-list) and the closest thing in this tree to a security boundary;
    // write-queue.ts holds the atomic write that run-store.ts used to have inline, so it is measured for
    // the same reason redaction.ts is.
    'src/store/**/*.ts',
    // THE LOOP AND THE PROCESS LAYER. Neither directory appeared in this list at all — not excluded with
    // a reason, simply never added — so the code that decides whether a card moves had no mutation
    // coverage while thirty React components did. Every module in both has its own test file, which is
    // this block's rule; the pairing was checked module by module rather than assumed.
    //
    // The exclusion this does NOT make: the note above says spawn lifecycles produce timeouts rather than
    // insight, and that prior was simply wrong here. Measured per module, git-work.ts — 419 lines driving
    // real git in scratch repos — produced 242 mutants, 204 killed and ZERO timeouts, the best behaved
    // file of the five; commands.ts also zero. The timeouts were in the two SMALL pure-ish modules and
    // were an artefact of the old 30s budget, which is fixed in timeoutMS below rather than by dropping
    // files.
    //
    // One line of src/exec/process-group.ts carries a `Stryker disable` comment, and it is the one place
    // in this repository where a mutant is genuinely unsafe to run rather than merely uninformative:
    // removing the `pgid <= 1` guard lets a test's deliberate `0` reach `process.kill(-0)`, which signals
    // the worker's own process group — Stryker's. It killed two whole runs at 94% with exit 143 before it
    // was understood. Disabled at the line, so the module's other ~90 mutants stay measured.
    'src/service/**/*.ts',
    'src/exec/**/*.ts',
    // EVERY ROUTE MODULE, BY THE CONVENTION THAT NAMES IT, and this replaces `src/server/routes/**/*.ts`.
    // The flat `routes/` directory is gone: each route module now sits in its feature folder, named
    // `routes.ts` where the feature has one HTTP surface and `<subject>-routes.ts` where it has several.
    // A pattern that still said `routes/**` would match nothing and score green over zero mutants —
    // exactly the trap the block above warns about — so these two were verified against Stryker's own
    // FileMatcher (minimatch over path.resolve, dot:false) against `git ls-files`, not assumed: 139 files
    // measured before the move and 139 after, the same 139.
    //
    // Better than what it replaces, as well as equal to it: a route added inside a feature folder is
    // picked up by the convention, where the old glob only worked for as long as one flat directory
    // held every route.
    'src/server/**/routes.ts',
    'src/server/**/*-routes.ts',
    // Server modules with their own tests.
    'src/server/runs/agent-runner.ts',
    // Extracted OUT of agent-runner.ts, so listed with it for the reason the web block below states:
    // moving code out of a mutated file into an unmutated one loses the coverage silently.
    // redaction.ts is the credential scrub the transcript, the report and the chat all go through. It
    // stays flat in `src/server/` because three features reach it, which is also why it is not in
    // `runs/` beside the runner it came out of.
    'src/server/redaction.ts',
    // The dispatch prompt, as a DIRECTORY. It is now filed under the feature that dispatches, and the
    // `run-prompt.ts` barrel that used to stand in front of it is gone — nothing else here reaches
    // `src/server/runs/prompt/`, verified against the FileMatcher rather than assumed, so a pattern left
    // pointing at the old path would have silently dropped ~600 lines out of the measurement.
    'src/server/runs/prompt/**/*.ts',
    // The shared agent-process layer, flat in `src/server/` because both dispatch and the chat go
    // through it: one turn of an agent, and the parser for what that process writes back.
    'src/server/agent-turn.ts',
    'src/server/copilot-events.ts',
    'src/server/boards/session.ts',
    'src/server/boards/snapshot.ts',
    'src/server/boards/discover.ts',
    'src/server/settings/app-state.ts',
    'src/server/route-context.ts',
    'src/server/logging.ts',
    // Web modules with their own tests. The shared helpers first: moving code out of a mutated file
    // into an unmutated one loses the coverage silently, and every one of these was extracted from
    // files already in this list.
    'web/src/format.ts',
    'web/src/errors.ts',
    // The one network chokepoint, split out of web/src/api.ts and measurable for the first time:
    // test/api-honesty.test.ts drives the real module through a stubbed fetch and pins the `res.ok`
    // check, the 401 rules and the 409 allowance. The feature modules around it stay excluded above.
    'web/src/api/http.ts',
    'web/src/useFetched.ts',
    'web/src/useAction.ts',
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
    'web/src/runs/useRuns.ts',
    'web/src/runs/useDispatch.ts',
    'web/src/runs/viewmodel.ts',
    'web/src/runs/format.ts',
    'web/src/confirm/useConfirm.tsx',
    'web/src/confirm/requests.ts',
    'web/src/copilot/choice.ts',
    'web/src/copilot/format.ts',
    'web/src/useSnapshot.ts',
    'web/src/useLocalPrefs.ts',
    'web/src/useCopilotChoice.ts',
    'web/src/copilot/useCopilot.ts',
    'web/src/cards/CardView.tsx',
    'web/src/cards/CardLinks.tsx',
    'web/src/ui/InlineField.tsx',
    'web/src/cards/LinkPicker.tsx',
    'web/src/cards/RawPane.tsx',
    'web/src/cards/CardsPane.tsx',
    'web/src/cards/CardsBody.tsx',
    'web/src/board/BoardsView.tsx',
    'web/src/app/WorkArea.tsx',
    'web/src/runs/ActiveReport.tsx',
    'web/src/skills/CardSkills.tsx',
    'web/src/runs/DispatchPane.tsx',
    'web/src/runs/CardReports.tsx',
    'web/src/cards/CardTabs.tsx',
    'web/src/runs/ReportPane.tsx',
    'web/src/runs/ReportOptions.tsx',
    'web/src/runs/ExecutionView.tsx',
    'web/src/skills/SkillEditor.tsx',
    'web/src/dock/UtilityDock.tsx',
    // ModelPicker.tsx is deliberately NOT here. Its decision logic — which models to show and in
    // what order — was lifted into model-filter.ts, which IS measured; what is left is a modal of
    // chips, and its residue was 85 unreached JSX string and attribute mutants. Owner's ruling
    // (2026-07-27): test the small shells, exclude this one and say why.
    'web/src/models/model-filter.ts',
    'web/src/models/model-format.ts',
    'web/src/board/TagFilter.tsx',
    'web/src/app/TopBar.tsx',
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

  // 120s, RAISED FROM 30s BECAUSE 30s WAS MEASURING THE MACHINE AND CALLING IT COVERAGE.
  //
  // Mutants in the filesystem and watcher paths do turn a guard into an await that never settles, and a
  // timeout is the only thing that catches those. But at 30s with 19 workers the timeout was also firing
  // on mutants that cannot hang at all — one per line, scattered across `changedPaths` and `parseStatus`
  // in git-measure.ts, both of them pure functions over two objects.
  //
  // Measured on that one file, three ways, same code:
  //
  //   19 workers / 30s    72 timeout   33 killed    1 survived
  //    4 workers / 30s     2 timeout   94 killed   10 survived
  //   19 workers / 120s    2 timeout   94 killed   10 survived     <- this setting
  //
  // Stryker counts a timeout as a detection, so the 30s run did not merely add uncertainty: it credited
  // 70 phantom kills AND HID NINE REAL SURVIVORS, i.e. it was wrong in the flattering direction. The two
  // timeouts that survive both fixes are the genuine article — `i -= 1` on the two manual loop
  // increments, which really do not terminate.
  //
  // Raising the timeout rather than lowering concurrency, because the two give the identical verdict and
  // this one keeps the parallelism: both runs above took ~3 minutes. The cost is that a genuinely
  // hanging mutant now occupies a worker for two minutes instead of thirty seconds, and there are two of
  // them in 106.
  timeoutMS: 120000,

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

  // concurrency is left at Stryker's default (cpuCount - 1, so 19 here) on purpose. It used to say
  // "pinning it low is the easiest way to make this look slower than it is", which was true and beside
  // the point: the default was silently corrupting the verdict, and the fix belonged in timeoutMS. See
  // the measurement there before changing either.
};
