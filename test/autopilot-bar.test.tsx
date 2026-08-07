// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutopilotState, Readiness, RunList } from '../web/src/api.js';

const api = vi.hoisted(() => ({
  getReadiness: vi.fn(),
  startAutopilot: vi.fn(),
  softStopAutopilot: vi.fn(),
  // Re-exported by the module under test's import of ../api, so the real one must be present.
  isSuccessReason: (reason: string) => reason === 'complete',
}));
vi.mock('../web/src/api.js', () => api);

const { AutopilotBar } = await import('../web/src/components/AutopilotBar.js');

const IDLE: AutopilotState = { state: 'idle', iteration: 0, dispatchesSinceCheckup: 0, needsCheckup: false };
const NO_RUNS: RunList = { runs: [], active: [], queued: [] };
const READY: Readiness = {
  ok: true,
  blockers: [],
  readme: { ok: true },
  foundation: { present: [], missing: [], ok: true },
  gates: { ok: true, count: 1 },
  smoke: { ok: true },
  routes: { problems: [], count: 1 },
};

afterEach(cleanup);
beforeEach(() => {
  api.getReadiness.mockReset().mockResolvedValue(READY);
  api.startAutopilot.mockReset().mockResolvedValue({ state: IDLE });
  api.softStopAutopilot.mockReset().mockResolvedValue({ state: IDLE });
});

const show = (over: { state?: AutopilotState | null; runs?: RunList; onChanged?: () => void; onSettings?: () => void } = {}) =>
  render(
    <AutopilotBar
      state={over.state === undefined ? IDLE : over.state}
      runs={over.runs ?? NO_RUNS}
      bump={0}
      onChanged={over.onChanged ?? (() => {})}
      onSettings={over.onSettings ?? (() => {})}
    />,
  );

// "Hit play and see it move" used to mean four clicks into a settings modal, past the copilot and
// sandbox sections. The board itself had a one-word chip whose explanation lived in a title attribute.

describe('the transport control', () => {
  it('starts auto-pilot', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(api.startAutopilot).toHaveBeenCalledTimes(1));
    expect(api.softStopAutopilot).not.toHaveBeenCalled();
  });

  it('stops it while running, and does not start it again', async () => {
    show({ state: { ...IDLE, state: 'running', iteration: 2 } });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(api.softStopAutopilot).toHaveBeenCalledTimes(1));
    expect(api.startAutopilot).not.toHaveBeenCalled();
  });

  it('tells the shell to refresh, so one hook stays the source of the state', async () => {
    const onChanged = vi.fn();
    show({ onChanged });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  // THE REFUSAL IS THE FEATURE. The server answers a start on an unready project with a sentence naming
  // what is missing; swallowing it leaves a button that does nothing for no stated reason.
  it('shows the server’s refusal verbatim', async () => {
    api.startAutopilot.mockRejectedValue(new Error('README has almost no content, so there is nothing to derive'));
    show();

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() =>
      expect(screen.getByTestId('ap-bar-error').textContent).toBe(
        'README has almost no content, so there is nothing to derive',
      ),
    );
  });

  it('cannot be pressed twice while the answer is outstanding', async () => {
    let settle: () => void = () => {};
    api.startAutopilot.mockImplementation(() => new Promise((r) => (settle = () => r({ state: IDLE }))));
    show();

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => expect((screen.getByRole('button', { name: 'Starting…' }) as HTMLButtonElement).disabled).toBe(true));
    settle();
  });
});

describe('the status line', () => {
  it('reports what is running without opening anything', async () => {
    show({
      state: { ...IDLE, state: 'running', iteration: 4 },
      runs: {
        runs: [
          {
            run: 'r1',
            card: 'E-004',
            skill: 'implement',
            status: 'running',
            started: '',
            backend: 'x',
            model: 'y',
            effort: 'z',
            mode: 'm',
            report: '',
          },
        ],
        active: ['r1'],
        queued: [],
      },
    });
    await waitFor(() => expect(screen.getByTestId('ap-status').textContent).toBe('4 dispatches · E-004 · implement'));
  });
});

describe('the details drawer', () => {
  it('is not offered when there is nothing to show', async () => {
    show();
    await waitFor(() => expect(api.getReadiness).toHaveBeenCalled());
    expect(screen.queryByTestId('ap-expand')).toBeNull();
  });

  it('opens on the blockers when the project is not ready', async () => {
    api.getReadiness.mockResolvedValue({ ...READY, ok: false, blockers: ['README is empty', 'no gate commands'] });
    show();

    fireEvent.click(await screen.findByTestId('ap-expand'));

    const drawer = screen.getByTestId('ap-drawer');
    expect(drawer.textContent).toContain('README is empty');
    expect(drawer.textContent).toContain('no gate commands');
    // Both halves of the question, always — the drawer answers "doing" and "missing" independently.
    expect(drawer.textContent).toContain('Nothing is running');
  });

  it('closes again', async () => {
    api.getReadiness.mockResolvedValue({ ...READY, ok: false, blockers: ['README is empty'] });
    show();
    fireEvent.click(await screen.findByTestId('ap-expand'));
    expect(screen.getByTestId('ap-drawer')).toBeTruthy();

    fireEvent.click(screen.getByTestId('ap-expand'));

    expect(screen.queryByTestId('ap-drawer')).toBeNull();
  });
});

describe('the instructions', () => {
  it('open in a modal and close again', async () => {
    show();

    fireEvent.click(screen.getByRole('button', { name: /how it works/i }));

    const dialog = screen.getByRole('dialog', { name: /how auto-pilot works/i });
    // The claims a person needs before pressing play: what advances a card, and what stops the loop.
    expect(dialog.textContent).toMatch(/only if the check passes/i);
    expect(dialog.textContent).toMatch(/routing table/i);
    expect(dialog.textContent).toMatch(/attempt cap/i);
    expect(dialog.textContent).toMatch(/cannot dispatch other agents/i);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape, and focus starts on Close', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /how it works/i }));
    expect((document.activeElement as HTMLElement).textContent).toBe('Close');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the way through to the rest', () => {
  // Transport only. The caps, the routing table and the emergency stop stay in Settings — a kill button
  // on the header is a kill button somebody presses by accident.
  it('links to Settings and offers no kill', () => {
    const onSettings = vi.fn();
    show({ onSettings });

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(onSettings).toHaveBeenCalledTimes(1);
    for (const b of screen.getAllByRole('button')) {
      expect(b.textContent?.toLowerCase()).not.toContain('kill');
    }
  });
});
