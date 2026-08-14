// VibeBoard's own settings, as opposed to the open project's — see src/server/routes/settings.ts. The two
// log paths come back with them because "look in the log" is not actionable without the path, and the path
// depends on where VibeBoard is installed and what day it is.

import { patch, request } from './http';

export interface AppSettings {
  debugLog: boolean;
  serverLog: string | null;
  autopilotLog: string | null;
}

export async function getAppSettings(): Promise<AppSettings> {
  return (await request('/api/settings', {}, { fallback: 'Failed to read the app settings' })).json();
}

export function setDebugLog(on: boolean): Promise<AppSettings> {
  return patch<AppSettings>('/api/settings', { debugLog: on });
}
