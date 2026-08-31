# Code Quality — verify the gate, not the tick

The project's copy, `@`-imported by `CLAUDE.md` at the root. It is a copy rather than a pointer
because most of the incidents below happened **in this repository** — the `npx biome` squat, the
inode exhaustion from per-test `mkdtemp`, the mutation run whose timeouts were counted as kills, the
whole-file substitution that rewrote a neighbouring fixture. They belong beside the code that
produced them. A general improvement is worth carrying back to the machine-level copy by hand.

Quality tooling fails silently more often than loudly. A passing check proves nothing
until you have seen it fail on purpose.

1. **NEVER invoke a tool by bare name through a runner.** `npx <tool>` will happily
   fetch and run an unrelated package that squats the name, exit 0, and do nothing.
   Real example: `npx biome` runs `biome@0.3.3`, an env-var utility, which reported a
   whole repo as needing no formatting. Always use the project's own script
   (`npm run lint`) or the local binary (`./node_modules/.bin/<tool>`), and confirm
   `--version` the first time.

2. **Prove every gate is live by planting a defect.** Before you claim a hook, CI job,
   compiler flag or test suite works, break something on purpose and watch it fail: a
   type error, a failing assertion, an unused variable, a wrong id in a mocked call.
   Then restore it. "It passed" is not evidence that it ran. Report the planted-defect
   result, not the green tick.

3. **NEVER quote a number from truncated output.** Linters and analysers cap their
   diagnostics by default. A cap read as a total becomes a wrong claim in your summary
   ("20 files" when it was 83). For any figure you intend to state, use the
   machine-readable reporter or explicitly disable the limit. And never read a report the
   run did not write: a failed dry run leaves the previous result on disk, and it will be
   quoted as current. Delete the output first, then confirm the run recreated it.

4. **Verify what a search actually matched before concluding from it.** A character
   class that omits digits silently drops whole categories of finding (`[a-z]+` misses
   `a11y`). A substring match on a common word "proves" coverage that does not exist.
   When a grep result is about to become a claim, print the matches and read them.

5. **Remove the cause before suppressing the warning.** A suppression is the last
   option, not the first. Often the rule is pointing at a real design fault, and fixing
   it deletes the risk instead of hiding it. Suppress ONLY where the rule genuinely
   cannot express a deliberate idiom, and put the reason on the suppression line itself.

6. **A guard that returns a boolean narrows nothing.** If you find yourself writing
   non-null assertions after your own check, fix the check — make it a type predicate.
   One guard corrected can delete dozens of assertions; asserting at every use site is
   the same mistake repeated. Note that narrowing does not survive a closure boundary —
   hoist to a `const` first.

7. **When refactoring toward a metric, re-measure after each step.** The extraction that
   feels obvious is often worth zero. Complexity metrics punish **nesting** far more
   than length, so flattening a nested conditional usually beats extracting a function.
   Measure, don't assume.

8. **Characterise before refactoring anything untested.** Write tests against the
   CURRENT behaviour first, and run them against the current code so you know they pass.
   They frequently find a real bug in the code you were about to move. Pin a known bug
   as an expected-failure test so it flips the moment it is fixed.

9. **NEVER point a blocking gate at a pre-existing backlog.** A gate that must be
   bypassed habitually is worse than no gate, because it teaches everyone to ignore it.
   Report the findings, drive the count to zero, then make it blocking — in the commit
   that reaches zero.

10. **Treat static-analysis output as leads, not facts.** Analysers have accuracy
    settings that trade correctness for speed and will invent findings. Verify an
    individual finding by reproducing it yourself before acting on it, and especially
    before reporting it as a bug.

11. **On metered CI, shape the pipeline to the billing.** Per-job rounding means
    parallel jobs cost multiples for the same work — prefer one job. Always set an
    explicit timeout, cancel superseded runs, and keep minutes-long analysis (mutation
    testing, full audits) out of per-push CI.

12. **Count your replacements when editing by script.** A whole-file string substitution
    meant for one test silently rewrote a neighbouring fixture; the suite caught it, which
    it should not have had to. Anchor on enough context to be unique, or pass a count of one.

## Tests

A passing test proves the code ran, not that anything holds it in place. These are the ways
that gap has actually bitten, not the ways it could.

