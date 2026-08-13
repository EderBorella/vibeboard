// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutopilotState, Readiness, RunList } from '../web/src/api.js';

const api = vi.hoisted(() => ({
  getReadiness: vi.fn(),
  startAutopilot: vi.fn(),
  softStopAutopilot: vi.fn(),
  killAutopilot: vi.fn(),
  acknowledgeGates: vi.fn(),
  // Re-exported by the module under test's import of ../api, so the real one must be present.
  isSuccessReason: (reason: string) => reason === 'complete',
}));
vi.mock('../web/src/api.js', () => api);

const { AutopilotBar } = await import('../web/src/components/AutopilotBar.js');

const IDLE: AutopilotState = { state: 'idle', iteration: 0 };
const NO_RUNS: RunList = { runs: [], active: [], queued: [] };
const READY: Readiness = {
  ok: true,
  blockers: [],
  readme: { ok: true },
  foundation: { present: [], missing: [], ok: true },
  gates: { ok: true, count: 1 },
  smoke: { ok: true },
  phases: { problems: [], count: 1 },
  unreviewedGates: [],
};

afterEach(cleanup);
beforeEach(() => {
  api.getReadiness.mockReset().mockResolvedValue(READY);
  api.startAutopilot.mockReset().mockResolvedValue({ state: IDLE });
  api.softStopAutopilot.mockReset().mockResolvedValue({ state: IDLE });
  api.killAutopilot.mockReset().mockResolvedValue({ state: IDLE });
  api.acknowledgeGates.mockReset().mockResolvedValue({ ok: true });
});

// What a project looks like when an agent rewrote the two documents whose commands run on the HOST.
// Taken from a real one (tik-tak-toe, 2026-08-10), where a user got stuck with no reachable way out.
const GATES_UNREVIEWED: Readiness = {
  ...READY,
  ok: false,
  blockers: [
    'foundation/CODE-QUALITY.md and foundation/TESTING.md were rewritten by an agent. Read the commands in Project Control before auto-pilot runs them — they run outside the sandbox, as you.',
  ],
  unreviewedGates: ['CODE-QUALITY.md', 'TESTING.md'],
};

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
    // The lifecycle is fixed and is not a setting (ruling 52). This used to assert `routing table`, which
    // is the claim that stopped being true.
    expect(dialog.textContent).toMatch(/is not a setting/i);
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

describe('the stops are on the bar, not behind Settings', () => {
  // The emergency stop used to be Settings-only. That put the control that kills a running loop behind
  // a modal opened on top of the board you are watching it work on — and Settings is exactly where a
  // user pressed Start, got refused, and could not find the way forward either.
  it('offers the emergency stop without opening anything', async () => {
    show({ state: { ...IDLE, state: 'running', iteration: 2 } });
    expect(await screen.findByTestId('ap-kill')).toBeTruthy();
  });

  it('asks before killing, and does nothing if you decline', async () => {
    show({ state: { ...IDLE, state: 'running', iteration: 2 } });
    fireEvent.click(await screen.findByTestId('ap-kill'));

    // The dialog names the half people do not expect: the chat and manual runs stop too.
    expect(await screen.findByText(/Kill everything in this project\?/)).toBeTruthy();
    expect(api.killAutopilot).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByText(/Kill everything in this project\?/)).toBeNull());
    expect(api.killAutopilot).not.toHaveBeenCalled();
  });

  it('kills on confirmation, saying where it came from', async () => {
    const onChanged = vi.fn();
    show({ state: { ...IDLE, state: 'running', iteration: 2 }, onChanged });
    fireEvent.click(await screen.findByTestId('ap-kill'));
    fireEvent.click(await screen.findByText('Kill everything'));

    // The reason reaches the diary, so it has to say which control was used — "from Settings" would be
    // a false record now that this one exists.
    await waitFor(() => expect(api.killAutopilot).toHaveBeenCalledWith(expect.stringMatching(/bar/i)));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('is disabled once the project is halted — the way back is the overlay', async () => {
    show({ state: { ...IDLE, state: 'halted' } });
    expect((await screen.findByTestId('ap-kill')).hasAttribute('disabled')).toBe(true);
  });

  it('still soft-stops from the transport button while running', async () => {
    show({ state: { ...IDLE, state: 'running', iteration: 1 } });
    fireEvent.click(await screen.findByRole('button', { name: /^stop$/i }));
    await waitFor(() => expect(api.softStopAutopilot).toHaveBeenCalled());
  });
});

