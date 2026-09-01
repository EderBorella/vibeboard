import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentBuildContext, buildArgs, ensureAgentImage } from '../src/server/boxes/image-build.js';

// BUILDING THE AGENT IMAGE FROM INSIDE THE PRODUCT.
//
// The product detected the missing prerequisite, named it, and had no code path that could satisfy it:
// it printed `npm run box:build`, which is a developer command. An installed VibeBoard has no npm
// scripts, no Dockerfile and no repository — so the single instruction it gave for its own hard
// dependency only worked inside a git clone, and on any other machine the app was bricked.

describe('the build context', () => {
  // THE CLAIM THAT MAKES IT SHIPPABLE. The Dockerfile copies three files, all of them from this
  // directory, so the context was never the repository root — that was just what the npm script passed.
  // Narrowing it is what lets the build run from an installed tree.
  it('is a real directory holding everything the Dockerfile copies', () => {
    const context = agentBuildContext();
    for (const file of ['Dockerfile.agent', 'relay.mjs', 'entrypoint.sh', 'vb-install']) {
      expect(existsSync(join(context, file))).toBe(true);
    }
  });

  // Resolved from the module and not from `process.cwd()`, so `npm start` from any directory finds the
  // install it is running — the same claim `logging.ts` makes about its own root, and the same failure
  // if it is wrong: it works in development and nowhere else.
  it('does not depend on the working directory', () => {
    const here = agentBuildContext();
    const previous = process.cwd();
    try {
      process.chdir('/');
      expect(agentBuildContext()).toBe(here);
    } finally {
      process.chdir(previous);
    }
  });

  it('names the Dockerfile as well as the context, because it is not called Dockerfile', () => {
    const args = buildArgs('vibeboard-agent:test');
    expect(args[0]).toBe('build');
    expect(args).toContain('-f');
    expect(args.some((a) => a.endsWith('Dockerfile.agent'))).toBe(true);
    expect(args).toContain('vibeboard-agent:test');
    // The context is the LAST argument, and it is the directory rather than the file.
    expect(args.at(-1)).toBe(agentBuildContext());
  });
});

describe('building only when the image is what is missing', () => {
  type Answer = { ok: true } | { ok: false; reason: string; missing: 'daemon' | 'image' };
  const probing = (answer: Answer) => ({ probe: async () => answer });

  it('does nothing at all when the image is already there', async () => {
    const lines: string[] = [];
    const result = await ensureAgentImage(probing({ ok: true }), (l) => lines.push(l));
    expect(result).toBe('present');
    expect(lines).toEqual([]); // an ordinary start says nothing and costs one inspect
  });

  // A MISSING DAEMON IS NOT A MISSING IMAGE, and `probe` names which precisely so this can tell them
  // apart. Building against a daemon that is not running spends a failed multi-minute build to discover
  // what the probe already said.
  it('does not try to build when docker itself is not there', async () => {
    const lines: string[] = [];
    const result = await ensureAgentImage(
      probing({ ok: false, reason: 'Docker is not available — no daemon', missing: 'daemon' }),
      (l) => lines.push(l),
    );
    expect(result).toBe('no-docker');
    expect(lines).toEqual([]);
  });
});
