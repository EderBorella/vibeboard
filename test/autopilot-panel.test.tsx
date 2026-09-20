// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { PHASES } from '../src/core/phases.js';
import { defaultConfig } from '../src/store/project/config.js';

// The panel also asks for the ledger, to name the cap that will actually stop the run.
const api = vi.hoisted(() => ({
  acknowledgeGates: vi.fn(),
  getReadiness: vi.fn(),
  getAccounting: vi.fn(),
  // The panel carries the stop controls, which read the state and act on it.
  getAutopilotState: vi.fn(),
  softStopAutopilot: vi.fn(),
  killAutopilot: vi.fn(),
  startAutopilot: vi.fn(),
}));
vi.mock('../web/src/lib/api.js', () => api);
vi.mock('../web/src/lib/api', () => api);

const { AutopilotPanel } = await import('../web/src/organisms/autopilot/AutopilotPanel.js');

import type { Readiness } from '../web/src/lib/api.js';
import type { ProjectConfig } from '../web/src/lib/shared.js';

afterEach(() => {
  cleanup();
  api.getReadiness.mockReset();
  api.getAccounting.mockReset();
  api.getAccounting.mockRejectedValue(new Error('no ledger in this test'));
  api.startAutopilot.mockReset();
});

// Rejected by default: this file is about the routes and the blockers, and a panel that says it could
// not read the ledger is the honest thing when nothing answered.
api.getAccounting.mockRejectedValue(new Error('no ledger in this test'));
api.getAutopilotState.mockResolvedValue({
  state: 'idle',
  iteration: 0,
});

const readiness = (over: Partial<Readiness> = {}): Readiness => ({
  ok: true,
  blockers: [],
  readme: { ok: true, path: 'README.md' },
  foundation: { present: [], missing: [], ok: true },
  gates: { ok: true, count: 2 },
  smoke: { ok: true },
  phases: { problems: [], count: PHASES.filter((p) => p.skill !== undefined).length },
  unreviewedGates: [],
  ...over,
});

// The routes table used to be the "readiness has arrived" gate for every test below. With no table, the
// gate is the readiness section itself — which is what was actually being waited for, and asserting on a
// table was only ever a proxy for it.
const settled = (): Promise<HTMLElement> => screen.findByText(/Before auto-pilot can start:/i);

// The core config and the web mirror are two declarations of one shape; this cast is that seam.
const configWith = (autopilot: boolean): ProjectConfig => {
  const config = defaultConfig('T') as unknown as ProjectConfig;
  if (!autopilot) config.autopilot = undefined;
  return config;
};

// The panel no longer opens its own copy of the state: App owns it and passes it down, so every render
// here supplies it. `getAutopilotState` is still mocked because other components in the tree use it.
const panel = (config: ProjectConfig, over: Partial<PanelProps> = {}) => (
  <AutopilotPanel config={config} autopilot={null} onAutopilotChanged={() => {}} {...over} />
);
type PanelProps = Parameters<typeof AutopilotPanel>[0];

