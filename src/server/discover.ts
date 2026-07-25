import { readdir } from 'node:fs/promises';
import { existsSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR, CONFIG_FILE, readConfig } from '../core/config.js';

export interface ProjectRef {
  path: string;
  name: string;
}

// Shallow-scan a root directory for VibeBoard projects: immediate subdirectories that
// contain a .vibeboard/config.yaml. Non-recursive; skips dotdirs and node_modules.
export async function discoverProjects(root: string): Promise<ProjectRef[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const refs: ProjectRef[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const dir = join(root, entry.name);
    if (!existsSync(join(dir, CONFIG_DIR, CONFIG_FILE))) continue;
    try {
      const config = await readConfig(dir);
      refs.push({ path: dir, name: config.name });
    } catch {
      /* unreadable config — not a usable project, skip */
    }
  }
  refs.sort((a, b) => a.name.localeCompare(b.name));
  return refs;
}
