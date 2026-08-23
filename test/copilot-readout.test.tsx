// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatCost } from '../web/src/lib/format.js';
import { CopilotReadout } from '../web/src/organisms/copilot/CopilotReadout.js';
import type { CopilotStats } from '../web/src/organisms/copilot/useCopilot.js';

afterEach(cleanup);

const stats = (over: Partial<CopilotStats> = {}): CopilotStats => ({
  costUsd: 0.5,
  turns: 3,
  lastDurationMs: 1200,
  contextTokens: 12_000,
  ...over,
});

// The dock and the runs pane are two readouts of the same number, and they used to disagree: $0.50
// rendered as `$0.5000` here and `$0.500` there. One formatter, so a person comparing the two screens
// is comparing amounts rather than notations.
describe('the copilot readout', () => {
  it('renders a cost the same way the runs pane does', () => {
    render(<CopilotReadout stats={stats()} budget={200_000} />);
    expect(screen.getByTitle('cumulative session cost').textContent).toBe(formatCost(0.5));
  });

  // `costUsd` is declared `number` and arrives from the wire: a result event that reports no cost makes
  // the running total NaN, and an unguarded `toFixed` renders that as a dollar amount.
  it('shows no amount at all when the total is not a figure', () => {
    render(<CopilotReadout stats={stats({ costUsd: Number.NaN })} budget={200_000} />);
    expect(screen.getByTitle('cumulative session cost').textContent).not.toContain('$');
  });

  // The same trust the runs pane's guard was written for: the mirror declares a number and JSON can
  // carry `null`, which `toFixed` throws on — inside render, taking the dock with it.
  it('does not throw on a cost the wire could not carry', () => {
    expect(() =>
      render(<CopilotReadout stats={stats({ costUsd: null as unknown as number })} budget={200_000} />),
    ).not.toThrow();
  });
});
