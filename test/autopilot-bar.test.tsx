// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STOP_REASONS } from '../src/core/dispatch-gate.js';
import type { AutopilotState, Readiness, RunList, SandboxState } from '../web/src/lib/api.js';
import type { AutopilotConfig, Card, CopilotConfig } from '../web/src/lib/shared.js';

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
vi.mock('../web/src/lib/api.js', () => api);

const { AutopilotBar } = await import('../web/src/organisms/autopilot/AutopilotBar.js');

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

// A whole lifecycle block, because the mode picker writes the whole one back: `PATCH /api/config` runs the
// coverage check over the block it is given, so a patch carrying `{ mode }` alone fails every check that
// indexes the rest.
const AP_CONFIG: AutopilotConfig = {
  maxIterations: 250,
  budgetUsd: 20,
  runTimeoutMs: 1_800_000,
  attemptCap: 3,
  terminal: { features: ['done'], product: ['done'], engineering: ['done'] },
  blockedColumn: 'blocked',
  mode: 'standard',
};

// TWO features and one already DONE, because a fixture too thin to distinguish two outcomes tests neither:
// with one card, "lists the unfinished ones" and "lists everything" are the same list.
const feature = (id: string, columnSlug: string): Card =>
  ({
    id,
    title: `Feature ${id}`,
    board: 'features',
    columnSlug,
    order: 10,
    tags: [],
    links: [],
  }) as unknown as Card;
const longTitled = feature('F-009', 'backlog');
longTitled.title = 'The product can be run the way the README describes, end to end';

// The same long title on a FINISHED feature, which is the case the label budget is about: a saved focus whose
// card its own run closed still has to show, and the "(finished)" is the half worth keeping.
const longDone = feature('F-010', 'done');
longDone.title = 'The product can be run the way the README describes, end to end';

const FEATURES: Card[] = [
  feature('F-001', 'backlog'),
  feature('F-002', 'in-progress'),
  feature('F-003', 'done'),
];

