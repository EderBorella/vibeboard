// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// THE CARD-SCOPED WAY OUT, and it exists because the first one was reachable from one loop state only.
//
// `ResetCard` on the auto-pilot bar renders while the loop reports `stalled`. A card blocked at its cap
// whose runs all SUCCEEDED, on a project whose loop last reported `complete` or `stopped`, had no route
// to a reset at all: the card pane offered `ForgiveAttempts`, which spares a success on purpose, and
// the bar offered nothing. Recovery then meant restarting the loop until it stalled again, which is not
// a remedy — decision 86's own sentence is that a state a person cannot get out of should not exist,
// and one reachable only from a particular loop state does not satisfy it.
const api = vi.hoisted(() => ({
  resetCardAttempts: vi.fn(async () => ({ forgiven: 3 })),
  forgiveCardAttempts: vi.fn(async () => ({ forgiven: 0 })),
}));
vi.mock('../web/src/lib/api.js', () => api);
vi.mock('../web/src/lib/api', () => api);

const { ResetAttempts } = await import('../web/src/organisms/runs/ResetAttempts.js');
const { CardReports } = await import('../web/src/organisms/runs/CardReports.js');

import type { CardLedgerData, RunRecord } from '../web/src/lib/api.js';
import type { Card } from '../web/src/lib/shared.js';

afterEach(() => {
  cleanup();
  api.resetCardAttempts.mockReset();
  api.resetCardAttempts.mockResolvedValue({ forgiven: 3 });
  // The forgive is cleared too, because one test asserts it was NOT called: a call leaking in from an
  // earlier case would fail it for a reason that has nothing to do with this component.
  api.forgiveCardAttempts.mockClear();
});

// F-003, the board this whole decision was measured on: a feature whose stories were all done and whose
// checkup had run to its cap, every remaining record a `success`.
const card = (over: Partial<Card> = {}): Card =>
  ({
    id: 'F-003',
    title: 'The one its own successes stopped',
    board: 'features',
    columnSlug: 'in-progress',
    order: 0,
    tags: [],
    links: [],
    created: '2026-09-01',
    body: '',
    filePath: '/tmp/F-003.md',
    ...over,
  }) as Card;

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  run: '20260901-090000-a1b2',
  card: 'F-003',
  board: 'features',
  skill: 'checkup-feature',
  status: 'success',
  started: '2026-09-01T09:00:00.000Z',
  backend: 'claude-code',
  model: 'opus',
  effort: 'high',
  mode: 'bypassPermissions',
  report: '',
  ...over,
});

const account = (over: Partial<CardLedgerData> = {}): CardLedgerData => ({
  spend: { runs: 3, withCost: 0, withoutCost: 3 },
  attempts: { 'checkup-feature': 3 },
  attemptCap: 3,
  ...over,
});

const pane = (over: Partial<CardLedgerData> = {}) =>
  render(
    <CardReports
      card={card()}
      runs={[run()]}
      account={account(over)}
      onOpen={vi.fn()}
      onCancel={vi.fn()}
      onForgiven={vi.fn()}
    />,
  );

const show = (onForgiven = vi.fn()) =>
  render(<ResetAttempts board="features" card="F-003" onForgiven={onForgiven} />);

// BY ITS ACCESSIBLE NAME, which is what a person reads, so a rename lands here rather than passing.
const press = () => fireEvent.click(screen.getByRole('button', { name: /^reset all$/i }));
const answer = () => fireEvent.click(screen.getByRole('button', { name: /reset it/i }));

describe('where the card-scoped reset appears', () => {
  it('sits on the ledger line, beside the forgive it is the stronger version of', () => {
    // Beside the count and beside the milder button: "checkup-feature 3 of 3" is where a person meets
    // the problem, and the two remedies differ only in what they spare — which is a choice you can only
    // make with both in front of you.
    pane();
    const line = document.querySelector('[data-testid="reports-ledger"]');
    expect(line?.textContent).toContain('checkup-feature 3 of 3');
    expect(line?.querySelector('[data-testid="reports-forgive"]')).toBeTruthy();
    expect(line?.querySelector('[data-testid="reports-reset"]')).toBeTruthy();
  });

  it('does not depend on what auto-pilot is doing', () => {
    // THE WHOLE OF WHY IT IS HERE. `ResetCard` on the bar renders only while the loop reports `stalled`,
    // so on a `complete` or `stopped` project it is not on screen at all. The card pane takes no loop
    // state as a prop — this assertion is that it never grew one.
    pane();
    expect(document.querySelector('[data-testid="reports-reset"]')).toBeTruthy();
  });

  it('is not offered on a card that has spent nothing', () => {
    // Same rule as the forgive beside it: there is nothing to clear, and a button whose only possible
    // answer is "nothing happened" is noise on every card that has ever run.
    pane({ attempts: { 'checkup-feature': 0 } });
    expect(document.querySelector('[data-testid="reports-reset"]')).toBeNull();
  });
});