// C2's minimal control. An endpoint nobody can press is a feature that does not exist — and a control whose
// refusal is invisible is the dead end this design refuses to ship, which is what most of these are about.
describe('the start control', () => {
  const state = (over: Partial<import('../web/src/lib/api.js').AutopilotState> = {}) => ({
    state: 'idle' as const,
    iteration: 0,
    ...over,
  });

  it('starts the loop when pressed', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    api.startAutopilot.mockResolvedValue({ state: state({ state: 'running' }) });
    const changed = vi.fn();
    render(panel(configWith(true), { autopilot: state(), onAutopilotChanged: changed }));
    fireEvent.click(await screen.findByRole('button', { name: /start auto-pilot/i }));
    await waitFor(() => expect(api.startAutopilot).toHaveBeenCalled());
    // And the panel asks for the new state rather than assuming it: the loop writes counters this render
    // knows nothing about.
    await waitFor(() => expect(changed).toHaveBeenCalled());
  });

  it('shows the server’s refusal verbatim, because it names what to fix', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    api.startAutopilot.mockRejectedValue(
      new Error('Auto-pilot is not ready to start here: foundation/TESTING.md declares no `smoke:` command.'),
    );
    render(panel(configWith(true), { autopilot: state() }));
    fireEvent.click(await screen.findByRole('button', { name: /start auto-pilot/i }));
    expect(await screen.findByText(/declares no `smoke:` command/)).toBeTruthy();
  });

  it('is disabled while it is already running, and says how far it has got', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    render(panel(configWith(true), { autopilot: state({ state: 'running', iteration: 7 }) }));
    const button = await screen.findByRole('button', { name: /start auto-pilot/i });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('ap-progress').textContent).toContain('7 dispatches');
  });

  it('is disabled while halted, and points at the way back', async () => {
    // A halt is left deliberately, from the overlay — not by pressing start again.
    api.getReadiness.mockResolvedValue(readiness());
    render(panel(configWith(true), { autopilot: state({ state: 'halted', reason: 'killed' }) }));
    const button = await screen.findByRole('button', { name: /start auto-pilot/i });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/Restart it from the overlay/)).toBeTruthy();
  });

  // NOT disabled when the project is not ready, deliberately: a disabled button with no explanation is the
  // dead end, and pressing it is how a person learns what is missing.
  it('can still be pressed when the project is not ready', async () => {
    api.getReadiness.mockResolvedValue(readiness({ ok: false, blockers: ['This project has no README.'] }));
    api.startAutopilot.mockRejectedValue(new Error('Auto-pilot is not ready to start here: no README.'));
    render(panel(configWith(true), { autopilot: state() }));
    const button = await screen.findByRole('button', { name: /start auto-pilot/i });
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    expect(await screen.findByText(/not ready to start here/)).toBeTruthy();
  });

  it('says nothing about progress before it has started', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    render(panel(configWith(true), { autopilot: state() }));
    await screen.findByRole('button', { name: /start auto-pilot/i });
    expect(screen.queryByTestId('ap-progress')).toBeNull();
  });
});

