import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { DEFAULT_AUTOPILOT } from '../../core/autopilot.js';
import { BACKEND_DEFAULTS, DEFAULT_BACKEND, defaultBackendMap } from '../../core/backends.js';
import { CONFIG_DIR, CONFIG_FILE } from '../../core/layout.js';
import {
  BOARDS,
  type BoardConfig,
  type BoardName,
  type CopilotConfig,
  type ProjectConfig,
} from '../../core/types.js';

// Tokens the copilot context bar treats as full. Per-project rather than hardcoded: context
// windows differ by an order of magnitude between models, so one baked-in number is wrong for
// most of them (200k over-reported occupancy 5× on a 1M-context model).
export const DEFAULT_CONTEXT_BUDGET = 200_000;

// Runs in flight at once. Three is enough to keep a board moving without turning a laptop into a
// space heater or racing several agents over the same files.
export const DEFAULT_MAX_RUNS = 3;

// Default columns per board. Features (highest level) mirrors Product for familiarity.
// Every board opens with a Backlog. Engineering used to start at Todo, which made it the one board
// an agent could not guess: asked to break a card down "into the right column" it reached for
// Backlog, found none, and created the folder — putting four cards somewhere the board does not read.
// Blocked is on PRODUCT AND ENGINEERING, and features has none. A card that has exhausted its attempts
// lands there instead of stopping the whole board, which is only honest where the card has siblings to
// carry on with: a story sits among siblings exactly as a task does, while a feature is the top of its own
// vertical (decision 45, corrected 2026-08-13, after one redundant story stopped a project with three
// features queued behind it).
//
// It is NOT last on either board: the closing column is defined as the final one (boards/move.ts
// isClosingColumn), so appending Blocked would make blocking a card resolve its runs and leave Done
// closing nothing.
const DEFAULT_COLUMNS: Record<BoardName, string[]> = {
  features: ['Backlog', 'Todo', 'In Progress', 'Done'],
  product: ['Backlog', 'Todo', 'In Progress', 'Blocked', 'Done'],
  engineering: ['Backlog', 'In Progress', 'Review', 'Blocked', 'Done'],
};

export function configPath(projectRoot: string): string {
  return join(projectRoot, CONFIG_DIR, CONFIG_FILE);
}

export function defaultConfig(name: string): ProjectConfig {
  const boards = {} as Record<BoardName, BoardConfig>;
  for (const board of BOARDS) boards[board] = { columns: [...DEFAULT_COLUMNS[board]] };
  return {
    name,
    boards,
    miniatureChars: 140,
    idPadding: 3,
    keepChats: 20,
    contextBudget: DEFAULT_CONTEXT_BUDGET,
    maxConcurrentRuns: DEFAULT_MAX_RUNS,
    // A clone, not the constant: config objects are mutated in place by the ensure* helpers and
    // written back, so a shared reference would let one project's edit reach the next project's
    // defaults inside the same process.
    autopilot: structuredClone(DEFAULT_AUTOPILOT),
    // Explicitly web, so a project created before the wizard exists keeps the one behaviour every
    // project had until now — a checkup that can open a page. Old projects get NO backfill: absence
    // reads as the default image (containers.ts imageForKind), which is what they always ran on.
    box: { kind: 'web' },
    copilot: { backend: DEFAULT_BACKEND, backends: defaultBackendMap() },
  };
}

// The old `model`/`effort` pair described whichever backend was selected when it was written, so
// it becomes that backend's slot and the legacy keys go.
function migrateLegacySlot(copilot: CopilotConfig): boolean {
  if (!copilot.model && !copilot.effort) return false;
  copilot.backends[copilot.backend] ??= { model: '', effort: '' };
  const slot = copilot.backends[copilot.backend];
  if (!slot.model && copilot.model) slot.model = copilot.model;
  if (!slot.effort && copilot.effort) slot.effort = copilot.effort;
  delete copilot.model;
  delete copilot.effort;
  return true;
}

