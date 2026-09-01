import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readConfig } from '../../store/project/config.js';
import type { ProjectSession } from '../boards/session.js';

// App-level state, outside any project: what VibeBoard should reopen on start. Without this the
// open project lives only in memory, so every restart drops you back to the project gate — and
// any client mid-session starts erroring until you pick a project again.

interface AppState {
  lastProject?: string;
  // Whether the auto-pilot loop's ordinary chatter is kept as well as its errors. App-level rather than
  // per-project, because the logs are: they belong to VibeBoard's own folder, not to the board project the
  // user happens to have open (see logging.ts). It would also be the wrong thing to write into a project's
  // config.yaml — that file is the user's content, and a debug switch is ours.
  debugLog?: boolean;
}

export function stateFile(): string {
  return process.env.VIBEBOARD_STATE_FILE ?? join(homedir(), '.vibeboard', 'state.json');
}

export async function readState(): Promise<AppState> {
  try {
    const parsed = JSON.parse(await readFile(stateFile(), 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const { lastProject, debugLog } = parsed as AppState;
    return {
      // Each field validated on its own, so one nonsense value does not discard the other. Written as a
      // single ternary over `lastProject` it silently dropped everything else in the file.
      ...(typeof lastProject === 'string' ? { lastProject } : {}),
      ...(typeof debugLog === 'boolean' ? { debugLog } : {}),
    };
  } catch {
    return {}; // absent or corrupt — start fresh rather than fail to boot
  }
}

// THROWS. It used to swallow every failure, which is right for the one caller that treats this file as a
// convenience and wrong for a setting a person has just toggled: a switch that reports success and changes
// nothing is worse than one that says it could not save. The swallow now lives at the call site that wants
// it, so there is still one writer.
export async function writeState(state: AppState): Promise<void> {
  const file = stateFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function rememberProject(path: string): Promise<void> {
  try {
    await writeState({ ...(await readState()), lastProject: path });
  } catch {
    /* remembering the project is a convenience; never fail an operation over it */
  }
}

// The other half of `rememberProject`, and without it deleting the open project leaves VibeBoard trying
// to reopen a folder that is gone on the next start — which lands the user on the picker with an error
// rather than on the picker. Only clears when it is THIS project: forgetting somebody else's would be a
// second bug wearing the first one's clothes.
export async function forgetProject(path: string): Promise<void> {
  try {
    const state = await readState();
    if (state.lastProject === undefined || resolve(state.lastProject) !== resolve(path)) return;
    const { lastProject: _dropped, ...rest } = state;
    await writeState(rest);
  } catch {
    /* the same reasoning as rememberProject: never fail a delete over what is a convenience */
  }
}

// Read fresh on every start of the loop rather than captured at boot: the toggle is meant to be flipped
// while the app is running, and a value read once would mean restarting VibeBoard to debug it.
export async function debugLogging(): Promise<boolean> {
  return (await readState()).debugLog === true;
}

export async function setDebugLogging(on: boolean): Promise<void> {
  await writeState({ ...(await readState()), debugLog: on });
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
