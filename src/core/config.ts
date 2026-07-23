import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { ProjectConfig } from './types.js';

export const CONFIG_DIR = '.vibeboard';
export const CONFIG_FILE = 'config.yaml';

export function configPath(projectRoot: string): string {
  return join(projectRoot, CONFIG_DIR, CONFIG_FILE);
}

export function defaultConfig(name: string): ProjectConfig {
  return {
    name,
    boards: {
      product: { columns: ['Backlog', 'Todo', 'In Progress', 'Done'] },
      engineering: { columns: ['Todo', 'In Progress', 'Review', 'Done'] },
    },
    miniatureChars: 140,
    idPadding: 3,
    copilot: { backend: 'claude-code' },
  };
}

export async function readConfig(projectRoot: string): Promise<ProjectConfig> {
  const raw = await readFile(configPath(projectRoot), 'utf8');
  return parse(raw) as ProjectConfig;
}

export async function writeConfig(projectRoot: string, config: ProjectConfig): Promise<void> {
  await writeFile(configPath(projectRoot), stringify(config), 'utf8');
}
