// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { defaultConfig } from '../src/core/config.js';

const api = vi.hoisted(() => ({
  getSandbox: vi.fn().mockRejectedValue(new Error('no sandbox in this test')),
  listModels: vi.fn().mockResolvedValue([]),
  patchConfig: vi.fn().mockResolvedValue({}),
}));
vi.mock('../web/src/api.js', () => api);

const { SettingsModal } = await import('../web/src/components/SettingsModal.js');
import type { ProjectConfig } from '../web/src/shared.js';

afterEach(cleanup);

// The core and the web mirror are separate declarations of one shape, so the cast is the seam. If
// they ever disagree this file is one of the places that notices.
const configFor = (autopilot: boolean): ProjectConfig => {
  const config = defaultConfig('T') as unknown as ProjectConfig;
  if (!autopilot) config.autopilot = undefined;
  return config;
};

const show = (autopilot: boolean) =>
  render(<SettingsModal config={configFor(autopilot)} onClose={() => {}} onSaved={() => {}} />);

// Adding or removing a column is refused while a routing table exists, and the routing table is not
// editable from the UI yet. Being told that at Save, with no way forward in the message, is a dead
// end — so the Boards section says it before anyone types.
describe('the columns warning', () => {
  it('warns that adding or removing a column will be refused, and names where to change it', () => {
    show(true);
    expect(screen.getByText(/Adding or removing a column will be refused/i)).toBeTruthy();
    expect(screen.getByText('.vibeboard/config.yaml')).toBeTruthy();
    // The remedy is two keys, and naming only one of them sends the user back for a second refusal.
    expect(screen.getByText('routes')).toBeTruthy();
    expect(screen.getByText('terminal')).toBeTruthy();
  });

  it('says nothing on a project with no routing table, where the edit is not refused', () => {
    show(false);
    expect(screen.queryByText(/Adding or removing a column will be refused/i)).toBeNull();
    // The ordinary hint is still there — this is a warning added to that section, not a replacement.
    expect(screen.getByText(/Columns are comma-separated/i)).toBeTruthy();
  });

  it('pins the default table to what the warning promises: every default column is covered', () => {
    // If a future default column arrives unrouted, the warning above becomes a lie — every project
    // would be refused on its first column edit for a hole it was scaffolded with.
    const config = defaultConfig('T');
    expect(config.autopilot).toEqual(DEFAULT_AUTOPILOT);
  });
});