describe('the auto-pilot panel', () => {
  // There is no table any more, and its absence is the claim: a lifecycle a person can edit is a lie
  // waiting to happen (ruling 52), so the panel says the machine is fixed rather than showing a table
  // that could disagree with the code. A stale table left rendering half a retired config would be
  // worse than none, which is what this asserts.
  it('says the lifecycle is fixed instead of rendering a table that could disagree with the code', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    render(panel(configWith(true)));
    expect(await screen.findByText(/The lifecycle is fixed/i)).toBeTruthy();
    expect(screen.queryAllByRole('row')).toEqual([]);
    expect(screen.queryByText('derive-features')).toBeNull();
  });

  it('states what is blocking auto-pilot in words, not as a red dot', async () => {
    api.getReadiness.mockResolvedValue(
      readiness({
        ok: false,
        blockers: [
          'This project has no README. Auto-pilot derives the whole feature list from it.',
          'foundation/CODE-QUALITY.md has not been written yet.',
        ],
      }),
    );
    render(panel(configWith(true)));
    expect(await screen.findByText(/has no README/)).toBeTruthy();
    expect(screen.getByText(/CODE-QUALITY\.md has not been written yet/)).toBeTruthy();
  });

  it('says so plainly when there is nothing in the way', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    render(panel(configWith(true)));
    expect(await screen.findByText(/Everything auto-pilot needs is in place/)).toBeTruthy();
  });

  // A panel that says "ready" because the request failed is the worst of the three outcomes: it is
  // the fail-open the rest of this slice is built to avoid.
  it('does not claim readiness when it could not ask', async () => {
    api.getReadiness.mockRejectedValue(new Error('nope'));
    render(panel(configWith(true)));
    expect(await screen.findByText(/Could not read this project’s readiness/)).toBeTruthy();
    expect(screen.queryByText(/Everything auto-pilot needs is in place/)).toBeNull();
  });

  it('says the project predates the lifecycle, and asks nothing of the server', async () => {
    render(panel(configWith(false)));
    expect(await screen.findByText(/no autopilot block/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

// The caps are editable BECAUSE they are now enforced. Until slice D they were deliberately read-only:
// a budget dial wired to nothing is what AutoGPT and AgentGPT both shipped.
describe('the caps', () => {
  const field = (label: string): HTMLInputElement =>
    screen.getByText(label).closest('label')?.querySelector('input') as HTMLInputElement;

  it('are seeded from the project’s own configuration', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    const config = configWith(true);
    config.autopilot = { ...DEFAULT_AUTOPILOT, budgetUsd: 42, maxIterations: 7, attemptCap: 2 };
    render(panel(config));
    await settled();
    expect(field('Budget (USD)').value).toBe('42');
    expect(field('Max dispatches').value).toBe('7');
    expect(field('Attempts per card').value).toBe('2');
  });

  // 1800000 in a text box is unreadable, and the value stored is milliseconds.
  it('show the run timeout in minutes and report it in milliseconds', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    const onCaps = vi.fn();
    render(panel(configWith(true), { onCaps: onCaps }));
    await settled();
    expect(field('Run timeout (minutes)').value).toBe('30');
    fireEvent.change(field('Run timeout (minutes)'), { target: { value: '5' } });
    expect(onCaps).toHaveBeenCalledWith(expect.objectContaining({ runTimeoutMs: 300_000 }));
  });

  // A box that cannot express an invalid value needs no refusal. `Number('')` is NaN, JSON has no NaN,
  // so an emptied box reached the server as `null` — and `min={0}` on the input does not stop a typed
  // `-5`. Asserted on what the panel REPORTS, because that is what gets sent.
  it.each([
    ['Budget (USD)', '', 'budgetUsd', 0],
    ['Budget (USD)', '-5', 'budgetUsd', 0],
    ['Max dispatches', '', 'maxIterations', 1],
    ['Max dispatches', '-3', 'maxIterations', 1],
    ['Attempts per card', '', 'attemptCap', 1],
    ['Run timeout (minutes)', '', 'runTimeoutMs', 60_000],
  ])('clamps %s of "%s" to the lowest value it allows', async (label, typed, key, expected) => {
    api.getReadiness.mockResolvedValue(readiness());
    const onCaps = vi.fn();
    render(panel(configWith(true), { onCaps: onCaps }));
    await settled();
    fireEvent.change(field(label), { target: { value: typed } });
    expect(onCaps).toHaveBeenLastCalledWith(expect.objectContaining({ [key]: expected }));
  });

  it('report every edited cap together, so one save carries them all', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    const onCaps = vi.fn();
    render(panel(configWith(true), { onCaps: onCaps }));
    await settled();
    fireEvent.change(field('Budget (USD)'), { target: { value: '9' } });
    fireEvent.change(field('Attempts per card'), { target: { value: '4' } });
    expect(onCaps).toHaveBeenLastCalledWith(expect.objectContaining({ budgetUsd: 9, attemptCap: 4 }));
  });

  // WHAT EACH CAP SAYS BESIDES ITS VALUE, pinned for Phase 9 of docs/design-system.md before `Field`
  // took these six. The clamping above is asserted on what the panel REPORTS; these are the attributes
  // the browser itself acts on, and an attribute is what a migration drops silently.
  it.each([
    ['Budget (USD)', '0', '1'],
    // Ten, not one: the premise here was that every cap stepped by one, and the code was right — a
    // dispatch cap is adjusted in tens. The expectation moved rather than the step.
    ['Max dispatches', '1', '10'],
    ['Attempts per card', '1', '1'],
    ['Run timeout (minutes)', '1', '5'],
  ])('%s is a number box with a floor of %s and a step of %s', async (label, min, step) => {
    api.getReadiness.mockResolvedValue(readiness());
    render(panel(configWith(true)));
    await settled();
    expect(field(label).type).toBe('number');
    expect(field(label).min).toBe(min);
    expect(field(label).step).toBe(step);
  });

  // Every cap carries a sentence saying what it stops, and the run timeout says it too. Six labels and
  // six hints, so a hint lost in the migration is a case here rather than a thing nobody notices.
  it('each carry the sentence that says what they stop', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    render(panel(configWith(true)));
    await settled();
    expect(screen.getByText(/Zero means no dollar budget/)).toBeTruthy();
    expect(screen.getByText(/recorded as failed, which burns an attempt/)).toBeTruthy();
  });

  // A budget of zero is a real setting — no dollar budget — and must survive being typed.
  it('accept a budget of zero', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    const onCaps = vi.fn();
    render(panel(configWith(true), { onCaps: onCaps }));
    await settled();
    fireEvent.change(field('Budget (USD)'), { target: { value: '0' } });
    expect(onCaps).toHaveBeenLastCalledWith(expect.objectContaining({ budgetUsd: 0 }));
  });

  // S10, on screen: which cap will actually stop this project, in words.
  it('name the governing cap when the ledger says which it is', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    api.getAccounting.mockResolvedValue({
      project: { runs: 1, withCost: 0, withoutCost: 1 },
      cards: [],
      attemptCap: 3,
      cap: { cap: 'iterations', why: 'No run has reported a cost yet, so the dollar budget cannot bind.' },
    });
    render(panel(configWith(true)));
    expect(await screen.findByText(/dollar budget cannot bind/)).toBeTruthy();
  });

  it('fall back to a plain sentence when the ledger cannot be read', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    render(panel(configWith(true)));
    expect(await screen.findByText(/Whichever of these is reached first/)).toBeTruthy();
  });
});

