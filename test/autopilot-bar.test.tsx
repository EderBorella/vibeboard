// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutopilotState, Readiness, RunList, SandboxState } from '../web/src/api.js';
import type { CopilotConfig } from '../web/src/shared.js';

const api = vi.hoisted(() => ({
  getReadiness: vi.fn(),
  startAutopilot: vi.fn(),
  softStopAutopilot: vi.fn(),
  killAutopilot: vi.fn(),
  acknowledgeGates: vi.fn(),
  patchConfig: vi.fn(),
  // Re-exported by the module under test's import of ../api, so the real one must be present.
  isSuccessReason: (reason: string) => reason === 'complete',
}));
vi.mock('../web/src/api.js', () => api);

const { AutopilotBar } = await import('../web/src/autopilot/AutopilotBar.js');

const IDLE: AutopilotState = { state: 'idle', iteration: 0 };
// A real config block, both slots filled. Two backends and two remembered models, because a fixture
// with one of each cannot tell "the write preserved the slots" apart from "the write sent an empty
// map" — both would look like a pass.
const COPILOT: CopilotConfig = {
  backend: 'claude-code',
  backends: {
    'claude-code': { model: 'opus', effort: 'high' },
    opencode: { model: 'some/model', effort: 'medium' },
  },
};
// Nothing is wrong. `agentRefusal: null` is the server saying this backend can run; `null` for the
// whole object would be "not asked yet", which is a different claim and has its own test below.
const SANDBOX_OK: SandboxState = { ok: true, backend: 'managed', agentRefusal: null, refusalKind: null };
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
  api.patchConfig.mockReset().mockResolvedValue({});
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

const show = (
  over: {
    state?: AutopilotState | null;
    runs?: RunList;
    copilot?: CopilotConfig;
    sandbox?: SandboxState | null;
    onChanged?: () => void;
    onBackendChanged?: () => void;
    onSettings?: () => void;
  } = {},
) =>
  render(
    <AutopilotBar
      state={over.state === undefined ? IDLE : over.state}
      runs={over.runs ?? NO_RUNS}
      bump={0}
      copilot={over.copilot ?? COPILOT}
      sandbox={over.sandbox === undefined ? SANDBOX_OK : over.sandbox}
      onChanged={over.onChanged ?? (() => {})}
      onBackendChanged={over.onBackendChanged ?? (() => {})}
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
    api.startAutopilot.mockRejectedValue(
      new Error('README has almost no content, so there is nothing to derive'),
    );
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

    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Starting…' }) as HTMLButtonElement).disabled).toBe(true),
    );
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
    await waitFor(() =>
      expect(screen.getByTestId('ap-status').textContent).toBe('4 dispatches · E-004 · implement'),
    );
  });
});

