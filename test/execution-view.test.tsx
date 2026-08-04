// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Accounting, RunRecord } from '../web/src/api.js';

// The dashboard fetches the project's ledger on mount. Mocked here for two reasons: the arithmetic has
// its own tests (accounting.test.ts) and does not need proving twice, and an unmocked fetch in jsdom
// fails silently — which would leave every assertion below passing over a ledger that never rendered.
const accounting = vi.hoisted(() => ({ current: null as Accounting | null }));
vi.mock('../web/src/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../web/src/api.js')>()),
  getAccounting: async () => {
    if (!accounting.current) throw new Error('no ledger in this test');
    return accounting.current;
  },
}));
import { ExecutionView } from '../web/src/components/ExecutionView.js';
import type { Card } from '../web/src/shared.js';

afterEach(cleanup);

const card = (id: string, title: string): Card =>
  ({
    id,
    title,
    board: 'engineering',
    columnSlug: 'todo',
    order: 0,
    tags: [],
    links: [],
    created: '2026-07-26',
    body: '',
    filePath: `/tmp/${id}.md`,
  }) as Card;

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  run: 'r1',
  card: 'E-010',
  board: 'engineering',
  skill: 'execute',
  status: 'running',
  started: '2026-07-26T14:30:00.000Z',
  backend: 'claude-code',
  model: 'opus',
  effort: 'high',
  mode: 'bypassPermissions',
  report: '',
  ...over,
});

const props = {
  runs: [] as RunRecord[],
  active: [] as string[],
  queued: [] as string[],
  cards: [card('E-010', 'Token store')],
  now: Date.parse('2026-07-26T14:31:00.000Z'),
  onOpenCard: vi.fn(),
  onCancel: vi.fn(),
  onResolve: vi.fn(),
};

const column = (label: string): HTMLElement => screen.getByLabelText(label);

