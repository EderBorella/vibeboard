// The setup wizard's scratch state. Three calls over one transient file, all of them admin-only on
// the server: no agent reads or writes what a person is being asked.

import type { WizardState } from '../shared';
import { put, request } from './http';

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
