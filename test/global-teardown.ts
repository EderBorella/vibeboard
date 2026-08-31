import { chmodSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeRunRoot } from './run-tmp.js';

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));

// EVERY `.mjs` UNDER `test/` IS A SPAWNABLE STUB, AND SPAWNING NEEDS THE EXECUTABLE BIT. Stryker
// copies the repo into a sandbox and the copy does not carry mode, so all seven of them arrive 0644
// and `spawn` fails with EACCES.
//
// This is here, once, because the per-file version was wrong in the way a per-site fix always is: one
// `chmodSync` sat at the top of test/runs-route.test.ts and fixed exactly `fixtures/fake-agent.mjs`.
// The other six stayed 0644, so `npm run mutate` could not get past its own DRY RUN — thirteen tests
// in that one file failed with `spawn …/test/fake-docker.mjs EACCES` reported as a run whose agent
// "exited with code unknown", and the mutation gate had been dead for as long as that took to notice.
//
// By class rather than by list, so the eighth fixture is covered by existing. Marking a `.mjs` nobody
// spawns as executable costs nothing.
function makeStubsExecutable(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) makeStubsExecutable(path);
    else if (entry.endsWith('.mjs')) chmodSync(path, 0o755);
  }
}

// Removes the run's temp root (created in vitest.config.ts) when the suite ends.
//
// The root has to exist before the config's `env` block can point at it, so it is made there and only
// cleaned up here — which is why `setup` does no directory work of its own.
//
// SIGNALS ARE HANDLED IN `vitest.config.ts` NOW, not here: teardown does not run when the process is
// interrupted, so Ctrl-C used to leak a whole tree every time. Only SIGKILL survives, which is
// unclosable by construction and stays the deliberate trade — one attributable directory per killed
// run, instead of hundreds of anonymous ones per successful run.
export function setup(): void {
  makeStubsExecutable(TEST_DIR);
}

export function teardown(): void {
  // THE GUARD AND THE DELETE BOTH LIVE IN `test/run-tmp.ts` NOW, because `vitest.config.ts` needs the
  // same pair for its signal handlers — and a `rm -rf` whose safety check is written twice is a
  // `rm -rf` whose two copies will disagree eventually.
  removeRunRoot(process.env.VIBEBOARD_TEST_TMP);
}