describe('ExecutionView', () => {
  it('shows three columns, and says so when one is empty', () => {
    render(<ExecutionView {...props} />);
    for (const label of ['In progress', 'Requires attention', 'Done']) {
      expect(column(label)).toBeTruthy();
    }
    expect(screen.getAllByText('Nothing here.')).toHaveLength(3);
  });

  it('files each run under the right column, with a count', () => {
    render(
      <ExecutionView
        {...props}
        runs={[
          run({ run: 'a', status: 'running' }),
          run({ run: 'b', status: 'queued' }),
          run({ run: 'c', status: 'attention' }),
          run({ run: 'd', status: 'failed' }),
          run({ run: 'e', status: 'success' }),
        ]}
      />,
    );
    expect(column('In progress').querySelectorAll('.exec-run')).toHaveLength(2);
    expect(column('Requires attention').querySelectorAll('.exec-run')).toHaveLength(2);
    expect(column('Done').querySelectorAll('.exec-run')).toHaveLength(1);
    expect(column('Requires attention').querySelector('.exec-count')?.textContent).toBe('2');
  });

  it('names the card each run is about, and opens it', () => {
    const onOpenCard = vi.fn();
    const record = run();
    render(<ExecutionView {...props} onOpenCard={onOpenCard} runs={[record]} />);
    expect(screen.getByText('Token store')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Open E-010'));
    expect(onOpenCard.mock.calls).toEqual([[props.cards[0], record]]);
  });

  it('still lists a run whose card has gone, with nothing to open', () => {
    render(<ExecutionView {...props} cards={[]} runs={[run()]} />);
    const button = screen.getByTitle('E-010 is no longer on the board') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('(gone)')).toBeTruthy();
  });

  it('shows how long a run has been going', () => {
    // Exactly a minute in: the boundary reads as '1m 0s', not '60s'.
    render(<ExecutionView {...props} runs={[run()]} />);
    expect(screen.getByText('1m 0s')).toBeTruthy();
  });

  it('shows what a finished run cost, and nothing for one still going', () => {
    // A run in flight has reported no usage yet, so the slot stays empty rather than reading $0.
    render(
      <ExecutionView
        {...props}
        runs={[
          run({ run: 'r1', status: 'success', usage: { costUsd: 0.0421 } }),
          run({ run: 'r2', status: 'running' }),
        ]}
      />,
    );
    const costs = [...document.querySelectorAll('.exec-cost')].map((n) => n.textContent);
    expect(costs).toEqual(['$0.042']);
  });

  it('offers Stop only for runs the server is actually holding', () => {
    // A record can say `running` while the server has already moved on — after a restart, say. Only
    // the server knows what it can still stop.
    render(
      <ExecutionView
        {...props}
        active={['a']}
        queued={['b']}
        runs={[
          run({ run: 'a', status: 'running' }),
          run({ run: 'b', status: 'queued' }),
          run({ run: 'c', status: 'running' }),
        ]}
      />,
    );
    expect(document.querySelectorAll('.report-stop')).toHaveLength(2);
  });

  it('stops the run it was asked to stop', () => {
    const onCancel = vi.fn();
    const record = run({ run: 'a' });
    render(<ExecutionView {...props} active={['a']} runs={[record]} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Stop'));
    expect(onCancel.mock.calls).toEqual([[record]]);
  });

  it('files a run that has been dealt with under Done, not under attention', () => {
    // The bug: an attention run stayed in this column for ever, because a status is written once.
    render(
      <ExecutionView
        {...props}
        runs={[
          run({ run: 'answered', status: 'attention', resolved: '2026-07-26T21:30:00.000Z' }),
          run({ run: 'waiting', status: 'attention' }),
        ]}
      />,
    );
    expect(column('Requires attention').querySelectorAll('.exec-run')).toHaveLength(1);
    expect(column('Done').querySelectorAll('.exec-run')).toHaveLength(1);
  });

  it('offers Dismiss for whatever is still waiting, and nothing else', () => {
    // Including an interrupted run, which has no options anywhere else and would otherwise hold the
    // badge for ever. Not offered in the other two columns: there is nothing to decide.
    render(
      <ExecutionView
        {...props}
        active={['a']}
        runs={[
          run({ run: 'a', status: 'running' }),
          run({ run: 'b', status: 'attention' }),
          run({ run: 'c', status: 'interrupted' }),
          run({ run: 'd', status: 'success' }),
          run({ run: 'e', status: 'attention', resolved: '2026-07-26T21:30:00.000Z' }),
        ]}
      />,
    );
    expect(document.querySelectorAll('.report-dismiss')).toHaveLength(2);
    expect(column('Requires attention').querySelectorAll('.report-dismiss')).toHaveLength(2);
  });

  it('dismisses the run it was asked to dismiss', () => {
    const onResolve = vi.fn();
    const record = run({ run: 'b', status: 'attention' });
    render(<ExecutionView {...props} runs={[record]} onResolve={onResolve} />);
    fireEvent.click(screen.getByText('Dismiss'));
    expect(onResolve.mock.calls).toEqual([[record]]);
  });

  it('shows the agent’s summary, or VibeBoard’s note when there is none', () => {
    render(
      <ExecutionView
        {...props}
        runs={[
          run({ run: 'a', status: 'success', summary: 'did the thing' }),
          run({ run: 'b', status: 'failed', note: 'The agent exited with code 2.' }),
        ]}
      />,
    );
    expect(screen.getByText('did the thing')).toBeTruthy();
    expect(screen.getByText('The agent exited with code 2.')).toBeTruthy();
  });
});

// The README's admitted gap, on screen. The wording matters as much as the number: for a
// subscription-backed model the figure the backend reports is API-equivalent rather than what you were
// billed, and a project whose backend reports nothing has not spent nothing.
// The one screen a checkup or pre-flight run can appear on, and it was never rendered with one. Those
// runs carry no card and no board, so every place that printed `record.card` printed nothing at all.
describe('a run that is about the project, not a card', () => {
  const projectRun = (over: Partial<RunRecord> = {}) =>
    run({ card: undefined, board: undefined, skill: 'checkup', ...over });

  it('names the project rather than an empty card', () => {
    render(<ExecutionView {...props} runs={[projectRun({ status: 'attention' })]} />);
    expect(screen.getByText(/the project/)).toBeTruthy();
  });

  // The open button has three cases and this is the third: there is nothing to open, and the reason has
  // to distinguish "about the project" from "that card is gone".
  it('offers nothing to open, and says which of the two reasons applies', () => {
    render(<ExecutionView {...props} runs={[projectRun({ status: 'attention' })]} />);
    const button = screen.getByTitle('This run is about the project, not a card');
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('says the card is gone for a card run whose card left the board', () => {
    render(<ExecutionView {...props} runs={[run({ card: 'E-999', status: 'attention' })]} />);
    expect(screen.getByTitle('E-999 is no longer on the board')).toBeTruthy();
  });
});

describe('the project ledger on the dashboard', () => {
  afterEach(() => {
    accounting.current = null;
  });

  const ledger = (over: Partial<Accounting> = {}): Accounting => ({
    project: { runs: 3, withCost: 3, withoutCost: 0, costUsd: 1.25 },
    cards: [],
    attemptCap: 3,
    cap: { cap: 'budget', why: "Auto-pilot stops when this project's runs have cost $20." },
    ...over,
  });

  it('shows the total and which cap will stop the run', async () => {
    accounting.current = ledger();
    render(<ExecutionView {...props} />);
    expect(await screen.findByText(/\$1\.25 usage/)).toBeTruthy();
    expect(screen.getByText(/3 runs/)).toBeTruthy();
    expect(screen.getByText(/cost \$20/)).toBeTruthy();
  });

  // Absence and zero are different facts. "$0" here would be a lie about a project that has spent real
  // money on a subscription plan.
  it('says the backend reported nothing rather than showing zero', async () => {
    accounting.current = ledger({ project: { runs: 2, withCost: 0, withoutCost: 2 } });
    render(<ExecutionView {...props} />);
    expect(await screen.findByText(/usage not reported by this backend/)).toBeTruthy();
    expect(screen.queryByText(/\$0/)).toBeNull();
  });

  // The caveat only when it applies: on every screen it would be noise.
  it('says how many runs are missing from a partial total', async () => {
    accounting.current = ledger({ project: { runs: 3, withCost: 2, withoutCost: 1, costUsd: 0.5 } });
    render(<ExecutionView {...props} />);
    expect(await screen.findByText(/1 reported none/)).toBeTruthy();
  });

  it('renders nothing at all when the ledger cannot be read', async () => {
    accounting.current = null;
    render(<ExecutionView {...props} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText(/usage/)).toBeNull();
  });

  // S10: a project bounded by iterations must not be shown a dollar figure as its limit.
  it('names iterations when that is the cap that binds', async () => {
    accounting.current = ledger({
      cap: { cap: 'iterations', why: 'This project has no dollar budget, so auto-pilot stops after 250 iterations.' },
    });
    render(<ExecutionView {...props} />);
    expect(await screen.findByText(/250 iterations/)).toBeTruthy();
  });
});
