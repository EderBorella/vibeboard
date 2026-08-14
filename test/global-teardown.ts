import { chmodSync, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
// If a run is SIGKILLed teardown never fires and one `vibeboard-run-*` tree survives. That is the
// deliberate trade: one attributable directory per crashed run, instead of hundreds of anonymous ones
// per successful run.
export function setup(): void {
  makeStubsExecutable(TEST_DIR);
}

export async function teardown(): Promise<void> {
  const root = process.env.VIBEBOARD_TEST_TMP;
  // Refuse anything that is not one of ours. A teardown that ran `rm -rf` on an empty or unexpected
  // path is a worse bug than the leak it is fixing.
  if (!root || !/vibeboard-run-[^/]+$/.test(root)) return;
  await rm(root, { recursive: true, force: true });
}
