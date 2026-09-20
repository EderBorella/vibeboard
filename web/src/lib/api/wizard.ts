// The setup wizard's scratch state, and the door setup starts its own runs through. Every call in
// this file is admin-only on the server, by being absent from the scope table — the browser is the
// only thing that reaches any of them.
//
// WHICH IS NOT THE SAME AS "NO AGENT TOUCHES THE FILE", and this header said it was. Two routes into
// the same state ARE agent-facing and are deliberately not here, because nothing in the browser
// calls them: a run fills `suggested` through `PUT /api/wizard/prefill`, and the copilot files its
// summaries through `PUT /api/wizard/resumes/:name`. Each is granted one block of the state rather
// than the state, which is what makes them narrow — see src/server/boards/wizard-routes.ts.
// decision 77.

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