describe('the details drawer', () => {
  it('is not offered when there is nothing to show', async () => {
    show();
    await waitFor(() => expect(api.getReadiness).toHaveBeenCalled());
    expect(screen.queryByTestId('ap-expand')).toBeNull();
  });

  it('opens on the blockers when the project is not ready', async () => {
    api.getReadiness.mockResolvedValue({
      ...READY,
      ok: false,
      blockers: ['README is empty', 'no gate commands'],
    });
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
    // What is actually behind it. It used to promise a routing table, which retired with ruling 52, and
    // the stops it also named are on this bar now — so the label named two things that were not there.
    const title = screen.getByRole('button', { name: 'Settings' }).getAttribute('title') ?? '';
    expect(title).not.toMatch(/routing table/i);
    expect(title).toMatch(/caps/i);
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

// Auto-pilot has no backend of its own. The loop dispatches without naming one and the server fills it
// from `config.copilot.backend`, so the setting was already in force on this surface and had simply
// never been shown on it — the bar said a run was ready without saying what would run it.
describe('which agent auto-pilot runs', () => {
  const group = () => screen.getByRole('group', { name: 'Which agent auto-pilot runs' });
  const pick = (label: string) => within(group()).getByRole('button', { name: label });

  it('shows the project’s configured backend, and offers the other', () => {
    show();

    expect(pick('Claude').className).toContain('active');
    expect(pick('OpenCode').className).not.toContain('active');
  });

  it('follows the config rather than a built-in default', () => {
    show({ copilot: { ...COPILOT, backend: 'opencode' } });

    expect(pick('OpenCode').className).toContain('active');
    expect(pick('Claude').className).not.toContain('active');
  });

  // THE POINT OF THE WHOLE CONTROL, asserted as bluntly as it can be. The auto-pilot loop is a separate
  // process that reads the config from disk; a selector that only moved browser state would name the
  // thing it does not control, and would look identical on screen. So this asserts the WRITE, and the
  // body of it.
  it('writes the choice to the project config', async () => {
    show();

    fireEvent.click(pick('OpenCode'));

    await waitFor(() => expect(api.patchConfig).toHaveBeenCalledTimes(1));
    // The WHOLE copilot block, not `{ backend }` alone: `backends` carries each agent's remembered
    // model, and sending a bare backend would depend on the server merging to avoid discarding them.
    expect(api.patchConfig).toHaveBeenCalledWith({
      copilot: {
        backend: 'opencode',
        backends: {
          'claude-code': { model: 'opus', effort: 'high' },
          opencode: { model: 'some/model', effort: 'medium' },
        },
      },
    });
  });

  it('writes nothing when the backend already in force is clicked', async () => {
    show();

    fireEvent.click(pick('Claude'));

    await waitFor(() => expect(api.getReadiness).toHaveBeenCalled());
    expect(api.patchConfig).not.toHaveBeenCalled();
  });

  // THE STALE STATUS. `useSandbox` is keyed on the shell's counter, not on the snapshot the server
  // broadcasts after a config patch — so without this call the status beside the selector keeps
  // answering for the backend just left. Nothing about that is visible by inspection: the selector
  // moves, the write lands, and the bar goes on reporting the old agent's refusal.
  it('re-asks the sandbox once the write has landed, and not before', async () => {
    let settle: () => void = () => {};
    api.patchConfig.mockImplementation(() => new Promise((r) => (settle = () => r({}))));
    const onBackendChanged = vi.fn();
    show({ onBackendChanged });

    fireEvent.click(pick('OpenCode'));
    await waitFor(() => expect(api.patchConfig).toHaveBeenCalled());
    // Still in flight: refetching here would ask about a backend the server has not accepted yet.
    expect(onBackendChanged).not.toHaveBeenCalled();

    settle();

    await waitFor(() => expect(onBackendChanged).toHaveBeenCalledTimes(1));
  });

  it('shows the server’s refusal of the write, rather than silently keeping the old backend', async () => {
    api.patchConfig.mockRejectedValue(new Error('opencode is not installed on this machine'));
    show();

    fireEvent.click(pick('OpenCode'));

    await waitFor(() =>
      expect(screen.getByTestId('ap-bar-error').textContent).toBe(
        'opencode is not installed on this machine',
      ),
    );
  });
});

describe('whether that agent can actually run', () => {
  it('says so when the server reports nothing wrong', async () => {
    show();
    await waitFor(() => expect(api.getReadiness).toHaveBeenCalled());
    expect(screen.getByTestId('ap-agent-state').textContent).toBe('Ready');
  });

  // The sentence is the SERVER'S, computed by the same function the dispatch gate calls. Rewording it
  // here would be a second description of a rule this bar does not enforce, and two descriptions of one
  // rule in this codebase have already drifted apart.
  it('carries the server’s refusal sentence verbatim', async () => {
    show({
      sandbox: {
        ok: false,
        backend: 'managed',
        agentRefusal:
          'Claude Code cannot run: the agent box holds a sign-in that was replaced on this machine.',
        refusalKind: 'credential',
      },
    });
    await waitFor(() => expect(api.getReadiness).toHaveBeenCalled());

    const badge = screen.getByTestId('ap-agent-state');
    // The heading is ours and comes from `refusalKind`, which exists so a refusal can be titled without
    // parsing its sentence. The sentence itself is untouched.
    expect(badge.textContent).toBe('Stale sign-in');
    // ON THE BUTTON, not on the word inside it. The chip became a Popover trigger when the balloon was
    // added, so the tooltip belongs to the element a person actually points at. The sentence being verbatim
    // is what this test is about, and it is asserted in both places it now appears.
    expect(badge.closest('button')?.getAttribute('title')).toBe(
      'Claude Code cannot run: the agent box holds a sign-in that was replaced on this machine.',
    );
    fireEvent.click(badge);
    expect(
      screen.getByText(
        'Claude Code cannot run: the agent box holds a sign-in that was replaced on this machine.',
      ),
    ).toBeTruthy();
  });

  it.each([
    ['docker', 'No Docker'],
    ['attached', 'Not sandboxed'],
  ] as const)('titles a %s refusal as %p', async (kind, word) => {
    show({ sandbox: { ok: false, backend: 'managed', agentRefusal: 'nope', refusalKind: kind } });
    await waitFor(() => expect(api.getReadiness).toHaveBeenCalled());
    expect(screen.getByTestId('ap-agent-state').textContent).toBe(word);
  });

  // `null` is NOT ASKED YET and must not read as "nothing is wrong" — the distinction useSandbox
  // documents at length. Showing reassurance before the answer arrives is a lie for the length of a
  // round trip, and showing an alarm is a worse one.
  it('does not claim the agent is ready before the server has answered', async () => {
    show({ sandbox: null });
    await waitFor(() => expect(api.getReadiness).toHaveBeenCalled());

    const badge = screen.getByTestId('ap-agent-state');
    expect(badge.textContent).toBe('Checking…');
    expect(badge.className).not.toContain('ap-agent-ok');
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

// THE WAY BACK FROM A STALLED PROJECT, offered where the stop is read.
//
// `stalled` is "work remains and nothing it can do would move it", and the bootstrap reaching its cap is one
// of the ways to get there — the calculator's did on 2026-08-16, spent by an OpenCode server that could not
// be reached. The card positions have their own button beside their own attempt counts; the derivation had
// none, because it has no card.
describe('clearing a stalled project’s derivation', () => {
  const STALLED: AutopilotState = {
    state: 'stopped',
    iteration: 3,
    reason: 'stalled',
    detail:
      'The board is empty and derive-features has used all 3 attempts at deriving it from the README. Read its runs: the README may be too thin to derive features from, in which case say more in it, or add the first card by hand.',
  };

  it('offers the clearance beside the sentence that explains the stop', () => {
    show({ state: STALLED });

    // The stop text and the remedy in one place: a button elsewhere for a sentence read here is how the
    // remedy goes unfound.
    expect(screen.getByTestId('ap-bar-detail').textContent).toMatch(/used all 3 attempts/);
    expect(screen.getByRole('button', { name: /clear the derivation/i })).toBeTruthy();
  });

  it('does not offer it while auto-pilot is running', () => {
    // Nothing to clear, and an in-flight derivation would land as an attempt of its own moments later —
    // the server refuses it for that reason, so the button must not invite the click.
    show({ state: { state: 'running', iteration: 2 } });

    expect(screen.queryByRole('button', { name: /clear the derivation/i })).toBeNull();
  });

  it('does not offer it on a stop that finished the work', () => {
    // `complete` is the loop having nothing left to do. Offering to clear attempts there would suggest
    // something went wrong when nothing did.
    show({ state: { state: 'stopped', iteration: 9, reason: 'complete', detail: 'Auto-pilot finished.' } });

    expect(screen.queryByRole('button', { name: /clear the derivation/i })).toBeNull();
  });
});

// WHETHER THE AGENTS ARE HEALTHY, on the surface that starts them.
//
// The chip beside the backend picker read only `agentRefusal` — "may an agent start right now" — and was
// blind to what had already happened. So on 2026-08-16, while three runs in a row died before reaching a model
// and auto-pilot stopped itself over them, this bar said "Ready" throughout: nothing was refusing, and the
// only surface that knew better was the light in the top bar.
//
// The words and sentences come from `lightAdvice`, the same function the top-bar balloon uses, because one
// fault must not have two names depending on which corner of the chrome reports it.
describe('the agent health chip', () => {
  const STREAK = {
    runs: 3,
    note: 'The agent never reached a model: [opencode failed: fetch failed] (exit code 1).',
    at: '2026-08-16T22:55:40.473Z',
  };

  it('says the runs are failing, where before it said Ready', () => {
    show({ sandbox: { ...SANDBOX_OK, recentFailure: STREAK } });

    expect(screen.getByTestId('ap-agent-state').textContent).toMatch(/failing/i);
  });

  it('carries the server’s own sentence in its balloon, not a reworded one', () => {
    // Reworded into "some runs failed" it becomes advice about nothing: a dead credential and an unreachable
    // server read identically once the specifics are dropped, and they send a person to different machines.
    show({ sandbox: { ...SANDBOX_OK, recentFailure: STREAK } });

    fireEvent.click(screen.getByTestId('ap-agent-state'));

    expect(screen.getByText(/opencode failed: fetch failed/)).toBeTruthy();
  });

  it('still says Ready when nothing has gone wrong', () => {
    show();
    expect(screen.getByTestId('ap-agent-state').textContent).toMatch(/ready/i);
  });

  it('names an unanswering backend rather than calling it Blocked', () => {
    // The third refusal kind. Without its own word it fell through to the generic one, which says a fault
    // exists and nothing about which — and the remedy for this one is a restart, not a rebuild.
    show({
      sandbox: {
        ...SANDBOX_OK,
        ok: false,
        agentRefusal:
          'the OpenCode server for this project is not answering — restart it in Settings › Sandbox',
        refusalKind: 'backend',
      },
    });

    const word = screen.getByTestId('ap-agent-state').textContent ?? '';
    expect(word).not.toMatch(/blocked/i);
    expect(word).toMatch(/server/i);
  });

  it('a refusal outranks a streak, because one stops you and the other has stopped', () => {
    // Both can be true at once — a streak is usually what a refusal was causing — and the one that prevents
    // work now is the one worth the word. Same ordering as `lightFor`.
    show({
      sandbox: {
        ...SANDBOX_OK,
        ok: false,
        agentRefusal: 'Docker is not running',
        refusalKind: 'docker',
        recentFailure: STREAK,
      },
    });

    expect(screen.getByTestId('ap-agent-state').textContent).not.toMatch(/failing/i);
  });
});
