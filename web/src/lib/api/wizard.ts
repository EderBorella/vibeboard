// The setup wizard's scratch state, and the door setup starts its own runs through. All of them are
// admin-only on the server: no agent reads or writes what a person is being asked, and none of them
// is reachable by anything but this browser.

import type { WizardState } from '../shared';
import { post, put, request } from './http';
import type { RunRecord } from './runs';

export async function getWizard(): Promise<{ state: WizardState | null }> {
  return (await request('/api/wizard', {}, { fallback: 'Failed to read the setup state' })).json();
}

// A whole-state replace — the caller holds every answer and sends all of them.
export function putWizard(state: WizardState): Promise<{ state: WizardState }> {
  return put('/api/wizard', state);
}

// Abandoning setup IS deleting the file, so there is nothing left to report back.
export async function clearWizard(): Promise<void> {
  await request('/api/wizard', { method: 'DELETE' }, { fallback: 'Failed to clear the setup state' });
}

// SETUP'S TWO RUNS, AND WHY THEY DO NOT GO THROUGH `dispatchRun`. Both are about the project and have
// no card, and `POST /api/runs { project: true }` is refused to this browser by design — a card-less
// run is the loop's alone. The door answers with the same record a dispatch does; what it will not do
// is start anything but these two, and only while a setup is in progress. decision 77.
export function runWizardSkill(
  skill: 'scan-project' | 'suggest-stack',
  prompt?: string,
): Promise<{ run: RunRecord }> {
  return post<{ run: RunRecord }>('/api/wizard/run', {
    skill,
    ...(prompt === undefined ? {} : { prompt }),
  });
}
