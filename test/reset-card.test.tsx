// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunList, RunRecord } from '../web/src/lib/api';

// THE WAY OUT OF A CARD ITS OWN SUCCESSES STOPPED.
//
// `ForgiveAttempts` spares a run that SUCCEEDED on purpose — clearing a `break-down` that worked frees the
// loop to hang a second set of children off the card — and a card whose every remaining record is a success
// is therefore one it cannot move at all. Measured on F-003: every story done, its feature checkup run four
// times, three `success` and one `attention` already forgiven. The card sat at three of three attempts, the
// only control the product offered cleared nothing, and there was no other route back.
const api = vi.hoisted(() => ({ resetCardAttempts: vi.fn(async () => ({ forgiven: 3 })) }));
vi.mock('../web/src/lib/api.js', () => api);
vi.mock('../web/src/lib/api', () => api);

const { ResetCard } = await import('../web/src/organisms/autopilot/ResetCard.js');
const { cardNamedIn, resettableCards } = await import('../web/src/organisms/autopilot/reset.js');

afterEach(() => {
  cleanup();
  api.resetCardAttempts.mockReset();
  api.resetCardAttempts.mockResolvedValue({ forgiven: 3 });
});

const record = (over: Partial<RunRecord>): RunRecord => ({
  run: '20260921-100000-aaaa',
  skill: 'checkup-feature',
  status: 'success',
  started: '2026-09-21T10:00:00.000Z',
  backend: 'claude-code',
  model: 'opus',
  effort: 'high',
  mode: 'bypassPermissions',
  report: '',
  ...over,
});

const runList = (...runs: RunRecord[]): RunList => ({ runs, active: [], queued: [] });

// The board F-003 stalled on: the feature's own checkup runs, and a story under it that was worked.
const BOARD = runList(
  record({ run: 'r-1', card: 'F-003', board: 'features' }),
  record({ run: 'r-2', card: 'P-034', board: 'product', skill: 'implement-story' }),
);

const STOPPED =
  'F-003 has already had its one round of creating work, and the checkup after it still did not close the feature.';

describe('which cards a reset is offered for', () => {
  it('lists each card once, by id, and skips a run with no card', () => {
    // A project run — the bootstrap, the pre-flight — has neither card nor board, and there is nothing
    // for a card-addressed route to do with it.
    const runs = runList(
      record({ run: 'r-1', card: 'P-034', board: 'product' }),
      record({ run: 'r-2', card: 'F-003', board: 'features' }),
      record({ run: 'r-3', card: 'P-034', board: 'product' }),
      record({ run: 'r-4' }),
    );
    expect(resettableCards(runs)).toEqual([
      { id: 'F-003', board: 'features' },
      { id: 'P-034', board: 'product' },
    ]);
  });

  it('is empty for a project that has run nothing', () => {
    expect(resettableCards(runList())).toEqual([]);
  });
});

describe('the card the stop sentence names', () => {
  const cards = [
    { id: 'F-003', board: 'features' as const },
    { id: 'P-034', board: 'product' as const },
  ];

  it('is the one the sentence mentions', () => {
    expect(cardNamedIn(STOPPED, cards)).toBe('F-003');
  });

  it('is nobody when the sentence names two of them', () => {
    // A default guessed wrong is worse than none: it puts the wrong id on a button whose confirmation
    // is about to be skimmed.
    expect(cardNamedIn('F-003 is waiting on P-034.', cards)).toBeUndefined();
  });

  it('is nobody when the sentence names none of them', () => {
    expect(cardNamedIn('The board could not be read 3 times in a row.', cards)).toBeUndefined();
  });

  it('does not match an id that is only part of a longer one', () => {
    // The sentence is about P-0341; P-034 is a different card and must not be preselected for it.
    expect(cardNamedIn('P-0341 has used all 3 attempts.', cards)).toBeUndefined();
  });

  it('is nobody when there is no sentence at all', () => {
    expect(cardNamedIn(undefined, cards)).toBeUndefined();
  });
});

// The confirmation is part of the control, so it is answered rather than bypassed: a test that called the
// endpoint directly would pass with the dialog wired to nothing.
async function resetIt(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /^reset f-003$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /^reset it$/i }));
}

