import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { CONFIG_DIR } from '../src/core/layout.js';
import type { CopilotConfig, ProjectConfig } from '../src/core/types.js';
import {
  DEFAULT_CONTEXT_BUDGET,
  DEFAULT_MAX_RUNS,
  defaultConfig,
  ensureAutopilotKeys,
  ensureBoards,
  ensureContextBudget,
  ensureCopilotDefaults,
  ensureMaxRuns,
  readConfig,
  writeConfig,
} from '../src/store/project/config.js';
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

describe('ensureMaxRuns', () => {
  it('leaves a positive cap alone', () => {
    const config = { ...defaultConfig('T'), maxConcurrentRuns: 8 };
    expect(ensureMaxRuns(config)).toBe(false);
    expect(config.maxConcurrentRuns).toBe(8);
  });

  // Zero and negatives would mean "never run anything", which nobody means by a cap. A quoted
  // number is the case the typeof half guards: YAML yields '2' happily, and `>= '2'` compares as
  // a string.
  it.each([0, -1, undefined, 'three' as unknown as number, '2' as unknown as number])(
    'replaces %p with the default',
    (value) => {
      const config = { ...defaultConfig('T'), maxConcurrentRuns: value as number };
      expect(ensureMaxRuns(config)).toBe(true);
      expect(config.maxConcurrentRuns).toBe(DEFAULT_MAX_RUNS);
    },
  );

  it('is what a project written before runs existed gets', () => {
    const old = { ...defaultConfig('T') } as Record<string, unknown>;
    delete old.maxConcurrentRuns;
    const config = old as unknown as Parameters<typeof ensureMaxRuns>[0];
    expect(ensureMaxRuns(config)).toBe(true);
    expect(config.maxConcurrentRuns).toBe(DEFAULT_MAX_RUNS);
  });
});

describe('ensureBoards', () => {
  // Spelled out rather than derived: these literals ARE the defaults under test. Engineering must
  // open with a Backlog — it was the one board without one, so an agent asked to break a card down
  // "into the right column" reached for `backlog`, created the folder, and wrote four cards where
  // the board does not read.
  it('reports no change when every board is present', () => {
    const config = defaultConfig('T');
    expect(ensureBoards(config)).toBe(false);
    expect(config.boards.engineering.columns).toEqual([
      'Backlog',
      'In Progress',
      'Review',
      'Blocked',
      'Done',
    ]);
  });

  it('backfills a board missing from an older config with its own default columns', () => {
    const config = defaultConfig('T');
    config.boards.features.columns = ['Kept'];
    delete (config.boards as Partial<ProjectConfig['boards']>).engineering;

    expect(ensureBoards(config)).toBe(true);
    // Engineering's defaults differ from the other two boards — a shared list would be wrong.
    expect(config.boards.engineering.columns).toEqual([
      'Backlog',
      'In Progress',
      'Review',
      'Blocked',
      'Done',
    ]);
    expect(config.boards.features.columns).toEqual(['Kept']);
  });
});

// A project written before a key existed. Slice C1 added a key to the autopilot block, and
// without this backfill EVERY previously-valid config became invalid — so the Settings modal, which
// always sends `boards`, could no longer save any setting at all. That is the class the 2026-08-03 fix
// addressed for a different key ("the refusal spoke about columns while the user was changing their
// model"), reintroduced through a new one.
describe('ensureAutopilotKeys', () => {
  it('fills a key the project predates, and says it changed something', () => {
    const config = defaultConfig('T');
    const ap = config.autopilot as unknown as Record<string, unknown>;
    delete ap.blockedColumn;
    expect(ensureAutopilotKeys(config)).toBe(true);
    expect(config.autopilot?.blockedColumn).toBe(DEFAULT_AUTOPILOT.blockedColumn);
  });

  it('is a no-op on a config that already has every key', () => {
    const config = defaultConfig('T');
    expect(ensureAutopilotKeys(config)).toBe(false);
  });

  // A project with no block stays without one. The spec's position is deliberate: auto-pilot refuses
  // to start there and says what is missing, rather than a half-upgrade nobody asked for.
  it('does not give a lifecycle to a project that has none', () => {
    const config = defaultConfig('T');
    config.autopilot = undefined;
    expect(ensureAutopilotKeys(config)).toBe(false);
    expect(config.autopilot).toBeUndefined();
  });

  // ABSENCE gets a default; a value that is present and wrong is left for the validator to refuse.
  // Backfilling over it would silently overwrite a hand-edit with our own number.
  it('leaves a key that is present and invalid alone, for the validator to name', () => {
    const config = defaultConfig('T');
    (config.autopilot as unknown as Record<string, unknown>).attemptCap = -5;
    expect(ensureAutopilotKeys(config)).toBe(false);
    expect(config.autopilot?.attemptCap).toBe(-5);
  });

  // Generalised on purpose: C2, C3 and C4 each add keys, and this is what stops each of them breaking
  // Settings for every project created before it.
  it('fills any missing key, not just the newest one', () => {
    const config = defaultConfig('T');
    const ap = config.autopilot as unknown as Record<string, unknown>;
    delete ap.attemptCap;
    delete ap.terminal;
    expect(ensureAutopilotKeys(config)).toBe(true);
    expect(config.autopilot?.attemptCap).toBe(DEFAULT_AUTOPILOT.attemptCap);
    expect(config.autopilot?.terminal).toEqual(DEFAULT_AUTOPILOT.terminal);
  });

  // A clone, like `defaultConfig` takes: a shared reference would let one project's edit reach the
  // next project's defaults inside the same process.
  it('gives each project its own copy of a filled list', () => {
    const config = defaultConfig('T');
    delete (config.autopilot as unknown as Record<string, unknown>).terminal;
    ensureAutopilotKeys(config);
    config.autopilot?.terminal.engineering.push('shipped');
    expect(DEFAULT_AUTOPILOT.terminal.engineering).toEqual(['done']);
  });
});
