// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTOPILOT } from '../src/core/autopilot.js';
import { defaultConfig } from '../src/core/config.js';

const api = vi.hoisted(() => ({ getReadiness: vi.fn() }));
vi.mock('../web/src/api.js', () => api);

const { AutopilotPanel } = await import('../web/src/components/AutopilotPanel.js');
import type { Readiness } from '../web/src/api.js';
import type { ProjectConfig } from '../web/src/shared.js';

afterEach(() => {
  cleanup();
  api.getReadiness.mockReset();
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
