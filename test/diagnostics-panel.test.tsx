// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const OFF = {
  debugLog: false,
  serverLog: '/install/logs/vibeboard-2026-08-12.log',
  autopilotLog: '/install/logs/autopilot-2026-08-12.log',
};

const api = vi.hoisted(() => ({
  getAppSettings: vi.fn(),
  setDebugLog: vi.fn(),
}));
vi.mock('../web/src/api.js', () => api);
const { DiagnosticsPanel } = await import('../web/src/components/DiagnosticsPanel.js');

afterEach(cleanup);
beforeEach(() => {
  api.getAppSettings.mockReset().mockResolvedValue(OFF);
  api.setDebugLog.mockReset().mockImplementation(async (on: boolean) => ({ ...OFF, debugLog: on }));
});

const box = (): HTMLInputElement => screen.getByRole('checkbox') as HTMLInputElement;

describe('the diagnostics panel', () => {
  it('shows the switch as the server has it, not as this page assumed', async () => {
    api.getAppSettings.mockResolvedValue({ ...OFF, debugLog: true });
    render(<DiagnosticsPanel />);
    await waitFor(() => expect(box().checked).toBe(true));
  });

  // It saves ITSELF rather than waiting for the modal's Save button: this is an app-level setting stored
  // outside every project, and that button sends a project-config patch which can be refused for reasons
  // that have nothing to do with this checkbox.
  it('saves as soon as it is clicked', async () => {
    render(<DiagnosticsPanel />);
    await waitFor(() => expect(box().disabled).toBe(false));
    fireEvent.click(box());
    await waitFor(() => expect(api.setDebugLog).toHaveBeenCalledWith(true));
    await waitFor(() => expect(box().checked).toBe(true));
  });

  // The refusal path, which is the half that IS observable. The panel renders the server's answer rather
  // than the value it sent, and today those two cannot be told apart: the route echoes what it stored, so
  // rendering the sent value instead is an equivalent mutant — planted, confirmed, and recorded here rather
  // than chased with a fixture that invents a disagreement the server never produces. What this pins is that
  // a REJECTED save moves nothing, which is a real failure mode: a switch that looks on with a next start
  // that will not honour it.
  it('stays where it was when the save is refused, and says why', async () => {
    api.setDebugLog.mockRejectedValue(new Error('Could not save that setting: EACCES'));
    render(<DiagnosticsPanel />);
    await waitFor(() => expect(box().disabled).toBe(false));
    fireEvent.click(box());
    await screen.findByText(/EACCES/);
    expect(box().checked).toBe(false);
  });

  it('names both log files, because neither path is guessable', async () => {
    render(<DiagnosticsPanel />);
    await screen.findByText(/autopilot-2026-08-12\.log/);
    await screen.findByText(/vibeboard-2026-08-12\.log/, { exact: false });
  });

  it('says so plainly when this install writes no log files', async () => {
    api.getAppSettings.mockResolvedValue({ debugLog: false, serverLog: null, autopilotLog: null });
    render(<DiagnosticsPanel />);
    await screen.findByText(/auto-pilot: not written on this install/);
  });

  // Until the first answer arrives there is nothing true to show, so the control cannot be operated: a click
  // in that window would send a value read off a default rather than off the server.
  it('cannot be toggled before the server has answered', () => {
    api.getAppSettings.mockReturnValue(new Promise(() => undefined));
    render(<DiagnosticsPanel />);
    expect(box().disabled).toBe(true);
    fireEvent.click(box());
    expect(api.setDebugLog).not.toHaveBeenCalled();
  });
});
