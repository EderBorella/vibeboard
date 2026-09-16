import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { BOX_BROWSERS_PATH, BOX_PLAYWRIGHT_VERSION } from '../src/server/boxes/image-tools.js';

// A CONSTANT DESCRIBING ANOTHER FILE'S CONTENTS IS ONLY SAFE WHILE SOMETHING COMPARES THEM.
//
// `image-tools.ts` tells every agent that a Chromium for a named Playwright version is already installed
// at a named path. Both facts belong to `tools/docker/Dockerfile.agent`, and neither is reachable at
// runtime — so a bump there would leave the prompt confidently telling agents a version the image no
// longer ships, which is worse than the silence it replaced: it is the same wrong belief that made a run
// download 656MB it already had, arrived at from the other direction.
const DOCKERFILE = new URL('../tools/docker/Dockerfile.agent', import.meta.url);

describe('what the prompt tells agents the box has', () => {
  it('names the browser path the image actually sets', async () => {
    const text = await readFile(DOCKERFILE, 'utf8');
    const line = /^ENV PLAYWRIGHT_BROWSERS_PATH=(.+)$/m.exec(text);
    // A FLOOR ON THE READ, because the failure mode of a file-parsing assertion is a regex that stops
    // matching: a check that found no line would otherwise agree with every claim made about it.
    expect(line, 'Dockerfile.agent no longer sets PLAYWRIGHT_BROWSERS_PATH').not.toBeNull();
    expect(line?.[1]?.trim()).toBe(BOX_BROWSERS_PATH);
  });

  it('names the Playwright version the image pins', async () => {
    const text = await readFile(DOCKERFILE, 'utf8');
    const line = /^ARG PLAYWRIGHT_VERSION=(.+)$/m.exec(text);
    expect(line, 'Dockerfile.agent no longer pins PLAYWRIGHT_VERSION').not.toBeNull();
    expect(line?.[1]?.trim()).toBe(BOX_PLAYWRIGHT_VERSION);
  });
});