// Two buttons rather than one with a modifier: one of these is reversible and the other kills work in
// flight, and that difference should not live in a checkbox.
describe('the stop controls', () => {
  const button = (label: string): HTMLButtonElement =>
    screen.getByText(label).closest('button') as HTMLButtonElement;

  // The state is PASSED IN now, not fetched here: the panel used to call `useAutopilot(0)`, which
  // hard-coded App's project counter and opened a second socket for the tab. That the panel makes no
  // such call is asserted below, because a prop that is merely also supplied would hide a regression.
  const withState = async (state: string) => {
    api.getReadiness.mockResolvedValue(readiness());
    render(
      panel(configWith(true), {
        autopilot: { state, iteration: 0 } as never,
      }),
    );
    await settled();
  };

  // The regression this fix exists to prevent, asserted rather than assumed. `socketFor` is a
  // single-entry last-write-wins cache keyed on App's project counter, so a second `useAutopilot` call
  // inside Settings replaced the tab's socket with a new one — the exact invariant ws.ts's header says
  // it exists to hold. A panel that fetches nothing cannot do that.
  it('opens no state of its own, so the tab keeps one socket', async () => {
    await withState('running');
    expect(api.getAutopilotState).not.toHaveBeenCalled();
  });

  it('offers no soft stop when there is nothing to stop', async () => {
    await withState('idle');
    await waitFor(() => expect(button('Soft stop').disabled).toBe(true));
  });

  it('offers the soft stop while auto-pilot is running', async () => {
    await withState('running');
    await waitFor(() => expect(button('Soft stop').disabled).toBe(false));
    fireEvent.click(button('Soft stop'));
    await waitFor(() => expect(api.softStopAutopilot).toHaveBeenCalled());
  });

  // Already halted: there is nothing left to kill, and the way back is the overlay's button.
  it('offers no emergency stop on a halted project', async () => {
    await withState('halted');
    await waitFor(() => expect(button('Emergency stop').disabled).toBe(true));
  });

  // It kills every agent in the project. Asking first is the point, and nothing may happen before the
  // question is answered.
  it('asks before the emergency stop, and kills nothing while the question is open', async () => {
    await withState('running');
    fireEvent.click(button('Emergency stop'));
    expect(await screen.findByText(/Kill everything in this project\?/)).toBeTruthy();
    expect(api.killAutopilot).not.toHaveBeenCalled();
  });

  it('kills once the question is answered', async () => {
    api.killAutopilot.mockResolvedValue({ state: { state: 'halted' } });
    await withState('running');
    fireEvent.click(button('Emergency stop'));
    fireEvent.click(await screen.findByText('Kill everything'));
    await waitFor(() => expect(api.killAutopilot).toHaveBeenCalled());
  });

  it('shows a refusal rather than swallowing it', async () => {
    api.softStopAutopilot.mockRejectedValue(new Error('This project is halted. Restart it first.'));
    await withState('running');
    fireEvent.click(button('Soft stop'));
    expect(await screen.findByText(/Restart it first/)).toBeTruthy();
  });
});

