import { rm } from 'node:fs/promises';

// Removes the run's temp root (created in vitest.config.ts) when the suite ends.
//
// `setup` is empty on purpose: the root has to exist before the config's `env` block can point at it,
// so it is made there and only cleaned up here.
//
// If a run is SIGKILLed this never fires and one `vibeboard-run-*` tree survives. That is the
// deliberate trade: one attributable directory per crashed run, instead of hundreds of anonymous ones
// per successful run.
export function setup(): void {}

export async function teardown(): Promise<void> {
  const root = process.env.VIBEBOARD_TEST_TMP;
  // Refuse anything that is not one of ours. A teardown that ran `rm -rf` on an empty or unexpected
  // path is a worse bug than the leak it is fixing.
  if (!root || !/vibeboard-run-[^/]+$/.test(root)) return;
  await rm(root, { recursive: true, force: true });
}