describe('resetting a card from its own pane', () => {
  it('asks first, and calls nothing while the question is open', async () => {
    show();
    press();
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(api.resetCardAttempts).not.toHaveBeenCalled();
  });

  it('calls nothing at all if the question is answered no', async () => {
    show();
    press();
    fireEvent.click(await screen.findByRole('button', { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.resetCardAttempts).not.toHaveBeenCalled();
  });

  it('states the cost the milder button refuses to pay', async () => {
    // The price is what makes this a second action rather than a flag on the first: a creating run that
    // WORKED stops counting too, so the loop is free to create that work again. A dialog that left that
    // out would be the dead end's own class of problem — a remedy whose cost is not on the label.
    show();
    press();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/including the runs that SUCCEEDED/);
    expect(dialog.textContent).toMatch(/free to create that work again/i);
    expect(dialog.textContent).toMatch(/nothing is deleted/i);
  });

  it('calls the API for this card once confirmed, and refreshes what is on screen', async () => {
    const onForgiven = vi.fn();
    show(onForgiven);
    press();
    answer();
    await waitFor(() => expect(api.resetCardAttempts).toHaveBeenCalledTimes(1));
    expect(api.resetCardAttempts).toHaveBeenCalledWith('features', 'F-003');
    expect(onForgiven).toHaveBeenCalledTimes(1);
  });

  it('never calls the forgive instead, which would spare exactly what it is for', async () => {
    // The two are one click apart on the same line, and the whole point of this one is the success the
    // other spares. Wiring it to the milder call would clear nothing on the card it exists for and the
    // result line would still read as a success.
    show();
    press();
    answer();
    await waitFor(() => expect(api.resetCardAttempts).toHaveBeenCalledTimes(1));
    expect(api.forgiveCardAttempts).not.toHaveBeenCalled();
  });

  it('says how many it cleared', async () => {
    show();
    press();
    answer();
    expect(await screen.findByText(/Reset 3 attempts/i)).toBeTruthy();
  });

  it('says plainly when there was nothing counting against the card', async () => {
    // Zero means the card was never the problem. Reporting that as a success sends somebody away from
    // whatever is really holding the project.
    api.resetCardAttempts.mockResolvedValueOnce({ forgiven: 0 });
    show();
    press();
    answer();
    expect(await screen.findByText(/Nothing was counting against this card/i)).toBeTruthy();
  });

  it('shows the server’s refusal rather than failing silently', async () => {
    const refusal =
      'A run on this card has not finished, and it will land as an attempt of its own — so clearing them now would put the count straight back.';
    api.resetCardAttempts.mockRejectedValueOnce(new Error(refusal));
    show();
    press();
    answer();
    expect(await screen.findByText(/A run on this card has not finished/)).toBeTruthy();
  });

  it('does not tell the pane to refresh when the server refused', async () => {
    const onForgiven = vi.fn();
    api.resetCardAttempts.mockRejectedValueOnce(new Error('nope'));
    show(onForgiven);
    press();
    answer();
    await waitFor(() => expect(api.resetCardAttempts).toHaveBeenCalledTimes(1));
    expect(onForgiven).not.toHaveBeenCalled();
  });

  it('disables the button while the call is in flight', async () => {
    // Held open by a promise that never settles; the busy flag is cleared in a `finally`, so anything
    // that returns would clear it before the assertion.
    api.resetCardAttempts.mockReturnValueOnce(new Promise(() => {}));
    show();
    press();
    answer();
    const button = await screen.findByRole('button', { name: /resetting…/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
