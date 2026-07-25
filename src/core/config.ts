import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { BOARDS, type BoardName, type BoardConfig, type ProjectConfig } from './types.js';
import { DEFAULT_BACKEND, backendDefaults } from './backends.js';

export const CONFIG_DIR = '.vibeboard';
export const CONFIG_FILE = 'config.yaml';

// Default columns per board. Features (highest level) mirrors Product for familiarity.
const DEFAULT_COLUMNS: Record<BoardName, string[]> = {
  features: ['Backlog', 'Todo', 'In Progress', 'Done'],
  product: ['Backlog', 'Todo', 'In Progress', 'Done'],
  engineering: ['Todo', 'In Progress', 'Review', 'Done'],
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
    copilot: { backend: DEFAULT_BACKEND, ...backendDefaults(DEFAULT_BACKEND) },
  };
}

// Backfill a copilot model/effort for projects configured before those had real defaults.
// A blank model used to mean "whatever the CLI picks", which hid the model actually in use.
// Returns whether anything changed, so callers persist only when needed.
export function ensureCopilotDefaults(config: ProjectConfig): boolean {
  if (!config.copilot) config.copilot = { backend: DEFAULT_BACKEND };
  const copilot = config.copilot;
  let changed = false;
  if (!copilot.backend) { copilot.backend = DEFAULT_BACKEND; changed = true; }
  const defaults = backendDefaults(copilot.backend);
  if (!copilot.model) { copilot.model = defaults.model; changed = true; }
  if (!copilot.effort) { copilot.effort = defaults.effort; changed = true; }
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
