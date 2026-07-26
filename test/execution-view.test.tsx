// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunRecord } from '../web/src/api.js';
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
