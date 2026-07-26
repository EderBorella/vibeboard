// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunRecord } from '../web/src/api.js';
import { ActiveReport } from '../web/src/components/ActiveReport.js';
import { CardReports } from '../web/src/components/CardReports.js';
import { ReportPane } from '../web/src/components/ReportPane.js';
import type { Card, ProjectConfig } from '../web/src/shared.js';

afterEach(cleanup);

const config: ProjectConfig = {
  name: 'T',
  boards: {
    features: { columns: ['Backlog', 'Done'] },
    product: { columns: ['Backlog', 'Done'] },
    engineering: { columns: ['Todo', 'In Progress', 'Review', 'Done'] },
  },
  miniatureChars: 40,
  idPadding: 3,
  keepChats: 20,
  contextBudget: 200_000,
  maxConcurrentRuns: 3,
  copilot: { backend: 'claude-code', backends: {} },
};

const card = (over: Partial<Card> = {}): Card =>
  ({
    id: 'E-010',
    title: 'Token store',
    board: 'engineering',
    columnSlug: 'todo',
    order: 0,
    tags: [],
    links: [],
    created: '2026-07-26',
    body: '',
    filePath: '/tmp/E-010.md',
    ...over,
  }) as Card;

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  run: '20260726-143012-a1b2',
  card: 'E-010',
  board: 'engineering',
  skill: 'execute',
  status: 'success',
  started: '2026-07-26T14:30:12.000Z',
  finished: '2026-07-26T14:41:55.000Z',
  backend: 'claude-code',
  model: 'opus',
  effort: 'high',
  mode: 'bypassPermissions',
  report: '## What I did\n\nAll of it.',
  ...over,
});

