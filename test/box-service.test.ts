import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_DIR, RUNS_DIR } from '../src/core/layout.js';
import { boxPathsForBackend } from '../src/server/box-service.js';
import { boxMounts, WORK_DIR } from '../src/server/containers.js';
import { tempDir } from './helpers.js';

// What a box gets FOR a project and backend. The mount set is the containment boundary, and two of its
// properties cannot be seen by reading the argv:
//
//  1. a bind mount whose source does not exist is not skipped by docker — it is CREATED, root-owned, on
//     the host. So anything this returns must already be on disk.
//  2. the credential is the whole of the backend split. A Claude box gets the Claude credential; an
//     OpenCode box must not be able to read it, and that is enforced by absence rather than by a rule.

describe('the paths a box is given', () => {
  it('CREATES the report directory, because docker would create it as root', async () => {
    // Not a tidiness point. Every project that has never run an agent lacks this directory — which is
    // exactly the set of projects about to run one — so without this the first dispatch would leave a
    // root-owned folder inside the user's own project, needing `sudo` to remove.
    const root = await tempDir();
    mkdirSync(join(root, CONFIG_DIR), { recursive: true });
    expect(existsSync(join(root, RUNS_DIR))).toBe(false);

    boxPathsForBackend(root, 'claude-code');

    expect(existsSync(join(root, RUNS_DIR))).toBe(true);
  });

  it('mounts that directory writable, inside a read-only .vibeboard', async () => {
    const root = await tempDir();
    mkdirSync(join(root, CONFIG_DIR), { recursive: true });

    const mounts = boxMounts(boxPathsForBackend(root, 'claude-code'));
    const reports = mounts.find((m) => m.target === `${WORK_DIR}/${RUNS_DIR}`);
    const config = mounts.find((m) => m.target === `${WORK_DIR}/${CONFIG_DIR}`);

    expect(reports).toBeDefined();
    expect(reports?.readOnly).toBeUndefined();
    expect(config?.readOnly).toBe(true);
  });

  it('gives a Claude box the Claude credential and an OpenCode box none of it', async () => {
    // Asserted through the real function rather than a hand-built path set, because the bug this guards
    // was in the wiring: both backends were handed the project's SHARED state root, and OpenCode's
    // `auth.json` lives inside it — so a Claude agent could read the user's other provider keys.
    const root = await tempDir();
    mkdirSync(join(root, CONFIG_DIR), { recursive: true });

    const claude = boxMounts(boxPathsForBackend(root, 'claude-code'));
    const opencode = boxMounts(boxPathsForBackend(root, 'opencode'));

    expect(opencode.some((m) => m.source.includes('.claude'))).toBe(false);
    // The two state directories are different directories, not one shared parent.
    const stateOf = (mounts: { source: string; target: string }[]) =>
      mounts.find((m) => m.target === '/state')?.source;
    expect(stateOf(claude)).not.toBe(stateOf(opencode));
    expect(stateOf(claude)).toMatch(/claude$/);
  });
});