// The critic's bar, on screen. It decides every card that has nothing runnable to check — the weaker
// half of this design by its own admission — so a number hidden in code would be a decision nobody
// could argue with.
// NO CRITIC THRESHOLD FIELD. Its four cases went with the number (decision 40), and the finding they
// recorded is worth keeping in one sentence because it applies to any field added here later: falling back
// to `min` is right for a CAP and wrong for a BAR. A smaller budget stops the run sooner; the weakest
// allowed bar passes work nobody judged. This panel now edits caps only, and `edit` above clamps them
// upward to their minimum for exactly that reason.

describe('the gate acknowledgement, in Settings', () => {
  // This panel has its own Start button, listed the blocker, and had NO way to clear it — while the only
  // working control sat behind this very modal. A user got stuck in exactly that gap.
  it('offers the button when an agent rewrote a gate document', async () => {
    api.getReadiness.mockResolvedValue(
      readiness({
        ok: false,
        blockers: ['foundation/CODE-QUALITY.md was rewritten by an agent and nobody has read it.'],
        unreviewedGates: ['CODE-QUALITY.md'],
      }),
    );
    render(panel(configWith(true), { autopilot: null }));
    expect(await screen.findByTestId('ap-panel-review-gates')).toBeTruthy();
  });

  it('clears the flag and refreshes, so the blocker goes with it', async () => {
    api.getReadiness.mockResolvedValue(
      readiness({ ok: false, blockers: ['rewritten'], unreviewedGates: ['CODE-QUALITY.md'] }),
    );
    api.acknowledgeGates.mockResolvedValue({ ok: true });
    render(panel(configWith(true), { autopilot: null }));
    fireEvent.click(await screen.findByTestId('ap-panel-review-gates'));
    await waitFor(() => expect(api.acknowledgeGates).toHaveBeenCalled());
  });

  it('is absent when no gate document is waiting — including for other blockers', async () => {
    api.getReadiness.mockResolvedValue(
      readiness({ ok: false, blockers: ['README.md is empty.'], unreviewedGates: [] }),
    );
    render(panel(configWith(true), { autopilot: null }));
    await waitFor(() => expect(api.getReadiness).toHaveBeenCalled());
    expect(screen.queryByTestId('ap-panel-review-gates')).toBeNull();
  });
});

// THE WAY BACK INTO SETUP, BESIDE THE WALL YOU HIT WITHOUT IT. Somebody who skipped the wizard meets
// these blockers the moment they try to start auto-pilot — most of them are documents the setup
// assistant would have written — so the offer to finish belongs here and not only on the first screen.
describe('finishing setup from the readiness wall', () => {
  it('offers the way back, and hands it to the shell to open', async () => {
    api.getReadiness.mockResolvedValue(
      readiness({ ok: false, blockers: ['foundation/TESTING.md has not been written yet.'] }),
    );
    const resume = vi.fn();
    render(panel(configWith(true), { setupPending: true, onResumeSetup: resume }));

    fireEvent.click(await screen.findByRole('button', { name: 'Finish setting up' }));
    expect(resume).toHaveBeenCalledTimes(1);
    // The blockers it stands beside are still the answer to "what is missing"; this is the shortcut.
    expect(screen.getByText(/TESTING\.md has not been written yet/)).toBeTruthy();
  });

  it('says nothing on a project with no setup waiting', async () => {
    // The flag is the FILE's answer, not this panel's guess: a project whose setup was finished or
    // abandoned has nothing to go back to, and a button that re-opened the wizard there would be
    // re-offering exactly what "Stop offering this" was pressed to end.
    api.getReadiness.mockResolvedValue(readiness({ ok: false, blockers: ['This project has no README.'] }));
    render(panel(configWith(true), { setupPending: false, onResumeSetup: vi.fn() }));

    await screen.findByText(/has no README/);
    expect(screen.queryByRole('button', { name: 'Finish setting up' })).toBeNull();
  });
});