describe('the gate acknowledgement', () => {
  // This button existed before, INSIDE the details drawer, and nothing tested it. A user hit the
  // consequence: told to read the commands in Project Control, they did, were refused again, and could
  // not find the control — it was behind a disclosure arrow on a surface they had no reason to open.
  it('is on the bar itself, with nothing to open first', async () => {
    api.getReadiness.mockResolvedValue(GATES_UNREVIEWED);
    show();

    // NOT preceded by a click on ap-expand. That is the whole point of this test.
    expect(await screen.findByTestId('ap-review-gates')).toBeTruthy();
  });

  it('is the LAST control in the row, so nothing shifts when it disappears', async () => {
    api.getReadiness.mockResolvedValue(GATES_UNREVIEWED);
    show();
    const button = await screen.findByTestId('ap-review-gates');

    const row = button.parentElement;
    expect(row?.className).toContain('ap-bar-row');
    // Asserted as identity, not as an index: "last" is the property that makes its removal harmless,
    // and an index would still pass with one more control appended after it.
    expect(row?.lastElementChild).toBe(button);
  });

  it('clears the flag and takes itself away', async () => {
    // The mock answers from STATE, not from a value swapped in after the click. Swapping it afterwards
    // races the refetch: if readiness had already been re-asked, the stale answer wins and the button
    // stays — which made this test fail depending on what else was in the file.
    let acknowledged = false;
    api.acknowledgeGates.mockImplementation(async () => {
      acknowledged = true;
      return { ok: true };
    });
    api.getReadiness.mockImplementation(async () => (acknowledged ? READY : GATES_UNREVIEWED));
    show();

    fireEvent.click(await screen.findByTestId('ap-review-gates'));

    await waitFor(() => expect(api.acknowledgeGates).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('ap-review-gates')).toBeNull());
  });

  it('is absent when no agent has rewritten a gate document', async () => {
    api.getReadiness.mockResolvedValue({ ...READY, ok: false, blockers: ['README is empty'] });
    show();
    await waitFor(() => expect(api.getReadiness).toHaveBeenCalled());
    expect(screen.queryByTestId('ap-review-gates')).toBeNull();
  });
});

describe('why it stopped, readable in full', () => {
  // Reported twice by the same user, the second time after copying the text out of the DOM by hand
  // because the element had collapsed it. `.ap-status` is a row — one line, `text-overflow: ellipsis` —
  // and these sentences quote git's own output, so the useful half was always the half that was cut.
  const LONG =
    'Auto-pilot stopped before dispatching F-002: Could not stage the tree: The following paths are ' +
    'ignored by one of your .gitignore files: .vibeboard hint: Use -f if you really want to add them.';

  it('renders the whole reason in its own block, not in the one-line status', async () => {
    show({ state: { ...IDLE, state: 'stopped', reason: 'stalled', detail: LONG } });

    const detail = await screen.findByTestId('ap-bar-detail');
    // The WHOLE string. `toContain` on a fragment would pass against a truncated render, which is the
    // bug — so this asserts the full text is present.
    expect(detail.textContent).toBe(LONG);

    // And the row stays short, so nothing is relying on the ellipsised element to carry it.
    expect(screen.getByTestId('ap-status').textContent).toBe('Stopped.');
  });

  it('says nothing when there is nothing to explain', async () => {
    show({ state: { ...IDLE, state: 'running', iteration: 1 } });
    await waitFor(() => expect(api.getReadiness).toHaveBeenCalled());
    expect(screen.queryByTestId('ap-bar-detail')).toBeNull();
  });
});
