// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The control that lets a person clear a card's spent attempts, and the ledger line it lives on.
//
// It exists because attempts are DERIVED by counting run records: there is no counter, so a card that
// reached its cap stayed at the cap for ever and auto-pilot would not dispatch it again. The only
// remedy was to move the card's result files out of its folder by hand, which destroys the history
// explaining why it was blocked.
const api = vi.hoisted(() => ({ forgiveCardAttempts: vi.fn(async () => ({ forgiven: 3 })) }));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { ForgiveAttempts } = await import('../web/src/runs/ForgiveAttempts.js');
const { CardReports } = await import('../web/src/runs/CardReports.js');

import type { CardLedgerData, RunRecord } from '../web/src/api.js';
import type { Card } from '../web/src/shared.js';

afterEach(() => {
  cleanup();
  api.forgiveCardAttempts.mockReset();
  api.forgiveCardAttempts.mockResolvedValue({ forgiven: 3 });
});

const card = (over: Partial<Card> = {}): Card =>
  ({
    id: 'P-011',
    title: 'The one the machine spent',
    board: 'product',
    columnSlug: 'todo',
    order: 0,
    tags: [],
    links: [],
    created: '2026-08-15',
    body: '',
    filePath: '/tmp/P-011.md',
    ...over,
  }) as Card;

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  run: '20260815-090000-a1b2',
  card: 'P-011',
  board: 'product',
  skill: 'execute',
  status: 'failed',
  started: '2026-08-15T09:00:00.000Z',
  backend: 'claude-code',
  model: 'opus',
  effort: 'high',
  mode: 'bypassPermissions',
  report: '',
  ...over,
});

const account = (over: Partial<CardLedgerData> = {}): CardLedgerData => ({
  spend: { runs: 3, withCost: 0, withoutCost: 3 },
  attempts: { execute: 3 },
  attemptCap: 3,
  ...over,
});

const show = (onForgiven = vi.fn()) =>
  render(<ForgiveAttempts board="product" card="P-011" onForgiven={onForgiven} />);

const press = () => fireEvent.click(screen.getByRole('button', { name: /try this card again/i }));
const answer = () => fireEvent.click(screen.getByRole('button', { name: /clear the attempts/i }));

describe('where the control appears', () => {
  it('sits on the ledger line, beside the count it clears', () => {
    // Beside the number is the whole point: "execute 3 of 3" is where a person meets the problem, and
    // a remedy anywhere else is one they would have to already know about.
    render(
      <CardReports
        card={card()}
        runs={[run()]}
        account={account()}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
        onForgiven={vi.fn()}
      />,
    );
    const line = document.querySelector('.reports-ledger');
    expect(line?.textContent).toContain('execute 3 of 3');
    expect(line?.querySelector('.reports-forgive')).toBeTruthy();
  });

  it('is not offered on a card that has spent nothing', () => {
    // There would be nothing to clear, and a button whose only possible answer is "nothing happened"
    // is noise on every card that has ever run.
    render(
      <CardReports
        card={card()}
        runs={[run({ status: 'cancelled' })]}
        account={account({ attempts: { execute: 0 } })}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
        onForgiven={vi.fn()}
      />,
    );
    expect(document.querySelector('.reports-forgive')).toBeNull();
  });
});

describe('clearing a card’s attempts', () => {
  it('asks first, and calls nothing while the question is open', async () => {
    show();
    press();
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(api.forgiveCardAttempts).not.toHaveBeenCalled();
  });

  it('calls nothing at all if the question is answered no', async () => {
    show();
    press();
    fireEvent.click(await screen.findByRole('button', { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.forgiveCardAttempts).not.toHaveBeenCalled();
  });

  it('says what it does and does not claim to fix what broke', async () => {
    // The last half is the one that has to be there. These runs are cleared most often because they
    // failed for a reason OUTSIDE the card — a dead credential, a box pointing at a deleted directory —
    // and a dialog implying the machine was now fixed sends the next run into the same wall.
    show();
    press();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/auto-pilot can dispatch it again/i);
    expect(dialog.textContent).toMatch(/nothing is deleted/i);
    expect(dialog.textContent).toMatch(/does not fix whatever made those runs fail/i);
  });

  it('calls the API for this card once confirmed, and refreshes what is on screen', async () => {
    // The refresh is not decoration: the count beside the button is derived from the records this
    // write stamps, so without it the row goes on saying "3 of 3" over a card that is free.
    const onForgiven = vi.fn();
    show(onForgiven);
    press();
    answer();
    await waitFor(() => expect(api.forgiveCardAttempts).toHaveBeenCalledTimes(1));
    expect(api.forgiveCardAttempts).toHaveBeenCalledWith('product', 'P-011');
    expect(onForgiven).toHaveBeenCalledTimes(1);
  });

  it('says how many it cleared', async () => {
    show();
    press();
    answer();
    expect(await screen.findByText(/Cleared 3 attempts/i)).toBeTruthy();
  });

  it('says plainly when there was nothing counting against the card', async () => {
    // "Done" on a card that had no spent attempts reads as "your problem is fixed", and it is not —
    // whatever is holding this card is somewhere else.
    api.forgiveCardAttempts.mockResolvedValueOnce({ forgiven: 0 });
    show();
    press();
    answer();
    expect(await screen.findByText(/Nothing was counting against this card/i)).toBeTruthy();
  });

  it('shows the server’s refusal rather than failing silently', async () => {
    const refusal =
      'A run on this card has not finished, and it will land as an attempt of its own — so clearing them now would put the count straight back.';
    api.forgiveCardAttempts.mockRejectedValueOnce(new Error(refusal));
    show();
    press();
    answer();
    expect(await screen.findByText(/A run on this card has not finished/)).toBeTruthy();
  });

  it('does not tell the pane to refresh when the server refused', async () => {
    // `run` resolves false on a refusal and the work that follows a success is inside it, so a refetch
    // here would ask the server to confirm a change that never happened.
    const onForgiven = vi.fn();
    api.forgiveCardAttempts.mockRejectedValueOnce(new Error('nope'));
    show(onForgiven);
    press();
    answer();
    await waitFor(() => expect(api.forgiveCardAttempts).toHaveBeenCalledTimes(1));
    expect(onForgiven).not.toHaveBeenCalled();
  });

  it('disables the button while the call is in flight', async () => {
    // Held open by a promise that never settles; the busy flag is cleared in a `finally`, so anything
    // that returns would clear it before the assertion.
    api.forgiveCardAttempts.mockReturnValueOnce(new Promise(() => {}));
    show();
    press();
    answer();
    const button = await screen.findByRole('button', { name: /clearing…/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
