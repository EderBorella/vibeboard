// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { defaultConfig } from '../src/core/config.js';

// The panel also asks for the ledger, to name the cap that will actually stop the run.
const api = vi.hoisted(() => ({ getReadiness: vi.fn(), getAccounting: vi.fn() }));
vi.mock('../web/src/api.js', () => api);

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

describe('the auto-pilot panel', () => {
  it('renders every route, so the lifecycle can be read off the screen', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    render(<AutopilotPanel config={configWith(true)} />);
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
    render(<AutopilotPanel config={configWith(true)} />);
    expect(await screen.findByText(/has no README/)).toBeTruthy();
    expect(screen.getByText(/CODE-QUALITY\.md has not been written yet/)).toBeTruthy();
  });

  it('says so plainly when there is nothing in the way', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    render(<AutopilotPanel config={configWith(true)} />);
    expect(await screen.findByText(/Everything auto-pilot needs is in place/)).toBeTruthy();
  });

  // A panel that says "ready" because the request failed is the worst of the three outcomes: it is
  // the fail-open the rest of this slice is built to avoid.
  it('does not claim readiness when it could not ask', async () => {
    api.getReadiness.mockRejectedValue(new Error('nope'));
    render(<AutopilotPanel config={configWith(true)} />);
    expect(await screen.findByText(/Could not read this project’s readiness/)).toBeTruthy();
    expect(screen.queryByText(/Everything auto-pilot needs is in place/)).toBeNull();
  });

  it('says the project predates the lifecycle, and asks nothing of the server', async () => {
    render(<AutopilotPanel config={configWith(false)} />);
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
    render(<AutopilotPanel config={config} />);
    await screen.findAllByRole('row');
    expect(field('Budget (USD)').value).toBe('42');
    expect(field('Max dispatches').value).toBe('7');
    expect(field('Attempts per card').value).toBe('2');
  });

  // 1800000 in a text box is unreadable, and the value stored is milliseconds.
  it('show the run timeout in minutes and report it in milliseconds', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    const onCaps = vi.fn();
    render(<AutopilotPanel config={configWith(true)} onCaps={onCaps} />);
    await screen.findAllByRole('row');
    expect(field('Run timeout (minutes)').value).toBe('30');
    fireEvent.change(field('Run timeout (minutes)'), { target: { value: '5' } });
    expect(onCaps).toHaveBeenCalledWith(expect.objectContaining({ runTimeoutMs: 300_000 }));
  });

  it('report every edited cap together, so one save carries them all', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    const onCaps = vi.fn();
    render(<AutopilotPanel config={configWith(true)} onCaps={onCaps} />);
    await screen.findAllByRole('row');
    fireEvent.change(field('Budget (USD)'), { target: { value: '9' } });
    fireEvent.change(field('Attempts per card'), { target: { value: '4' } });
    expect(onCaps).toHaveBeenLastCalledWith(expect.objectContaining({ budgetUsd: 9, attemptCap: 4 }));
  });

  // A budget of zero is a real setting — no dollar budget — and must survive being typed.
  it('accept a budget of zero', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    const onCaps = vi.fn();
    render(<AutopilotPanel config={configWith(true)} onCaps={onCaps} />);
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
    render(<AutopilotPanel config={configWith(true)} />);
    expect(await screen.findByText(/dollar budget cannot bind/)).toBeTruthy();
  });

  it('fall back to a plain sentence when the ledger cannot be read', async () => {
    api.getReadiness.mockResolvedValue(readiness());
    render(<AutopilotPanel config={configWith(true)} />);
    expect(await screen.findByText(/Whichever of these is reached first/)).toBeTruthy();
  });
});