describe('CardReports', () => {
  it('renders nothing at all for a card that has never been run', () => {
    const { container } = render(<CardReports runs={[]} onOpen={vi.fn()} onCancel={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('lists newest first, whatever order the store gave them', () => {
    // The store lists a card oldest-first (chronological); the reader wants the latest at the top.
    render(
      <CardReports
        runs={[run({ run: 'a', skill: 'research' }), run({ run: 'b', skill: 'execute' })]}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect([...document.querySelectorAll('.report-skill')].map((e) => e.textContent)).toEqual([
      'execute',
      'research',
    ]);
  });

  it('says what each status means to a person, not what it is called', () => {
    render(
      <CardReports
        runs={[
          run({ run: 'a', status: 'attention' }),
          run({ run: 'b', status: 'success' }),
          run({ run: 'c', status: 'failed' }),
          run({ run: 'd', status: 'interrupted' }),
        ]}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect([...document.querySelectorAll('.report-chip')].map((e) => e.textContent)).toEqual([
      'Interrupted',
      'Failed',
      'Done',
      'Needs you',
    ]);
  });

  it('shows the summary, or VibeBoard’s note when the agent left none', () => {
    render(
      <CardReports
        runs={[
          run({ run: 'a', summary: 'did the thing' }),
          run({ run: 'b', summary: undefined, note: 'The agent finished without writing a report.' }),
        ]}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('did the thing')).toBeTruthy();
    expect(screen.getByText('The agent finished without writing a report.')).toBeTruthy();
  });

  it('opens the report it was clicked on', () => {
    const onOpen = vi.fn();
    const first = run({ run: 'a' });
    render(<CardReports runs={[first, run({ run: 'b' })]} onOpen={onOpen} onCancel={vi.fn()} />);
    fireEvent.click(document.querySelectorAll<HTMLElement>('.report-open')[1]);
    expect(onOpen.mock.calls).toEqual([[first]]);
  });

  it('offers Stop only while a run is in flight', () => {
    render(
      <CardReports
        runs={[run({ run: 'a', status: 'running' }), run({ run: 'b', status: 'success' })]}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.querySelectorAll('.report-stop')).toHaveLength(1);
  });

  it('stops the run it was asked to stop', () => {
    const onCancel = vi.fn();
    const live = run({ run: 'a', status: 'running' });
    render(<CardReports runs={[live]} onOpen={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Stop'));
    expect(onCancel.mock.calls).toEqual([[live]]);
  });
});

describe('ReportPane', () => {
  const props = {
    card: card(),
    config,
    createdCards: [] as Card[],
    onOpenCard: vi.fn(),
    onMove: vi.fn(),
    onBack: vi.fn(),
    onContinue: vi.fn(),
    canContinue: true,
  };

  it('renders the agent’s report as markdown', () => {
    const { container } = render(<ReportPane {...props} record={run()} />);
    expect(container.querySelector('.report-body h2')?.textContent).toBe('What I did');
  });

  it('says what it was run with, so a report can be read against its dispatch', () => {
    render(<ReportPane {...props} record={run({ prompt: 'only the token store' })} />);
    expect(screen.getByText('opus · high · bypassPermissions')).toBeTruthy();
    expect(screen.getByText(/only the token store/)).toBeTruthy();
  });

  it('says a run left no report rather than showing an empty pane', () => {
    render(
      <ReportPane
        {...props}
        record={run({ status: 'failed', report: '   ', note: 'The agent exited with code 2.' })}
      />,
    );
    expect(screen.getByText('This run left no report.')).toBeTruthy();
    expect(screen.getByText('The agent exited with code 2.')).toBeTruthy();
  });

  it('links only the created cards that actually exist', () => {
    // An id the agent claims to have created may not be there; a dead link is worse than none.
    const created = card({ id: 'E-041', title: 'Split one' });
    render(
      <ReportPane {...props} record={run({ created: ['E-041', 'E-999'] })} createdCards={[created]} />,
    );
    expect(screen.getByTitle('Open E-041')).toBeTruthy();
    expect(screen.queryByTitle('Open E-999')).toBeNull();
  });

  it('opens a created card in the dock', () => {
    const onOpenCard = vi.fn();
    const created = card({ id: 'E-041' });
    render(
      <ReportPane
        {...props}
        onOpenCard={onOpenCard}
        record={run({ created: ['E-041'] })}
        createdCards={[created]}
      />,
    );
    fireEvent.click(screen.getByTitle('Open E-041'));
    expect(onOpenCard.mock.calls).toEqual([[created]]);
  });

  it('defaults the move to a Review column where the board has one', () => {
    render(<ReportPane {...props} record={run()} />);
    expect((screen.getByLabelText('Column to move the card to') as HTMLSelectElement).value).toBe(
      'review',
    );
  });

  it('preselects nothing on a board with no Review column', () => {
    // Features and product have no Review by default, and guessing another column would move a card
    // somewhere nobody asked for.
    render(
      <ReportPane
        {...props}
        card={card({ board: 'product', columnSlug: 'backlog' })}
        record={run({ board: 'product' })}
      />,
    );
    const select = screen.getByLabelText('Column to move the card to') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect((screen.getByText('Move card') as HTMLButtonElement).disabled).toBe(true);
  });

  it('moves only when asked, and only to a different column', () => {
    const onMove = vi.fn();
    render(<ReportPane {...props} onMove={onMove} record={run()} />);
    expect(onMove).not.toHaveBeenCalled(); // nothing happens just because a run succeeded

    fireEvent.click(screen.getByText('Move card'));
    expect(onMove.mock.calls).toEqual([['review']]);

    // The card's own column is not a move.
    fireEvent.change(screen.getByLabelText('Column to move the card to'), {
      target: { value: 'todo' },
    });
    expect((screen.getByText('Move card') as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers options, not a move, for a run that needs attention', () => {
    render(
      <ReportPane
        {...props}
        record={run({ status: 'attention', options: ['Split it in two'], outcome: 'attention' })}
      />,
    );
    expect(screen.getByLabelText('What next')).toBeTruthy();
    expect(screen.getByText('Split it in two')).toBeTruthy();
    expect(screen.queryByText('Move card')).toBeNull();
  });

  it('offers options for a failed run too — it also needs deciding', () => {
    render(<ReportPane {...props} record={run({ status: 'failed', report: '' })} />);
    expect(screen.getByLabelText('What next')).toBeTruthy();
  });

  it('offers neither options nor a move for a run that was stopped', () => {
    // Nothing to decide: dispatch again when you want to.
    render(<ReportPane {...props} record={run({ status: 'cancelled', report: '' })} />);
    expect(screen.queryByLabelText('What next')).toBeNull();
    expect(screen.queryByText('Move card')).toBeNull();
  });

  it('passes a chosen option up as the prompt to continue with', () => {
    const onContinue = vi.fn();
    render(
      <ReportPane
        {...props}
        onContinue={onContinue}
        record={run({ status: 'attention', options: ['Do the store only'] })}
      />,
    );
    fireEvent.click(screen.getByText('Do the store only'));
    expect(onContinue.mock.calls).toEqual([['Do the store only']]);
  });

  it('closes through the same handler that moves, since closing IS a move', () => {
    const onMove = vi.fn();
    render(<ReportPane {...props} onMove={onMove} record={run({ status: 'attention' })} />);
    fireEvent.click(screen.getByText('Close card'));
    expect(onMove.mock.calls).toEqual([['done']]);
  });

  it('offers no move at all for a run that did not succeed', () => {
    render(<ReportPane {...props} record={run({ status: 'attention' })} />);
    expect(screen.queryByText('Move card')).toBeNull();
  });

  it('goes back to the card', () => {
    const onBack = vi.fn();
    render(<ReportPane {...props} onBack={onBack} record={run()} />);
    fireEvent.click(screen.getByTitle('Back to the card'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('ActiveReport', () => {
  const skills = [
    {
      slug: 'execute',
      path: '.claude/skills/execute/SKILL.md',
      name: 'Execute',
      description: 'Implement the card',
      boards: [],
      columns: [],
      prompt: 'p',
    },
  ];
  const props = {
    card: card(),
    config,
    live: [card(), card({ id: 'E-041', title: 'Split one' })],
    skills,
    onOpenCard: vi.fn(),
    onMove: vi.fn(),
    onBack: vi.fn(),
    onContinue: vi.fn(),
  };

  it('links only the created ids that resolve against the live board', () => {
    // An agent can claim a card it never wrote. A dead link would be worse than none, and this is
    // the only place that filter lives.
    render(<ActiveReport {...props} record={run({ created: ['E-041', 'E-999'] })} />);
    // The EXACT set: E-999 was never on the board, but E-010 is — so asserting only that E-999 is
    // absent would pass just as well if the filter were dropped entirely.
    expect([...document.querySelectorAll('.report-created .link-id')].map((e) => e.textContent)).toEqual([
      'E-041',
    ]);
  });

  it('links nothing when the run created nothing', () => {
    render(<ActiveReport {...props} record={run()} />);
    expect(document.querySelector('.report-created')).toBeNull();
  });

  it('hands the resolved skill to the continuation', () => {
    const onContinue = vi.fn();
    render(
      <ActiveReport
        {...props}
        onContinue={onContinue}
        record={run({ status: 'attention', options: ['Split it'] })}
      />,
    );
    fireEvent.click(screen.getByText('Split it'));
    expect(onContinue.mock.calls).toEqual([[skills[0], 'Split it']]);
  });

  it('cannot continue a run whose skill has gone', () => {
    render(
      <ActiveReport
        {...props}
        skills={[]}
        record={run({ status: 'attention', options: ['Split it'] })}
      />,
    );
    expect((screen.getByText('Split it') as HTMLButtonElement).disabled).toBe(true);
  });
});