1. **Prove a test constrains the thing it names.** Delete or invert the code it claims to
   cover and watch it fail. A path sandbox's traversal guard was deleted and all 403 tests
   stayed green; a test called "refuses a rename whose target folder exists" was refused
   earlier by a different branch and had never reached the check at all.

2. **Never assert with `toContain` what is really about exact bytes.** Separator logic — one
   blank line versus two, a newline appended before an import block — is invisible to a
   substring match. If the bytes are the behaviour, assert the whole string.

3. **A test suite must be safe to run in parallel with itself.** Fixed paths inside the repo
   are the usual culprit: two files wrote a shim's arguments to one log, so concurrent
   workers read each other's data. `mkdtemp` per process, outside the repo. Verify by running
   N copies at once, not by reasoning about it.

4. **A count of detections is not a count of detections.** Under `bail`, any failing test
   makes a mutation run record a kill — so a flaky suite makes coverage look *better* than it
   is. And a timeout is not a detection at all: static mutants re-run the whole suite, so
   contention alone blows the budget. Twelve mutants of one regex split 5 timeout / 4 killed
   / 2 survived on identical code. Fix flakiness first; check `static` and the status reason
   before counting.

5. **A fixture too thin to distinguish two outcomes tests neither.** Removing one id from a
   list of one and removing all of them both yield `[]` — give it two. And know which
   argument a comparator receives: `(a, b) => b.field ?? ''` only ever sees an already-sorted
   element as `b`, so a single edge-case row written last never reaches the fallback.

6. **A mock must be keyed the way the real thing is keyed.** A hook factory returning one
   object forever makes every dependency array trivially stable, so no test can tell a
   correct dep list from a frozen one. Mirror the real identity rule.

7. **Fake timers cannot flush real I/O.** A debounced write ends in the filesystem; a faked
   clock observes the timer firing and never the write landing. Use real time with generous
   margins, or assert only the negative.

8. **Extract logic rather than asserting on markup.** Pure functions that were module-private
   in a component are worth lifting into a sibling module and testing directly — they need no
   DOM. What is left is genuinely presentational, and saying so in the config beats a number
   nobody trusts.

9. **Equivalent mutants are a real category — verify one, then record it.** An empty encoding
   on `writeFile` does not throw and writes identical bytes; two guards that each catch what
   the other misses mask each other's mutants. Probe the claim, then write the reason where
   the next reader will look. Chasing them is waste; assuming them is worse.

10. **When a test's premise fails, decide which of the two is wrong.** Three times the code
    was right and the assertion was not: a directory that takes any file type, a slug
    function that turns non-ASCII into a separator, a list that always includes its in-memory
    head. Each one became a test of the real contract.

11. **When a test failure will not sit still, check `df -i` before anything else.** Two runs of 2,047
    tests each returned `1 failed | 2046 passed`, a different test each time, and the cause was never
    caught by name — it was inode exhaustion, and every file-creating call had become a coin flip.
    The hunt went to the code first because the symptom is indistinguishable from flaky code. `df -h`
    looks fine while this is happening; only the inode table shows it.

12. **A suite must remove what it writes to disk, and `df -i` is the first thing to check when
    a failure will not sit still.** `mkdtemp` per test with no cleanup leaks a whole scaffolded
    tree each time: 440,653 of them over four weeks exhausted the filesystem's **inodes** —
    9.43M of 9.83M — while 61G of block space sat free. Past that ceiling every file-creating
    call is a coin flip, so **one arbitrary test fails per run and the other 2,046 pass**, which
    is indistinguishable from flakiness in the code and consumed a hunt, a review and two
    unexplained runs before anyone looked at the environment. Fix with one per-RUN root removed
    in teardown, never a swept shared prefix — a parallel run's live directories share it. Count
    the leftovers with `find`, never a glob: `ls -1d /tmp/prefix-* | wc -l` prints **0** at that
    scale, because the glob passes `ARG_MAX` and `ls` fails.

## Comments

Terse. Explain **why**, never what the code already says. A one-line guard does not need
a paragraph above it. If the reason needs three sentences, the code probably needs
restructuring instead.

The rule: earn the green tick, then distrust it.