// A missing or blank slot for a known backend gets its built-in default; a blank used to mean
// "let the CLI pick", which hid the model actually in use.
function seedBackendSlots(copilot: CopilotConfig): boolean {
  let changed = false;
  for (const [name, defaults] of Object.entries(BACKEND_DEFAULTS)) {
    const slot = copilot.backends[name];
    if (!slot) {
      copilot.backends[name] = { ...defaults };
      changed = true;
      continue;
    }
    if (!slot.model) {
      slot.model = defaults.model;
      changed = true;
    }
    if (!slot.effort) {
      slot.effort = defaults.effort;
      changed = true;
    }
  }
  return changed;
}

// Bring an older config's copilot block up to date, returning whether anything changed so callers
// persist only when needed. Without the legacy migration, switching connector discarded the model
// chosen for the other one.
export function ensureCopilotDefaults(config: ProjectConfig): boolean {
  if (!config.copilot) config.copilot = { backend: DEFAULT_BACKEND, backends: {} };
  const copilot = config.copilot;
  let changed = false;
  if (!copilot.backend) {
    copilot.backend = DEFAULT_BACKEND;
    changed = true;
  }
  if (!copilot.backends) {
    copilot.backends = {};
    changed = true;
  }
  return [changed, migrateLegacySlot(copilot), seedBackendSlots(copilot)].some(Boolean);
}

// Not a copilot concern, so not inside ensureCopilotDefaults despite arriving with it.
export function ensureContextBudget(config: ProjectConfig): boolean {
  if (typeof config.contextBudget === 'number' && config.contextBudget > 0) return false;
  config.contextBudget = DEFAULT_CONTEXT_BUDGET;
  return true;
}

// Backfill for projects written before runs existed. A zero or negative cap would mean "never run
// anything", which is never what anyone meant by it.
export function ensureMaxRuns(config: ProjectConfig): boolean {
  if (typeof config.maxConcurrentRuns === 'number' && config.maxConcurrentRuns > 0) return false;
  config.maxConcurrentRuns = DEFAULT_MAX_RUNS;
  return true;
}

// Backfill any key an existing autopilot block is missing, because the project was created before that
// key existed. Slice C1 added `criticThreshold` and thereby made every previously-valid config INVALID:
// the Settings modal always sends `boards`, the cover check runs whenever it does, and so a project that
// predated the key could no longer save any setting at all — the refusal talking about the lifecycle
// while the user was changing something else. That class was fixed once already, on 2026-08-03, for a
// different key; generalised here so C2, C3 and C4 cannot each reintroduce it.
//
// ABSENCE only. A key that is present and invalid is left exactly as it is, for the validator to name:
// backfilling over it would silently replace somebody's hand-edit with our own number.
//
// A project with NO block stays without one. That refusal is deliberate — auto-pilot will not start
// there and says what is missing, rather than a half-upgrade nobody asked for.
export function ensureAutopilotKeys(config: ProjectConfig): boolean {
  const ap = config.autopilot;
  if (!ap) return false;
  const block = ap as unknown as Record<string, unknown>;
  let changed = false;
  for (const [key, value] of Object.entries(DEFAULT_AUTOPILOT)) {
    if (block[key] !== undefined) continue;
    // A clone, like defaultConfig takes: `terminal` is mutated in place by the column helpers, so a
    // shared reference would let one project's edit reach the next project's defaults inside the same
    // process.
    block[key] = structuredClone(value);
    changed = true;
  }
  return changed;
}

// Backfill any board missing from an older project's config with its default columns.
// Returns whether anything changed, so callers can persist only when needed.
export function ensureBoards(config: ProjectConfig): boolean {
  let changed = false;
  for (const board of BOARDS) {
    if (!config.boards[board]) {
      config.boards[board] = { columns: [...DEFAULT_COLUMNS[board]] };
      changed = true;
    }
  }
  return changed;
}

export async function readConfig(projectRoot: string): Promise<ProjectConfig> {
  const raw = await readFile(configPath(projectRoot), 'utf8');
  return parse(raw) as ProjectConfig;
}

export async function writeConfig(projectRoot: string, config: ProjectConfig): Promise<void> {
  await writeFile(configPath(projectRoot), stringify(config), 'utf8');
}
