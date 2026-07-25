import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { tempDir } from './helpers.js';
import { BACKEND_DEFAULTS, DEFAULT_BACKEND, backendDefaults } from '../src/core/backends.js';
import { defaultConfig, ensureCopilotDefaults, configPath, writeConfig } from '../src/core/config.js';
import { scaffoldProject } from '../src/core/scaffold.js';
import { ProjectSession } from '../src/server/session.js';
import type { ProjectConfig } from '../src/core/types.js';

const TODAY = '2026-07-23';

describe('backend defaults', () => {
  it('names a real model and effort for every backend — never blank', () => {
    for (const [backend, d] of Object.entries(BACKEND_DEFAULTS)) {
      expect(d.model, `${backend} model`).toBeTruthy();
      expect(d.effort, `${backend} effort`).toBeTruthy();
    }
  });

  it('uses opus at high effort for Claude Code', () => {
    expect(backendDefaults('claude-code')).toEqual({ model: 'opus', effort: 'high' });
  });

  it('uses a free tool-capable model at high variant for OpenCode', () => {
    const d = backendDefaults('opencode');
    expect(d.model).toBe('opencode/deepseek-v4-flash-free');
    expect(d.effort).toBe('high');
  });

  it('falls back to the default backend for an unknown or missing one', () => {
    expect(backendDefaults('nonsense')).toEqual(BACKEND_DEFAULTS[DEFAULT_BACKEND]);
    expect(backendDefaults(undefined)).toEqual(BACKEND_DEFAULTS[DEFAULT_BACKEND]);
  });
});

describe('defaultConfig', () => {
  it('ships a concrete copilot model and effort', () => {
    const { copilot } = defaultConfig('T');
    expect(copilot.backend).toBe(DEFAULT_BACKEND);
    expect(copilot.model).toBe('opus');
    expect(copilot.effort).toBe('high');
  });
});

describe('ensureCopilotDefaults', () => {
  const cfg = (copilot: unknown): ProjectConfig => ({ ...defaultConfig('T'), copilot } as ProjectConfig);

  it('backfills a config written when the model could be blank', () => {
    const config = cfg({ backend: 'claude-code' });
    expect(ensureCopilotDefaults(config)).toBe(true);
    expect(config.copilot).toEqual({ backend: 'claude-code', model: 'opus', effort: 'high' });
  });

  it('backfills per backend, not with the Claude values', () => {
    const config = cfg({ backend: 'opencode' });
    ensureCopilotDefaults(config);
    expect(config.copilot.model).toBe('opencode/deepseek-v4-flash-free');
  });

  it('treats an empty string as unset', () => {
    const config = cfg({ backend: 'claude-code', model: '', effort: '' });
    expect(ensureCopilotDefaults(config)).toBe(true);
    expect(config.copilot.model).toBe('opus');
  });

  it('leaves a deliberate choice alone and reports no change', () => {
    const config = cfg({ backend: 'claude-code', model: 'sonnet', effort: 'low' });
    expect(ensureCopilotDefaults(config)).toBe(false);
    expect(config.copilot).toEqual({ backend: 'claude-code', model: 'sonnet', effort: 'low' });
  });

  it('survives a config with no copilot block at all', () => {
    const config = cfg(undefined);
    expect(ensureCopilotDefaults(config)).toBe(true);
    expect(config.copilot.backend).toBe(DEFAULT_BACKEND);
    expect(config.copilot.model).toBeTruthy();
  });
});

describe('opening a project', () => {
  it('scaffolds a config with real copilot defaults on disk', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Fresh', mode: 'greenfield', today: TODAY });
    const onDisk = parse(await readFile(configPath(root), 'utf8')) as ProjectConfig;
    expect(onDisk.copilot.model).toBe('opus');
    expect(onDisk.copilot.effort).toBe('high');
  });

  it('upgrades an older project and persists the backfill', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Old', mode: 'greenfield', today: TODAY });
    // Rewind to a pre-defaults config: backend only.
    const stale = parse(await readFile(configPath(root), 'utf8')) as ProjectConfig;
    stale.copilot = { backend: 'opencode' };
    await writeConfig(root, stale);

    const session = new ProjectSession();
    try {
      const snapshot = await session.open(root);
      expect(snapshot.config.copilot.model).toBe('opencode/deepseek-v4-flash-free');
      expect(snapshot.config.copilot.effort).toBe('high');
      // Written through, so the next reader sees it too.
      const onDisk = parse(await readFile(configPath(root), 'utf8')) as ProjectConfig;
      expect(onDisk.copilot.model).toBe('opencode/deepseek-v4-flash-free');
    } finally {
      await session.close();
    }
  });
});
