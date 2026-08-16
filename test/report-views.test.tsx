// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCS_DIR, RESOURCES_DIR, skillRel } from '../src/core/layout.js';
import type { CardLedgerData, RunRecord } from '../web/src/api.js';
import { ActiveReport } from '../web/src/runs/ActiveReport.js';
import { CardReports } from '../web/src/runs/CardReports.js';
import { ReportPane } from '../web/src/runs/ReportPane.js';
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
    const { container } = render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[]}
        account={null}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('lists newest first, whatever order the store gave them', () => {
    // The store lists a card oldest-first (chronological); the reader wants the latest at the top.
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[run({ run: 'a', skill: 'research' }), run({ run: 'b', skill: 'execute' })]}
        account={null}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect([...document.querySelectorAll('.report-skill')].map((e) => e.textContent)).toEqual([
      'execute',
      'research',
    ]);
  });

  it('marks a run that has been dealt with, without pretending it ended differently', () => {
    // The row still says "Needs you" — that IS how it ended — with the decision appended. The exact
    // string, not a substring: the point is that both halves are there.
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[
          run({ run: 'a', status: 'attention' }),
          run({ run: 'b', status: 'attention', resolved: '2026-07-26T21:30:00.000Z' }),
        ]}
        account={null}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect([...document.querySelectorAll('.report-chip')].map((e) => e.textContent)).toEqual([
      'Needs you · dealt with',
      'Needs you',
    ]);
    expect(document.querySelectorAll('.report-row.resolved')).toHaveLength(1);
  });

  it('dates each run to the minute, from when it finished', () => {
    // Trimmed to minutes and the T replaced: the raw ISO string is unreadable in a list, and a run's
    // own timestamps are what a person means by "when" — the id is a stamp too, but it is not this.
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[run({ started: '2026-07-26T14:30:12.000Z', finished: '2026-07-26T14:41:55.000Z' })]}
        account={null}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.querySelector('.report-when')?.textContent).toBe('2026-07-26 14:41');
  });

  it('falls back to when it started for a run that has not finished', () => {
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[run({ status: 'running', started: '2026-07-26T14:30:12.000Z', finished: undefined })]}
        account={null}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.querySelector('.report-when')?.textContent).toBe('2026-07-26 14:30');
  });

  it('shows each run’s cost, and nothing where it is unknown', () => {
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[run({ usage: { costUsd: 0.0421 } }), run({ run: 'r2', usage: undefined })]}
        account={null}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // One row has a cost, the other has no element at all — not an empty one, which would leave a
    // gap implying the run was free.
    const costs = [...document.querySelectorAll('.report-cost')].map((n) => n.textContent);
    expect(costs).toEqual(['$0.042']);
  });

  it('shows a free run as $0 rather than as unknown', () => {
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[run({ usage: { costUsd: 0 } })]}
        account={null}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.querySelector('.report-cost')?.textContent).toBe('$0');
  });

  it('leaves the summary blank rather than printing undefined', () => {
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[run({ summary: undefined, note: undefined })]}
        account={null}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.querySelector('.report-summary')?.textContent).toBe('');
  });

  it('prefers the agent’s summary, and falls back to VibeBoard’s note', () => {
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[
          run({ run: 'a', summary: 'did the thing', note: 'ignored' }),
          run({ run: 'b', summary: undefined, note: 'The agent finished without writing a report.' }),
        ]}
        account={null}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect([...document.querySelectorAll('.report-summary')].map((e) => e.textContent)).toEqual([
      'The agent finished without writing a report.',
      'did the thing',
    ]);
  });

  it.each([
    ['running', true],
    ['queued', true],
    ['attention', false],
    ['success', false],
    ['failed', false],
    ['interrupted', false],
  ])('offers Stop for a %s run: %s', (status, stoppable) => {
    // Both in-flight statuses, and nothing else: offering Stop on a finished run is a button that
    // can only fail, and withholding it from a queued one leaves no way to clear the queue.
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[run({ status: status as RunRecord['status'] })]}
        account={null}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.querySelectorAll('.report-stop').length === 1).toBe(stoppable);
  });

  it('names the run each button belongs to, so a card with several is unambiguous', () => {
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[run({ status: 'running', skill: 'research' })]}
        account={null}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTitle('Open the report from research')).toBeTruthy();
    expect(screen.getByTitle('Stop the research run')).toBeTruthy();
  });

  it('says what each status means to a person, not what it is called', () => {
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[
          run({ run: 'a', status: 'attention' }),
          run({ run: 'b', status: 'success' }),
          run({ run: 'c', status: 'failed' }),
          run({ run: 'd', status: 'interrupted' }),
        ]}
        account={null}
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
        card={card()}
        onForgiven={vi.fn()}
        runs={[
          run({ run: 'a', summary: 'did the thing' }),
          run({ run: 'b', summary: undefined, note: 'The agent finished without writing a report.' }),
        ]}
        account={null}
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
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[first, run({ run: 'b' })]}
        account={null}
        onOpen={onOpen}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(document.querySelectorAll<HTMLElement>('.report-open')[1]);
    expect(onOpen.mock.calls).toEqual([[first]]);
  });

  it('offers Stop only while a run is in flight', () => {
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[run({ run: 'a', status: 'running' }), run({ run: 'b', status: 'success' })]}
        account={null}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.querySelectorAll('.report-stop')).toHaveLength(1);
  });

  it('stops the run it was asked to stop', () => {
    const onCancel = vi.fn();
    const live = run({ run: 'a', status: 'running' });
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[live]}
        account={null}
        onOpen={vi.fn()}
        onCancel={onCancel}
      />,
    );
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
    onClose: vi.fn(),
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

  it('says what the run cost, in full', () => {
    render(
      <ReportPane
        {...props}
        record={run({
          usage: { costUsd: 0.0421, durationMs: 62_431, turns: 7, contextTokens: 48_210 },
        })}
      />,
    );
    expect(screen.getByText('Usage')).toBeTruthy();
    expect(screen.getByText('$0.042 · 1m 2s · 7 turns · 48.2k ctx')).toBeTruthy();
  });

  it('omits the usage row entirely for a run that never reported any', () => {
    // Older runs have no usage. A row reading "$0" would claim the run was free.
    render(<ReportPane {...props} record={run()} />);
    expect(screen.queryByText('Usage')).toBeNull();
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
    render(<ReportPane {...props} record={run({ created: ['E-041', 'E-999'] })} createdCards={[created]} />);
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
    expect((screen.getByLabelText('Column to move the card to') as HTMLSelectElement).value).toBe('review');
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

  it('closes through its own handler, not the move one — closing also resolves the run', () => {
    // Two different facts. `onMove` moves a card and nothing else; `onClose` records that the run
    // has been dealt with as well, which is what stops it asking again from the dashboard.
    const onMove = vi.fn();
    const onClose = vi.fn();
    render(<ReportPane {...props} onMove={onMove} onClose={onClose} record={run({ status: 'attention' })} />);
    fireEvent.click(screen.getByText('Close card'));
    expect(onClose.mock.calls).toEqual([['done']]);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('offers options for an interrupted run, which until now had no button anywhere', () => {
    // It sits under "Requires attention" in the dashboard, so it must be answerable somewhere.
    render(<ReportPane {...props} record={run({ status: 'interrupted', report: '' })} />);
    expect(screen.getByLabelText('What next')).toBeTruthy();
  });

  it('drops the options once the run has been dealt with, and says when', () => {
    render(
      <ReportPane {...props} record={run({ status: 'attention', resolved: '2026-07-26T21:30:00.000Z' })} />,
    );
    expect(screen.queryByLabelText('What next')).toBeNull();
    expect(screen.getByText('Dealt with')).toBeTruthy();
    expect(screen.getByText('2026-07-26 21:30:00')).toBeTruthy();
    // The status still reads as it ended: how the run finished is not what the user decided about it.
    expect(screen.getByText('attention')).toBeTruthy();
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

  it('shows both timestamps to the second, readably', () => {
    // To the SECOND here, unlike the history row's minutes: this is the page where you work out why
    // a run took as long as it did.
    render(
      <ReportPane
        {...props}
        record={run({ started: '2026-07-26T14:30:12.000Z', finished: '2026-07-26T14:41:55.000Z' })}
      />,
    );
    expect(screen.getByText('2026-07-26 14:30:12')).toBeTruthy();
    expect(screen.getByText('2026-07-26 14:41:55')).toBeTruthy();
  });

  it('leaves out the rows it has nothing for', () => {
    // A run still going has no finish time, most runs attach nothing, and a bare label with an empty
    // value reads as data that failed to load.
    render(
      <ReportPane
        {...props}
        record={run({
          status: 'running',
          finished: undefined,
          attached: undefined,
          summary: undefined,
          note: undefined,
          prompt: undefined,
        })}
      />,
    );
    expect(screen.queryByText('Finished')).toBeNull();
    expect(screen.queryByText('Attached')).toBeNull();
    expect(screen.queryByText('Dealt with')).toBeNull();
    expect(document.querySelector('.report-lead')).toBeNull();
    expect(document.querySelector('.report-note')).toBeNull();
    expect(document.querySelector('.report-prompt')).toBeNull();
  });

  it('lists what was attached, comma separated', () => {
    const attached = [`${DOCS_DIR}/api.md`, `${RESOURCES_DIR}/spec.md`];
    render(<ReportPane {...props} record={run({ attached })} />);
    expect(screen.getByText(attached.join(', '))).toBeTruthy();
  });

  it('shows VibeBoard’s note when the agent left no summary of its own', () => {
    render(
      <ReportPane
        {...props}
        record={run({ status: 'attention', summary: undefined, note: 'The agent wrote no report.' })}
      />,
    );
    expect(document.querySelector('.report-note')?.textContent).toBe('The agent wrote no report.');
    expect(document.querySelector('.report-lead')).toBeNull();
  });

  it('offers the fixed options even when the agent suggested none', () => {
    // `?? []` matters: an attention run with no options must still be answerable, or the card is
    // stuck with a report and no way forward.
    render(<ReportPane {...props} record={run({ status: 'attention', options: undefined })} />);
    expect(screen.getByText('Create new cards')).toBeTruthy();
    expect(screen.getByText('Write my own input')).toBeTruthy();
    expect(screen.getByText('Close card')).toBeTruthy();
    expect(document.querySelectorAll('.option-btn')).toHaveLength(2);
  });
});

describe('ActiveReport', () => {
  const skills = [
    {
      slug: 'execute',
      path: skillRel('execute', 'SKILL.md'),
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
    onClose: vi.fn(),
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
      <ActiveReport {...props} skills={[]} record={run({ status: 'attention', options: ['Split it'] })} />,
    );
    expect((screen.getByText('Split it') as HTMLButtonElement).disabled).toBe(true);
  });
});

// A card's own line in the ledger. The attempt count is the number that decides whether auto-pilot
// will try again, so it is shown against the cap rather than as a bare tally.
describe('a card’s ledger line', () => {
  const account = (over: Partial<CardLedgerData> = {}): CardLedgerData => ({
    spend: { runs: 2, withCost: 2, withoutCost: 0, costUsd: 0.42 },
    attempts: { implement: 2 },
    attemptCap: 3,
    ...over,
  });

  it('shows what the card cost and how close a skill is to its cap', () => {
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[run()]}
        account={account()}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const line = document.querySelector('.reports-ledger')?.textContent ?? '';
    expect(line).toContain('$0.420 usage');
    expect(line).toContain('implement 2 of 3');
  });

  // A skill with no burned attempts is not news, and listing every skill that ever ran would bury the
  // one approaching its cap.
  it('leaves out a skill that has burned nothing', () => {
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[run()]}
        account={account({ attempts: { implement: 2, review: 0 } })}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const line = document.querySelector('.reports-ledger')?.textContent ?? '';
    expect(line).toContain('implement 2 of 3');
    expect(line).not.toContain('review');
  });

  it('says the backend reported nothing rather than showing zero', () => {
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[run()]}
        account={account({ spend: { runs: 1, withCost: 0, withoutCost: 1 } })}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.querySelector('.reports-ledger')?.textContent).toContain('not reported');
  });

  it('renders no line at all before the ledger has arrived', () => {
    render(
      <CardReports
        card={card()}
        onForgiven={vi.fn()}
        runs={[run()]}
        account={null}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.querySelector('.reports-ledger')).toBeNull();
  });
});
