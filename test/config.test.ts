import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONFIG_DIR,
  DEFAULT_CONTEXT_BUDGET,
  defaultConfig,
  ensureBoards,
  ensureContextBudget,
  ensureCopilotDefaults,
  readConfig,
  writeConfig,
} from '../src/core/config.js';
import type { CopilotConfig, ProjectConfig } from '../src/core/types.js';
import { tempDir } from './helpers.js';

// Both slots already populated, so seedBackendSlots reports no change. That isolation is what
// makes the return value meaningful: it proves which step decided the config must be persisted.
const FULL_SLOTS = (): CopilotConfig['backends'] => ({
  'claude-code': { model: 'opus', effort: 'high' },
  opencode: { model: 'opencode/deepseek-v4-flash-free', effort: 'high' },
});

const withCopilot = (copilot: Partial<CopilotConfig>): ProjectConfig =>
  ({ ...defaultConfig('T'), copilot }) as ProjectConfig;

describe('config', () => {
  it('defaultConfig has both boards and sane defaults', () => {
    const c = defaultConfig('Demo');
    expect(c.name).toBe('Demo');
    expect(c.boards.product.columns).toContain('In Progress');
    expect(c.boards.engineering.columns).toContain('Review');
    expect(c.idPadding).toBe(3);
    expect(c.copilot.backend).toBe('claude-code');
  });

  it('round-trips through write then read', async () => {
    const root = await tempDir();
    await mkdir(join(root, CONFIG_DIR), { recursive: true });
    const c = defaultConfig('Round Trip');
    await writeConfig(root, c);
    const back = await readConfig(root);
    expect(back).toEqual(c);
  });
});

describe('ensureCopilotDefaults', () => {
  it('reports no change for a config that is already current', () => {
    const config = withCopilot({ backend: 'claude-code', backends: FULL_SLOTS() });
    expect(ensureCopilotDefaults(config)).toBe(false);
  });

  it('builds the whole block when copilot is absent', () => {
    const config = defaultConfig('T');
    delete (config as Partial<ProjectConfig>).copilot;
    expect(ensureCopilotDefaults(config)).toBe(true);
    expect(config.copilot.backend).toBe('claude-code');
    expect(config.copilot.backends).toEqual(FULL_SLOTS());
  });

  it('fills a missing backend without disturbing populated slots', () => {
    const config = withCopilot({ backends: FULL_SLOTS() });
    expect(ensureCopilotDefaults(config)).toBe(true);
    expect(config.copilot.backend).toBe('claude-code');
    expect(config.copilot.backends).toEqual(FULL_SLOTS());
  });

  it('adds a slot for a backend the config has never selected', () => {
    const config = withCopilot({
      backend: 'claude-code',
      backends: { 'claude-code': { model: 'opus', effort: 'high' } },
    });
    expect(ensureCopilotDefaults(config)).toBe(true);
    expect(config.copilot.backends.opencode).toEqual({
      model: 'opencode/deepseek-v4-flash-free',
      effort: 'high',
    });
  });

  it('seeds only the blank field of a half-filled slot', () => {
    const noModel = withCopilot({
      backend: 'claude-code',
      backends: { ...FULL_SLOTS(), 'claude-code': { model: '', effort: 'low' } },
    });
    expect(ensureCopilotDefaults(noModel)).toBe(true);
    expect(noModel.copilot.backends['claude-code']).toEqual({ model: 'opus', effort: 'low' });

    const noEffort = withCopilot({
      backend: 'claude-code',
      backends: { ...FULL_SLOTS(), 'claude-code': { model: 'sonnet', effort: '' } },
    });
    expect(ensureCopilotDefaults(noEffort)).toBe(true);
    expect(noEffort.copilot.backends['claude-code']).toEqual({ model: 'sonnet', effort: 'high' });
  });

  it('moves a legacy model/effort pair into the selected backend own slot', () => {
    const config = withCopilot({
      backend: 'opencode',
      backends: { ...FULL_SLOTS(), opencode: { model: '', effort: '' } },
      model: 'legacy-model',
      effort: 'max',
    });
    expect(ensureCopilotDefaults(config)).toBe(true);
    expect(config.copilot.backends.opencode).toEqual({ model: 'legacy-model', effort: 'max' });
    expect(config.copilot.model).toBeUndefined();
    expect(config.copilot.effort).toBeUndefined();
  });

  it('migrates a legacy model even when no legacy effort was written', () => {
    const config = withCopilot({
      backend: 'claude-code',
      backends: { ...FULL_SLOTS(), 'claude-code': { model: '', effort: 'high' } },
      model: 'sonnet',
    });
    expect(ensureCopilotDefaults(config)).toBe(true);
    expect(config.copilot.backends['claude-code'].model).toBe('sonnet');
  });

  it('never lets a legacy value overwrite a slot that already holds one', () => {
    const config = withCopilot({
      backend: 'claude-code',
      backends: { ...FULL_SLOTS(), 'claude-code': { model: 'sonnet', effort: 'low' } },
      model: 'haiku',
      effort: 'max',
    });
    // Only the legacy migration changes anything here, so `true` can come from nothing else.
    expect(ensureCopilotDefaults(config)).toBe(true);
    expect(config.copilot.backends['claude-code']).toEqual({ model: 'sonnet', effort: 'low' });
    expect(config.copilot.model).toBeUndefined();
  });

  it('creates the slot the legacy pair belongs to when it is missing entirely', () => {
    const config = withCopilot({
      backend: 'opencode',
      backends: { 'claude-code': { model: 'opus', effort: 'high' } },
      model: 'legacy-model',
      effort: 'max',
    });
    expect(ensureCopilotDefaults(config)).toBe(true);
    expect(config.copilot.backends.opencode).toEqual({ model: 'legacy-model', effort: 'max' });
  });
});

describe('ensureContextBudget', () => {
  it('leaves a positive number alone', () => {
    const config = { ...defaultConfig('T'), contextBudget: 1_000_000 };
    expect(ensureContextBudget(config)).toBe(false);
    expect(config.contextBudget).toBe(1_000_000);
  });

  // '5' is the case the `typeof` half of the guard exists for: YAML quite happily yields a string
  // that compares as > 0, so a bare positivity check would keep it and every arithmetic on the
  // context bar would then concatenate instead of add.
  it.each([0, -1, undefined, 'lots' as unknown as number, '5' as unknown as number])(
    'replaces %p with the default',
    (value) => {
      const config = { ...defaultConfig('T'), contextBudget: value as number };
      expect(ensureContextBudget(config)).toBe(true);
      expect(config.contextBudget).toBe(DEFAULT_CONTEXT_BUDGET);
    },
  );
});

describe('ensureBoards', () => {
  it('reports no change when every board is present', () => {
    const config = defaultConfig('T');
    expect(ensureBoards(config)).toBe(false);
    expect(config.boards.engineering.columns).toEqual(['Todo', 'In Progress', 'Review', 'Done']);
  });

  it('backfills a board missing from an older config with its own default columns', () => {
    const config = defaultConfig('T');
    config.boards.features.columns = ['Kept'];
    delete (config.boards as Partial<ProjectConfig['boards']>).engineering;

    expect(ensureBoards(config)).toBe(true);
    // Engineering's defaults differ from the other two boards — a shared list would be wrong.
    expect(config.boards.engineering.columns).toEqual(['Todo', 'In Progress', 'Review', 'Done']);
    expect(config.boards.features.columns).toEqual(['Kept']);
  });
});
