// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { defaultConfig } from '../src/core/config.js';

const api = vi.hoisted(() => ({
  getSandbox: vi.fn().mockRejectedValue(new Error('no sandbox in this test')),
  listModels: vi.fn().mockResolvedValue([]),
  patchConfig: vi.fn().mockResolvedValue({}),
  // The modal now mounts the auto-pilot panel, which asks for readiness. Rejected rather than
  // stubbed with a fixture: this file is about the warning, and a panel reporting "could not read"
  // is the honest thing for it to say when nothing answered.
  getReadiness: vi.fn().mockRejectedValue(new Error('not what this test is about')),
  getAccounting: vi.fn().mockRejectedValue(new Error('not what this test is about')),
  // The panel also carries the stop controls, which read auto-pilot's state. Idle here: this file is
  // about the columns warning and the caps, and an idle project is the state with nothing to stop.
  getAutopilotState: vi
    .fn()
    .mockResolvedValue({ state: 'idle', iteration: 0, dispatchesSinceCheckup: 0, needsCheckup: false }),
  softStopAutopilot: vi.fn(),
  killAutopilot: vi.fn(),
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
  render(
    <SettingsModal
      config={configFor(autopilot)}
      onClose={() => {}}
      onSaved={() => {}}
      autopilot={null}
      onAutopilotChanged={() => {}}
    />,
  );

// Adding or removing a column is refused while a routing table exists, and the routing table is not
// editable from the UI yet. Being told that at Save, with no way forward in the message, is a dead
// end — so the Boards section says it before anyone types.
describe('the columns warning', () => {
  it('warns that adding or removing a column will be refused, and names where to change it', () => {
    show(true);
    // Scoped to the warning itself: the auto-pilot panel below it also names config.yaml, and an
    // assertion satisfied by either one would survive the warning being deleted.
    const warning = screen.getByText(/Adding or removing a column will be refused/i).closest('.settings-warn');
    expect(warning).not.toBeNull();
    const inWarning = within(warning as HTMLElement);
    expect(inWarning.getByText('.vibeboard/config.yaml')).toBeTruthy();
    // The remedy is two keys, and naming only one of them sends the user back for a second refusal.
    expect(inWarning.getByText('routes')).toBeTruthy();
    expect(inWarning.getByText('terminal')).toBeTruthy();
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

// The caps are edited in the auto-pilot panel and saved with everything else: one Save button, and one
// place for the server's refusal to appear — which may be about the routing table rather than the
// number that was touched.
describe('saving the caps', () => {
  // Cleared per test: the mock is module-level, so `calls[0]` would otherwise be whichever test in this
  // file clicked Save first — which is how an assertion passes while measuring the wrong thing.
  //
  // The braces are load-bearing. `beforeEach(() => api.patchConfig.mockClear())` returns the mock, and
  // vitest treats a function returned from a hook as TEARDOWN — so it called `patchConfig()` after every
  // test, and the one that mocks a rejection produced an unhandled rejection attributed to a test that
  // passed in isolation.
  beforeEach(() => {
    api.patchConfig.mockClear();
  });

  const field = (label: string): HTMLInputElement =>
    screen.getByText(label).closest('label')?.querySelector('input') as HTMLInputElement;
  const save = (): void => {
    fireEvent.click(screen.getByText('Save'));
  };

  // The property the commit immediately before this slice existed to create, and which sending the block
  // unconditionally undid: a save that does not touch the lifecycle must not make the server re-validate
  // it. Asserted on what is SENT, because that is what decides whether the server checks.
  it('sends no autopilot block when no cap was touched, so an invalid lifecycle cannot lock the modal', async () => {
    api.patchConfig.mockResolvedValue({});
    show(true);
    // A save of something else entirely — the shape of every ordinary save.
    fireEvent.change(field('Keep last N chats'), { target: { value: '9' } });
    save();
    await waitFor(() => expect(api.patchConfig).toHaveBeenCalled());
    expect('autopilot' in api.patchConfig.mock.calls[0][0]).toBe(false);
  });

  it('sends the WHOLE autopilot block, not just the edited number', async () => {
    api.patchConfig.mockResolvedValue({});
    show(true);
    fireEvent.change(field('Budget (USD)'), { target: { value: '5' } });
    save();
    await waitFor(() => expect(api.patchConfig).toHaveBeenCalled());
    const patch = api.patchConfig.mock.calls[0][0];
    expect(patch.autopilot.budgetUsd).toBe(5);
    // The routing table travels with it: the server validates the lifecycle on any patch that touches
    // `autopilot`, and a partial block would ask it to check a lifecycle with no routes in it.
    expect(patch.autopilot.routes).toEqual(DEFAULT_AUTOPILOT.routes);
    expect(patch.autopilot.terminal).toEqual(DEFAULT_AUTOPILOT.terminal);
  });

  it('sends no autopilot block at all for a project that has none', async () => {
    api.patchConfig.mockResolvedValue({});
    show(false);
    save();
    await waitFor(() => expect(api.patchConfig).toHaveBeenCalled());
    expect('autopilot' in api.patchConfig.mock.calls[0][0]).toBe(false);
  });

  // The refusal is a sentence naming what to change. Swallowing it would leave the user staring at a
  // dial that silently did nothing.
  it('shows the server’s refusal rather than swallowing it', async () => {
    api.patchConfig.mockRejectedValue(
      new Error('engineering: the column "review" is not routed. Edit `autopilot` in .vibeboard/config.yaml.'),
    );
    show(true);
    fireEvent.change(field('Max dispatches'), { target: { value: '3' } });
    save();
    expect(await screen.findByText(/is not routed/)).toBeTruthy();
  });
});
