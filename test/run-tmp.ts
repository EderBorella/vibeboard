import { rmSync } from 'node:fs';

// THE ONE PLACE THAT DECIDES WHAT A RUN ROOT IS, and the only place allowed to delete one.
//
// `vitest.config.ts` makes the root and removes it on a signal; `test/global-teardown.ts` removes it
// when the suite ends normally. Both need the same guard, and a `rm -rf` whose safety check is written
// twice is a `rm -rf` whose two copies will disagree eventually. It lives here so there is one regex.
//
// A per-RUN root and never a swept prefix: a teardown that removed `/tmp/vibeboard-*` wholesale would
// delete the live directories of any suite running beside it, and Stryker spawns one worker per core.
const RUN_ROOT = /vibeboard-run-[^/]+$/;

// Refuse anything that is not one of ours. A teardown that ran `rm -rf` on an empty or unexpected path
// would be a worse bug than the leak it exists to fix.
export function isRunRoot(path: string | undefined): path is string {
  return typeof path === 'string' && RUN_ROOT.test(path);
}

// SYNCHRONOUS, because its other caller is a signal handler and the process is on its way out — an
// `await` there is a promise nobody will be alive to settle. `force` makes it idempotent, which matters
// because the normal teardown and the `exit` handler can both reach it on one run.
export function removeRunRoot(path: string | undefined): void {
  if (!isRunRoot(path)) return;
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // A failed cleanup must not turn a passing run red, or a red one into a confusing one. The cost of
    // missing it is one attributable directory; the cost of throwing here is a suite that fails for a
    // reason unrelated to anything it tested.
  }
}
