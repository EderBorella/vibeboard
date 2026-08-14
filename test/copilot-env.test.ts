import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeConfigDir, isolationEnabled, opencodeConfigHome } from '../src/server/boxes/copilot-env.js';
import { tempDir } from './helpers.js';

const savedIsolate = process.env.VIBEBOARD_COPILOT_ISOLATE;
const savedHome = process.env.VIBEBOARD_COPILOT_HOME;

afterEach(() => {
  if (savedIsolate === undefined) delete process.env.VIBEBOARD_COPILOT_ISOLATE;
  else process.env.VIBEBOARD_COPILOT_ISOLATE = savedIsolate;
  if (savedHome === undefined) delete process.env.VIBEBOARD_COPILOT_HOME;
  else process.env.VIBEBOARD_COPILOT_HOME = savedHome;
});

describe('isolationEnabled', () => {
  it('defaults on, off only when explicitly "0"', () => {
    delete process.env.VIBEBOARD_COPILOT_ISOLATE;
    expect(isolationEnabled()).toBe(true);
    process.env.VIBEBOARD_COPILOT_ISOLATE = '0';
    expect(isolationEnabled()).toBe(false);
    process.env.VIBEBOARD_COPILOT_ISOLATE = '1';
    expect(isolationEnabled()).toBe(true);
  });
});

describe('config dirs', () => {
  it('creates the clean dirs under VIBEBOARD_COPILOT_HOME', async () => {
    const home = await tempDir();
    process.env.VIBEBOARD_COPILOT_HOME = home;
    const claude = claudeConfigDir();
    const oc = opencodeConfigHome();
    expect(claude).toBe(join(home, 'claude'));
    expect(oc).toBe(join(home, 'opencode-xdg'));
    expect(existsSync(claude)).toBe(true);
    expect(existsSync(oc)).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });
});
