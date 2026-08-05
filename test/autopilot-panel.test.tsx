// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { defaultConfig } from '../src/core/config.js';

// The panel also asks for the ledger, to name the cap that will actually stop the run.
const api = vi.hoisted(() => ({
  getReadiness: vi.fn(),
  getAccounting: vi.fn(),
  // The panel carries the stop controls, which read the state and act on it.
  getAutopilotState: vi.fn(),
  softStopAutopilot: vi.fn(),
  killAutopilot: vi.fn(),
}));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { AutopilotPanel } = await import('../web/src/components/AutopilotPanel.js');
import type { Readiness } from '../web/src/api.js';
import type { ProjectConfig } from '../web/src/shared.js';

afterEach(() => {
  cleanup();
  api.getReadiness.mockReset();
  api.getAccounting.mockReset();
  api.getAccounting.mockRejectedValue(new Error('no ledger in this test'));
});

// Rejected by default: this file is about the routes and the blockers, and a panel that says it could
// not read the ledger is the honest thing when nothing answered.
api.getAccounting.mockRejectedValue(new Error('no ledger in this test'));
api.getAutopilotState.mockResolvedValue({
  state: 'idle',
  iteration: 0,
  dispatchesSinceCheckup: 0,
  needsCheckup: false,
});

const readiness = (over: Partial<Readiness> = {}): Readiness => ({
  ok: true,
  blockers: [],
  readme: { ok: true, path: 'README.md' },
  foundation: { present: [], missing: [], ok: true },
  gates: { ok: true, count: 2 },
  smoke: { ok: true },
  routes: { problems: [], count: DEFAULT_AUTOPILOT.routes.length },
  ...over,
});

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

describe('the auto-pilot panel', () => {

  it('renders every route, so the lifecycle can be read off the screen', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    render(panel(configWith(true)));
    // A row per route plus the header: a table showing SOME of the lifecycle would be worse than
    // none, because the missing phase is the one nobody would think to look for.
    expect(await screen.findAllByRole('row')).toHaveLength(DEFAULT_AUTOPILOT.routes.length + 1);
    expect(screen.getByText('derive-features')).toBeTruthy();
    expect(screen.getByText('close-out')).toBeTruthy();
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
    await screen.findAllByRole('row');
    expect(field('Budget (USD)').value).toBe('42');
    expect(field('Max dispatches').value).toBe('7');
    expect(field('Attempts per card').value).toBe('2');
  });

  // 1800000 in a text box is unreadable, and the value stored is milliseconds.
  it('show the run timeout in minutes and report it in milliseconds', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    const onCaps = vi.fn();
    render(panel(configWith(true), { onCaps: onCaps }));
    await screen.findAllByRole('row');
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
    await screen.findAllByRole('row');
    fireEvent.change(field(label), { target: { value: typed } });
    expect(onCaps).toHaveBeenLastCalledWith(expect.objectContaining({ [key]: expected }));
  });

  it('report every edited cap together, so one save carries them all', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    const onCaps = vi.fn();
    render(panel(configWith(true), { onCaps: onCaps }));
    await screen.findAllByRole('row');
    fireEvent.change(field('Budget (USD)'), { target: { value: '9' } });
    fireEvent.change(field('Attempts per card'), { target: { value: '4' } });
    expect(onCaps).toHaveBeenLastCalledWith(expect.objectContaining({ budgetUsd: 9, attemptCap: 4 }));
  });

  // A budget of zero is a real setting — no dollar budget — and must survive being typed.
  it('accept a budget of zero', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    const onCaps = vi.fn();
    render(panel(configWith(true), { onCaps: onCaps }));
    await screen.findAllByRole('row');
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
        autopilot: { state, iteration: 0, dispatchesSinceCheckup: 0, needsCheckup: false } as never,
      }),
    );
    await screen.findAllByRole('row');
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
describe('the critic threshold field', () => {
  const field = (label: string): HTMLInputElement =>
    screen.getByText(label).closest('label')?.querySelector('input') as HTMLInputElement;

  it('shows the project’s value and reports an edit up', async () => {
    const onCaps = vi.fn();
    api.getReadiness.mockResolvedValue(readiness());
    render(panel(configWith(true), { onCaps }));
    await screen.findAllByRole('row');
    const box = field('Critic passes at');
    expect(box.value).toBe('0.6');
    fireEvent.change(box, { target: { value: '0.8' } });
    expect(onCaps).toHaveBeenCalledWith(expect.objectContaining({ criticThreshold: 0.8 }));
  });

  // A fraction, so `min` alone is not enough: a typed 5 is a bar no score can clear, which blocks every
  // critic-verified card. Clamped in the box rather than refused by the server, like every other cap.
  it('cannot express a threshold above one, or an empty box', async () => {
    const onCaps = vi.fn();
    api.getReadiness.mockResolvedValue(readiness());
    render(panel(configWith(true), { onCaps }));
    await screen.findAllByRole('row');
    const box = field('Critic passes at');
    fireEvent.change(box, { target: { value: '5' } });
    expect(onCaps).toHaveBeenLastCalledWith(expect.objectContaining({ criticThreshold: 1 }));
    fireEvent.change(box, { target: { value: '' } });
    expect(onCaps).toHaveBeenLastCalledWith(expect.objectContaining({ criticThreshold: 0.05 }));
  });
});
