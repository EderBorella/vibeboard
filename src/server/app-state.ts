import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readConfig } from '../core/config.js';
import type { ProjectSession } from './session.js';

// App-level state, outside any project: what VibeBoard should reopen on start. Without this the
// open project lives only in memory, so every restart drops you back to the project gate — and
// any client mid-session starts erroring until you pick a project again.

interface AppState {
  lastProject?: string;
}

export function stateFile(): string {
  return process.env.VIBEBOARD_STATE_FILE ?? join(homedir(), '.vibeboard', 'state.json');
}

export async function readState(): Promise<AppState> {
  try {
    const parsed = JSON.parse(await readFile(stateFile(), 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const { lastProject } = parsed as AppState;
    return typeof lastProject === 'string' ? { lastProject } : {};
  } catch {
    return {}; // absent or corrupt — start fresh rather than fail to boot
  }
}

export async function writeState(state: AppState): Promise<void> {
  try {
    const file = stateFile();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch {
    /* remembering the project is a convenience; never fail an operation over it */
  }
}

export async function rememberProject(path: string): Promise<void> {
  await writeState({ ...(await readState()), lastProject: path });
}

// Reopen the last project if it is still a valid VibeBoard project. Returns the path reopened,
// or undefined (a missing/moved/dismantled project just means starting at the gate).
export async function restoreLastProject(session: ProjectSession): Promise<string | undefined> {
  const { lastProject } = await readState();
  if (!lastProject) return undefined;
  try {
    await readConfig(lastProject); // throws if it is not a VibeBoard project any more
    await session.open(lastProject);
    return lastProject;
  } catch {
    return undefined;
  }
}
