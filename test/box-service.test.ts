import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG_DIR, RUNS_DIR } from '../src/core/layout.js';
import { boxPathsForBackend } from '../src/server/boxes/box-service.js';
import { boxMounts, WORK_DIR } from '../src/server/boxes/containers.js';
import { boxCredentialPath } from '../src/server/boxes/copilot-env.js';
import { tempDir, testTmp } from './helpers.js';

// What a box gets FOR a project and backend. The mount set is the containment boundary, and two of its
// properties cannot be seen by reading the argv:
//
//  1. a bind mount whose source does not exist is not skipped by docker — it is CREATED, root-owned, on
//     the host. So anything this returns must already be on disk.
//  2. the credential is the whole of the backend split. A Claude box gets the Claude credential; an
//     OpenCode box must not be able to read it, and that is enforced by absence rather than by a rule.

// A HOST AND A COPILOT HOME OF THIS FILE'S OWN, for the whole file rather than per test.
//
// `boxPathsForBackend` mirrors the Claude credential as a side effect — deliberately, since it runs
// before every agent turn — so without this the suite would copy the developer's real token into their
// real cache. Set up and torn down once per RUN: a per-test directory here would leak one tree
// per test, which is how 440,653 of them once filled this filesystem's inode table.
const savedHome = process.env.HOME;
const savedCopilot = process.env.VIBEBOARD_COPILOT_HOME;
// The mirror resolves `XDG_CACHE_HOME` first, so on a machine that sets it — many do — a temp `HOME`
// alone would not contain this and the real token would be copied into the developer's real cache.
const savedCacheHome = process.env.XDG_CACHE_HOME;
let hostHome: string;

beforeAll(() => {
  hostHome = mkdtempSync(join(testTmp(), 'vibeboard-host-'));
  process.env.HOME = hostHome;
  delete process.env.XDG_CACHE_HOME;
  process.env.VIBEBOARD_COPILOT_HOME = mkdtempSync(join(testTmp(), 'vibeboard-copilot-'));
  mkdirSync(join(hostHome, '.claude'), { recursive: true });
  writeFileSync(join(hostHome, '.claude', '.credentials.json'), '{"token":"host"}', 'utf8');
});

afterAll(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedCopilot === undefined) delete process.env.VIBEBOARD_COPILOT_HOME;
  else process.env.VIBEBOARD_COPILOT_HOME = savedCopilot;
  if (savedCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = savedCacheHome;
});

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

    const creds = dirname(boxCredentialPath());
    expect(opencode.some((m) => m.source.includes('.claude'))).toBe(false);
    // Nor the mirror, which is the credential's OTHER name now and would otherwise be a Claude
    // credential in an OpenCode box that the check above reads straight past.
    expect(opencode.some((m) => m.source === creds || m.source.startsWith(`${creds}/`))).toBe(false);
    expect(boxPathsForBackend(root, 'opencode').credential).toBeUndefined();
    expect(claude.some((m) => m.source === creds)).toBe(true);
    // The two state directories are different directories, not one shared parent.
    const stateOf = (mounts: { source: string; target: string }[]) =>
      mounts.find((m) => m.target === '/state')?.source;
    expect(stateOf(claude)).not.toBe(stateOf(opencode));
    expect(stateOf(claude)).toMatch(/claude$/);
  });

  it('mounts the credential DIRECTORY, at one path meaning the same thing on both sides', async () => {
    // The bug, stated as an assertion. A bind-mounted FILE pins the inode it was created with; Claude
    // Code refreshes its token by writing a new file and renaming over the old, which makes a new one.
    // Measured on a live box: host inode 5280206, the same path inside the box inode 5303483 with a
    // link count of 0, and mountinfo naming the source `…/.credentials.json//deleted`. Every turn then
    // failed in 58ms as an expired session and auto-pilot blamed the card.
    //
    // Source and target are one path because the symlink VibeBoard writes into the config dir is
    // absolute: it has to resolve to the same file inside the box and out.
    const root = await tempDir();
    mkdirSync(join(root, CONFIG_DIR), { recursive: true });

    const credential = boxPathsForBackend(root, 'claude-code').credential;

    expect(credential?.source).toBe(dirname(boxCredentialPath()));
    expect(credential?.source).toBe(credential?.target);
    expect(statSync(credential?.source as string).isDirectory()).toBe(true);
    // And it is VibeBoard's own copy, never the user's `~/.claude` — which holds 894MB of session
    // transcripts and a `settings.json` whose hooks run on the HOST.
    expect(credential?.source.includes('.claude')).toBe(false);
    expect(credential?.source.startsWith(join(hostHome, '.claude'))).toBe(false);
  });
});
