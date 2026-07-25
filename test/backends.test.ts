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
  it('ships a concrete model and effort for every backend', () => {
    const { copilot, contextBudget } = defaultConfig('T');
    expect(copilot.backend).toBe(DEFAULT_BACKEND);
    expect(copilot.backends['claude-code']).toEqual({ model: 'opus', effort: 'high' });
    expect(copilot.backends.opencode).toEqual({ model: 'opencode/deepseek-v4-flash-free', effort: 'high' });
    // Legacy single-slot fields are never written by a fresh config.
    expect(copilot.model).toBeUndefined();
    expect(copilot.effort).toBeUndefined();
    expect(contextBudget).toBe(200_000);
  });
});

describe('ensureCopilotDefaults', () => {
  const cfg = (copilot: unknown): ProjectConfig => ({ ...defaultConfig('T'), copilot } as ProjectConfig);

  it('seeds a slot for every known backend', () => {
    const config = cfg({ backend: 'claude-code' });
    expect(ensureCopilotDefaults(config)).toBe(true);
    expect(config.copilot.backends['claude-code']).toEqual({ model: 'opus', effort: 'high' });
    expect(config.copilot.backends.opencode).toEqual({ model: 'opencode/deepseek-v4-flash-free', effort: 'high' });
  });

  // Migration: the pre-per-backend shape carried one pair, describing whichever backend was
  // selected. It must land in THAT backend's slot — attributing it to the other one would hand
  // a Claude alias to OpenCode.
  it('migrates a legacy single slot into the selected backend and drops the old keys', () => {
    const config = cfg({ backend: 'claude-code', model: 'haiku', effort: 'max' });
    expect(ensureCopilotDefaults(config)).toBe(true);
    expect(config.copilot.backends['claude-code']).toEqual({ model: 'haiku', effort: 'max' });
    // The other backend gets its own default, not the migrated pair.
    expect(config.copilot.backends.opencode.model).toBe('opencode/deepseek-v4-flash-free');
    expect(config.copilot.model).toBeUndefined();
    expect(config.copilot.effort).toBeUndefined();
  });

  it('migrates a legacy opencode config into the opencode slot', () => {
    const config = cfg({ backend: 'opencode', model: 'opencode/big-pickle', effort: 'low' });
    ensureCopilotDefaults(config);
    expect(config.copilot.backends.opencode).toEqual({ model: 'opencode/big-pickle', effort: 'low' });
    expect(config.copilot.backends['claude-code'].model).toBe('opus');
  });

  it('treats an empty string as unset', () => {
    const config = cfg({ backend: 'claude-code', backends: { 'claude-code': { model: '', effort: '' } } });
    expect(ensureCopilotDefaults(config)).toBe(true);
    expect(config.copilot.backends['claude-code']).toEqual({ model: 'opus', effort: 'high' });
  });

  it('leaves a fully populated config alone and reports no change', () => {
    const config = cfg({
      backend: 'claude-code',
      backends: {
        'claude-code': { model: 'sonnet', effort: 'low' },
        opencode: { model: 'opencode/big-pickle', effort: 'max' },
      },
    });
    expect(ensureCopilotDefaults(config)).toBe(false);
    expect(config.copilot.backends['claude-code']).toEqual({ model: 'sonnet', effort: 'low' });
  });

  it('survives a config with no copilot block at all', () => {
    const config = cfg(undefined);
    expect(ensureCopilotDefaults(config)).toBe(true);
    expect(config.copilot.backend).toBe(DEFAULT_BACKEND);
    expect(config.copilot.backends[DEFAULT_BACKEND].model).toBeTruthy();
  });

  it('backfills a missing or nonsensical context budget', () => {
    const missing = { ...defaultConfig('T') } as ProjectConfig;
    delete (missing as { contextBudget?: number }).contextBudget;
    expect(ensureCopilotDefaults(missing)).toBe(true);
    expect(missing.contextBudget).toBe(200_000);

    const zero = { ...defaultConfig('T'), contextBudget: 0 } as ProjectConfig;
    expect(ensureCopilotDefaults(zero)).toBe(true);
    expect(zero.contextBudget).toBe(200_000);
  });

  it('keeps a deliberate context budget', () => {
    const config = { ...defaultConfig('T'), contextBudget: 1_000_000 } as ProjectConfig;
    expect(ensureCopilotDefaults(config)).toBe(false);
    expect(config.contextBudget).toBe(1_000_000);
  });
});

describe('opening a project', () => {
  it('scaffolds per-backend slots on disk', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Fresh', mode: 'greenfield', today: TODAY });
    const onDisk = parse(await readFile(configPath(root), 'utf8')) as ProjectConfig;
    expect(onDisk.copilot.backends['claude-code']).toEqual({ model: 'opus', effort: 'high' });
    expect(onDisk.contextBudget).toBe(200_000);
  });

  it('migrates a legacy config on open and persists it', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Old', mode: 'greenfield', today: TODAY });
    // Rewind to the pre-per-backend shape: one pair, no slots.
    const stale = parse(await readFile(configPath(root), 'utf8')) as ProjectConfig;
    stale.copilot = { backend: 'opencode', model: 'opencode/big-pickle', effort: 'low' } as ProjectConfig['copilot'];
    await writeConfig(root, stale);

    const session = new ProjectSession();
    try {
      const snapshot = await session.open(root);
      expect(snapshot.config.copilot.backends.opencode).toEqual({ model: 'opencode/big-pickle', effort: 'low' });
      expect(snapshot.config.copilot.model).toBeUndefined();
      // Written through, so the next reader sees it too.
      const onDisk = parse(await readFile(configPath(root), 'utf8')) as ProjectConfig;
      expect(onDisk.copilot.backends.opencode.model).toBe('opencode/big-pickle');
      expect(onDisk.copilot.backends['claude-code'].model).toBe('opus');
    } finally {
      await session.close();
    }
  });
});