const show = (
  over: {
    state?: AutopilotState | null;
    runs?: RunList;
    copilot?: CopilotConfig;
    autopilotConfig?: AutopilotConfig | null;
    features?: Card[];
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
      autopilotConfig={over.autopilotConfig === undefined ? AP_CONFIG : over.autopilotConfig}
      features={over.features ?? FEATURES}
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

  // IT IS NO LONGER LAST, AND THE PROPERTY THAT MADE "LAST" MATTER IS WHAT IS ASSERTED INSTEAD.
  //
  // This was *is the LAST control in the row, so nothing shifts when it disappears*, on identity rather
  // than index — and the reason was real: it is the one blocker a person CLEARS rather than fixes, so it is
  // the one control that vanishes the moment it is used, and anything to its right would jump leftwards as
  // it went.
  //
  // The owner's three-group layout puts it with the controls that ACT, which is where it belongs — and the
  // constraint it was avoiding no longer exists. The two groups to its right are pinned by
  // `margin-left: auto`, so their position is decided by the row's own width and not by what precedes
  // them. So the claim becomes the thing "last" was a proxy for: the groups after it do not move when it
  // goes. Asserted by measuring them with the button present and absent, which is stronger than either
  // version of the position check — an index or an identity would both pass on a layout that shifted.
  //
  // jsdom COMPUTES NO LAYOUT, so this reads `offsetLeft`, which is 0 for everything here. What it CAN see
  // is the structure that decides the layout: which group each control is in, and that the two groups after
  // it are the ones carrying the auto margin. The pixel claim is visual/checks/board.spec.ts's check 14.
  it('sits with the controls that act, and the groups after it carry their own position', async () => {
    api.getReadiness.mockResolvedValue(GATES_UNREVIEWED);
    show();
    const button = await screen.findByTestId('ap-review-gates');

    const row = button.parentElement;
    expect(row?.className).toContain('ap-bar-row');
    // Not inside `.ap-bar-end` — it acts on the project, it does not explain it.
    expect(button.closest('.ap-bar-end')).toBeNull();
    // AND THE TWO GROUPS AFTER IT ARE BOTH `push`ed, which is what makes its removal harmless. `push` is
    // `margin-left: auto`; a group that positions itself from the right cannot be moved by a sibling
    // disappearing to its left.
    const after = Array.from(row?.children ?? []).slice(Array.from(row?.children ?? []).indexOf(button) + 1);
    expect(after.length, 'nothing follows the acknowledgement, so this asserts nothing').toBeGreaterThan(1);
    for (const group of after) {
      expect(
        group.className,
        `${group.className} follows the acknowledgement without an auto margin, so it would shift when it goes`,
      ).toMatch(/\b(push|ap-bar-end)\b/);
    }
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

// THE LOOP'S OWN STATE, AS ONE CHIP, AND THESE CLAIMS ARRIVED FROM test/topbar.test.tsx. Eleven tests
// there asserted a second auto-pilot indicator beside the project name; the owner ruled that one of the
// two goes, and the one that stays is on the surface with the Start button. So the claims move rather than
// being deleted — the word per state, the reason on a stop, `complete` as the only success, the balloon
// and the tooltip with its fallback.
//
// TWO THINGS ARE DELIBERATELY DIFFERENT HERE. The word is `running` and not `auto-pilot running`: the
// prefix existed because that chip sat beside a project name with no other context, and on the bar that
// runs the loop nothing else is in question. And `idle` renders a chip that says `not started`, where the
// header rendered none at all — a chip per tab was noise, and a bar whose whole subject is the loop
// saying nothing about it is worse than noise.
describe('the loop’s own state, as one chip', () => {
  const chip = (): HTMLElement => screen.getByTestId('ap-chip');
  const at = (over: Partial<AutopilotState>): AutopilotState => ({ ...IDLE, state: 'stopped', ...over });

  it('says the state in one word, and carries it as an attribute', () => {
    show({ state: { ...IDLE, state: 'running', iteration: 1 } });
    expect(chip().textContent).toBe('running');
    expect(chip().getAttribute('data-state')).toBe('running');
  });

  it('says halted, whatever the reason was', () => {
    show({ state: at({ state: 'halted', reason: 'killed' }) });
    expect(chip().textContent).toBe('halted');
    expect(chip().getAttribute('data-state')).toBe('halted');
  });

  it('names the reason it stopped', () => {
    show({ state: at({ reason: 'exhausted' }) });
    expect(chip().textContent).toBe('exhausted');
  });

  // The one state the header hid and this one does not. See the note above.
  it('says so while nothing has started, where the header showed nothing', () => {
    show({ state: IDLE });
    expect(chip().textContent).toBe('not started');
    expect(chip().getAttribute('data-state')).toBe('idle');
  });

  // The line the study draws, on screen: only one of these ended with the work done. Over STOP_REASONS
  // rather than a hand-written list, so a reason added later fails this until somebody decides which side
  // of the line it is on — which is the property the core test has and this one used to lack.
  it('styles only `complete` as a success', () => {
    for (const reason of STOP_REASONS) {
      cleanup();
      show({ state: at({ reason }) });
      const success = chip().getAttribute('data-state') === 'complete';
      expect(success, reason).toBe(reason === 'complete');
    }
  });

  // THE STOP SENTENCE IS THE SERVER'S AND REACHES THE BALLOON VERBATIM. It names the branch the loop could
  // not create and quotes git underneath, which is exactly the string a `title` was cutting off.
  it('opens to the loop’s own stop sentence', () => {
    const said = 'Nothing can move E-004, E-007 — check that every column that holds a card is routed.';
    show({ state: at({ reason: 'stalled', detail: said }) });

    expect(chip().tagName).toBe('BUTTON');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(chip());
    const balloon = screen.getByRole('dialog');
    expect(balloon.querySelector('.vb-status-detail')?.textContent).toBe(said);
    // Our heading names the stop; the server's sentence is the detail. Same split as `lightAdvice`.
    expect(balloon.querySelector('.vb-status-head')?.textContent).toBe('Auto-pilot stopped: stalled');
  });

  // `next` IS ABSENT ON A SUCCESS, which is `LightAdvice`'s contract: an instruction implies something is
  // wrong, and a finished run is not a fault. The dialog is fetched before the query so this cannot pass
  // against a balloon that failed to open at all.
  it('gives a finished run no instruction, because there is nothing to do', () => {
    show({ state: at({ reason: 'complete' }) });
    fireEvent.click(chip());
    const balloon = screen.getByRole('dialog');
    expect(balloon.querySelector('.vb-status-head')?.textContent).toBe('Auto-pilot finished');
    expect(balloon.querySelector('.vb-status-next')).toBeNull();
  });

  // THE TOOLTIP IS THE ROW'S SENTENCE, AND FALLS BACK TO THE WORD. A halt has a sentence the chip cannot
  // fit — a halt takes the chat and the manual runs down with it — and a stop has none, because
  // `statusFor` returns nothing for the state whose row was the chip's own word in a full stop.
  it('titles itself with the row’s sentence, or with its own word when there is none', () => {
    show({ state: at({ state: 'halted' }) });
    expect(chip().getAttribute('title')).toBe('Everything in this project was stopped.');
    cleanup();
    show({ state: at({ reason: 'exhausted' }) });
    expect(chip().getAttribute('title')).toBe('exhausted');
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

  // A CONTROL THAT ONLY EXISTS ONCE SOMETHING IS BROKEN IS ONE NOBODY HAS EVER PRESSED, which is the
  // owner's ruling and the reason this test exists. The chip used to be a `<span>` while the agent was
  // healthy and a `<button>` once it was not: the affordance appeared for the first time at the exact
  // moment a person needed it, on the surface they were already frustrated with.
  //
  // ASSERTED AS THE TAG AND THEN AS A CLICK, in both directions, because the tag alone was the vacuous
  // half of this claim's ancestor — `.ap-agent-state` sat on an inner span for one phase, so a selector
  // found something whether or not it was the control. The click is what proves the balloon opens.
  it.each(['ready', 'failing'] as const)('is a button you can open in the %s state too', (which) => {
    show({
      sandbox:
        which === 'ready'
          ? SANDBOX_OK
          : {
              ...SANDBOX_OK,
              recentFailure: { runs: 3, note: 'died before a model', at: '2026-08-22T00:00:00Z' },
            },
    });

    const chip = screen.getByTestId('ap-agent-state');
    expect(chip.tagName).toBe('BUTTON');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(chip);
    // AND IT SAYS SOMETHING TRUE RATHER THAN SOMETHING REASSURING. A healthy agent's balloon carries the
    // sentence `agentStatus` has always written and hidden in a `title` — so this is not an invented
    // reassurance, it is the same sentence somewhere a touch device can read it.
    const said = screen.getByRole('dialog').textContent ?? '';
    expect(said).toContain(which === 'ready' ? 'has what it needs to run' : 'died before a model');
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
    // `data-state`, not the class name. THE CLASS VERSION OF THIS WAS VACUOUS in every case that has a
    // balloon: the test id sat on an inner span that never carried a tone at all, so
    // `not.toContain('ap-agent-ok')` was true of an element that could not have contained it. Phase 3
    // put the tone and the id on the same element — see AutopilotBar.tsx — which is what this needed.
    //
    // `checking` AND NOT `unknown`, and it is the same claim about a renamed value. This surface's four
    // states were `ok`, `bad`, `warn` and `unknown` — three of them TONE names used as state names, so
    // `ok` was a state here and a colour in the stylesheet, where it was then painted `--muted`. They
    // are `ready`, `blocked`, `failing` and `checking` now; see web/src/design/state-tones.ts.
    expect(badge.getAttribute('data-state')).toBe('checking');
    // AND THE TONE CLASS BESIDE IT, because the attribute alone is what was vacuous once already: it
    // says which state this is and nothing about whether the state reaches a colour. `neutral` is the
    // claim — "not asked yet" must not read as reassurance and must not read as an alarm.
    expect(badge.className).toContain('vb-tone-neutral');
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

    // AND THE ROW SAYS NOTHING AT ALL, which is stronger than the `Stopped.` it used to assert: the row is
    // an ellipsised one-liner, so anything it carried was a candidate for being the truncated copy of this
    // sentence. The chip two elements to the left says `stalled`; the element is not rendered.
    expect(screen.queryByTestId('ap-status')).toBeNull();
    expect(screen.getByTestId('ap-chip').textContent).toBe('stalled');
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

// THE LIFECYCLE MODE PICKER, and what it is for is a trade rather than a preference: express was measured
// against standard on the same README and the same backend at 24 runs against 80, $14.06 against $41.07 and
// 12 cards against 39, with a product that passes its smoke test either way.
describe('the lifecycle mode', () => {
  const picker = () => screen.getByRole('group', { name: /how coarsely/i });

  it('shows which mode the project is on', () => {
    show();
    // The CLASS, because that is the only thing a grouped `Tabs` marks selection with: it sets `role=group`
    // and drops `aria-selected`, on the argument that a segmented picker's cells are not tabs. It puts
    // nothing in its place, so the selected option of every segmented picker in this app — this one and the
    // backend picker beside it — is invisible to a screen reader. Asserted here as what the component
    // actually does rather than what it should; the gap belongs to `molecules/Tabs`, not to this control.
    expect(within(picker()).getByRole('button', { name: 'Standard' }).className).toContain('active');
    expect(within(picker()).getByRole('button', { name: 'Express' }).className).not.toContain('active');
  });

  // THE WHOLE BLOCK GOES BACK, not `{ mode }` alone. `PATCH /api/config` runs the coverage check over the
  // autopilot block it is given, and a block carrying one key fails every check that indexes the rest —
  // the class of refusal `ensureAutopilotKeys` exists to prevent, arriving from the other direction.
  it('saves the whole block, so the patch cannot fail the coverage check', async () => {
    show();
    fireEvent.click(within(picker()).getByRole('button', { name: 'Express' }));
    await waitFor(() => expect(api.patchConfig).toHaveBeenCalledTimes(1));
    expect(api.patchConfig).toHaveBeenCalledWith({ autopilot: { ...AP_CONFIG, mode: 'express' } });
  });

  it('writes nothing when the mode chosen is the one already saved', async () => {
    show();
    fireEvent.click(within(picker()).getByRole('button', { name: 'Standard' }));
    await waitFor(() => expect(api.getReadiness).toHaveBeenCalled());
    expect(api.patchConfig).not.toHaveBeenCalled();
  });

  // A project written before the lifecycle existed has no block to write a key into, and auto-pilot refuses
  // to start there anyway. A picker over nothing would offer a choice that cannot be saved.
  it('is absent where the project has no lifecycle block at all', () => {
    show({ autopilotConfig: null });
    expect(screen.queryByRole('group', { name: /how coarsely/i })).toBeNull();
  });
});

// ONE FEATURE, END TO END — the second dropdown, and it appears only in express.
describe('the feature auto-pilot is focused on', () => {
  const EXPRESS: AutopilotConfig = { ...AP_CONFIG, mode: 'express' };
  const picker = () => screen.getByRole('combobox', { name: /feature auto-pilot works on/i });

  // EXPRESS ONLY — and what makes that free of layout cost is WHERE it renders, not whether. It sits in the
  // row's left, unpushed region: the two groups after the gate acknowledgement are pinned by auto margins, so
  // a control arriving or leaving there takes nothing from them. Inside the pushed group it moved the mode
  // selector ~300px at the moment you clicked it; reserving the lane in standard instead made the row wide
  // enough to wrap, and the browser harness refused that in two separate checks.
  it('is not offered in standard mode', () => {
    show();
    expect(screen.queryByRole('combobox', { name: /feature auto-pilot works on/i })).toBeNull();
  });

  // THE PLACEMENT IS THE CLAIM, so it is asserted rather than left to the comment above: the picker is NOT
  // inside either pushed group, and it comes before the acknowledgement — which must stay the last thing that
  // can vanish without moving anything.
  it('renders outside the pushed groups, ahead of the gate acknowledgement', () => {
    show({ autopilotConfig: EXPRESS });
    const sel = picker();
    expect(sel.closest('[data-testid="ap-agent"]')).toBeNull();
    expect(sel.closest('[data-testid="ap-bar-end"]')).toBeNull();
    const row = sel.closest('.ap-bar-row');
    expect(row).not.toBeNull();
    const kids = Array.from(row?.children ?? []);
    const at = kids.findIndex((c) => c === sel || c.contains(sel));
    const pushed = kids.findIndex((c) => c.className.includes('push'));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(pushed);
  });

  // THE CONTROL MUST SHOW THE STATE THAT EXISTS, and this was found by opening the page rather than by any
  // gate. `focus: F-001` was saved, F-001 had been closed by the run that finished it, so the unfinished-only
  // filter dropped it — and a `<select>` whose value matches no option falls back to the first. The picker
  // read "The whole board" over a project the loop was still confined to.
  //
  // jsdom never had a saved focus pointing at a finished feature; Storybook's fixture has none; the browser
  // harness runs in standard mode, where this control does not render.
  it('shows a saved focus even after that feature has finished, and says it is finished', () => {
    show({ autopilotConfig: { ...EXPRESS, focus: 'F-003' } }); // F-003 is in `done`
    expect((picker() as HTMLSelectElement).value).toBe('F-003');
    const chosen = Array.from(picker().querySelectorAll('option')).find((o) => o.value === 'F-003');
    expect(chosen?.textContent).toMatch(/finished/i);
  });

  // The other reading, and it is the state the tick refuses by name: somebody archived the focused card.
  it('shows a saved focus whose card has left the board, and says so', () => {
    show({ autopilotConfig: { ...EXPRESS, focus: 'F-404' } });
    expect((picker() as HTMLSelectElement).value).toBe('F-404');
    const chosen = Array.from(picker().querySelectorAll('option')).find((o) => o.value === 'F-404');
    expect(chosen?.textContent).toMatch(/no longer on the board/i);
  });

  it('saves the focus with the whole block', async () => {
    show({ autopilotConfig: EXPRESS });
    fireEvent.change(picker(), { target: { value: 'F-002' } });
    await waitFor(() => expect(api.patchConfig).toHaveBeenCalledTimes(1));
    expect(api.patchConfig).toHaveBeenCalledWith({ autopilot: { ...EXPRESS, focus: 'F-002' } });
  });

  // CLEARING IS A DELETE, not an empty string: `focus: ''` is refused by the config's own shape check,
  // because it would confine the loop to a card whose id is the empty string.
  it('clears the focus by removing the key, never by writing an empty one', async () => {
    show({ autopilotConfig: { ...EXPRESS, focus: 'F-002' } });
    fireEvent.change(picker(), { target: { value: '' } });
    await waitFor(() => expect(api.patchConfig).toHaveBeenCalledTimes(1));
    const sent = api.patchConfig.mock.calls[0]?.[0] as { autopilot: Record<string, unknown> };
    expect('focus' in sent.autopilot).toBe(false);
  });

  // THE HALF THAT MAKES THE PICKER SAFE TO HIDE. The tick honours `focus` whatever the mode says, so a
  // focus left behind on a switch to standard would confine the loop through a control nobody can see.
  it('drops a saved focus when the project leaves express', async () => {
    show({ autopilotConfig: { ...EXPRESS, focus: 'F-002' } });
    fireEvent.click(
      within(screen.getByRole('group', { name: /how coarsely/i })).getByRole('button', {
        name: 'Standard',
      }),
    );
    await waitFor(() => expect(api.patchConfig).toHaveBeenCalledTimes(1));
    const sent = api.patchConfig.mock.calls[0]?.[0] as { autopilot: Record<string, unknown> };
    expect(sent.autopilot.mode).toBe('standard');
    expect('focus' in sent.autopilot).toBe(false);
  });
});