describe('resetting the card the stop names', () => {
  it('comes up aimed at that card, and resets it', async () => {
    render(<ResetCard reason="stalled" detail={STOPPED} runs={BOARD} onReset={() => {}} />);

    expect((screen.getByLabelText('The card to reset') as HTMLSelectElement).value).toBe('F-003');
    await resetIt();

    await waitFor(() => expect(api.resetCardAttempts).toHaveBeenCalledWith('features', 'F-003'));
  });

  it('says what it cleared, because “done” would imply the machine is fixed', async () => {
    render(<ResetCard reason="stalled" detail={STOPPED} runs={BOARD} onReset={() => {}} />);

    await resetIt();

    expect(await screen.findByText(/reset 3 attempts/i)).toBeTruthy();
  });

  it('says plainly when nothing was counting', async () => {
    api.resetCardAttempts.mockResolvedValue({ forgiven: 0 });
    render(<ResetCard reason="stalled" detail={STOPPED} runs={BOARD} onReset={() => {}} />);

    await resetIt();

    expect(await screen.findByText(/nothing was counting against that card/i)).toBeTruthy();
  });

  it('refetches, so the bar is not answering for a stop somebody has restarted out of', async () => {
    const onReset = vi.fn();
    render(<ResetCard reason="stalled" detail={STOPPED} runs={BOARD} onReset={onReset} />);

    await resetIt();

    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
  });

  it('does nothing at all if the confirmation is declined', async () => {
    render(<ResetCard reason="stalled" detail={STOPPED} runs={BOARD} onReset={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /^reset f-003$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));

    expect(api.resetCardAttempts).not.toHaveBeenCalled();
  });

  // THE PRICE IS ON THE LABEL. This is the whole reason it is a second action rather than a flag on the
  // forgive: it clears runs that WORKED, so a creating run stops counting and the loop may create that
  // work again. A remedy whose cost is hidden is the same class of problem as the dead end it fixes.
  it('says in the confirmation that a second set of cards may follow', async () => {
    render(<ResetCard reason="stalled" detail={STOPPED} runs={BOARD} onReset={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /^reset f-003$/i }));

    const body = await screen.findByText(/including the runs that SUCCEEDED/);
    expect(body.textContent).toContain('you may end up with a second set');
  });

  it('resets whichever card is picked instead', async () => {
    render(<ResetCard reason="stalled" detail={STOPPED} runs={BOARD} onReset={() => {}} />);

    fireEvent.change(screen.getByLabelText('The card to reset'), { target: { value: 'P-034' } });
    fireEvent.click(screen.getByRole('button', { name: /^reset p-034$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^reset it$/i }));

    // THE BOARD OF THE CARD CHOSEN, not the one the sentence named: the route is addressed by both, and
    // a fixture whose cards shared a board could not tell a wired pair from a hardcoded one.
    await waitFor(() => expect(api.resetCardAttempts).toHaveBeenCalledWith('product', 'P-034'));
  });

  it('cannot be pressed until a card is chosen, when the sentence names none', async () => {
    render(
      <ResetCard reason="stalled" detail="The board could not be read." runs={BOARD} onReset={() => {}} />,
    );

    expect(screen.getByRole('button', { name: /^reset$/i })).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText('The card to reset'), { target: { value: 'F-003' } });
    expect(screen.getByRole('button', { name: /^reset f-003$/i })).toHaveProperty('disabled', false);
  });
});

// WHEN IT IS OFFERED AT ALL. Asserted here rather than in the bar, the same arrangement
// `ForgiveDerivation` uses: when a remedy is offered is part of what the remedy means.
describe('when the control appears', () => {
  it('renders nothing unless the loop stalled', () => {
    // `complete` is the loop having finished — nothing went wrong, so offering to reset a card would
    // invent a problem. `undefined` is a loop that has not stopped at all.
    const done = render(<ResetCard reason="complete" detail={STOPPED} runs={BOARD} onReset={() => {}} />);
    expect(done.container.textContent).toBe('');
    cleanup();

    const running = render(<ResetCard reason={undefined} detail={STOPPED} runs={BOARD} onReset={() => {}} />);
    expect(running.container.textContent).toBe('');
  });

  it('renders nothing when the project has run nothing, because there is no card to name', () => {
    const empty = render(<ResetCard reason="stalled" detail={STOPPED} runs={runList()} onReset={() => {}} />);
    expect(empty.container.textContent).toBe('');
  });
});
