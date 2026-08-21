// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Suggestion } from '../web/src/shared.js';

// The pane fetches nothing itself: WorkArea holds the list, because the dock's BADGE needs the count
// whether or not the pane is the one on screen. What the pane owns is the two actions, and those it
// sends itself — so the api module is what is faked here.
const api = vi.hoisted(() => ({ patchSuggestion: vi.fn(), cardSuggestion: vi.fn() }));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { SuggestionsPane } = await import('../web/src/suggestions/SuggestionsPane.js');

afterEach(() => {
  cleanup();
  api.patchSuggestion.mockReset();
  api.cardSuggestion.mockReset();
});

const suggestion = (over: Partial<Suggestion> = {}): Suggestion => ({
  id: 's-1',
  state: 'active',
  created: '2026-08-05T10:00:00.000Z',
  title: 'The card query is linear',
  body: 'It scans every card on every keystroke.',
  run: 'run-7',
  card: 'E-001',
  ...over,
});

const pane = (over: Partial<Parameters<typeof SuggestionsPane>[0]> = {}) => (
  <SuggestionsPane
    suggestions={[suggestion()]}
    failed={false}
    onRefresh={vi.fn()}
    onApply={vi.fn()}
    {...over}
  />
);

describe('the Suggestions pane', () => {
  it('lists the active suggestions with their run and their date', () => {
    render(
      pane({
        suggestions: [
          suggestion(),
          suggestion({ id: 's-2', title: 'The gate has no timeout', run: 'run-9' }),
        ],
      }),
    );
    expect(screen.getByText('The card query is linear')).toBeTruthy();
    expect(screen.getByText('The gate has no timeout')).toBeTruthy();
    expect(screen.getByText('run-7')).toBeTruthy();
    expect(screen.getByText('run-9')).toBeTruthy();
    // The date the server stamped, in the reader's own locale.
    expect(screen.getAllByText(new Date('2026-08-05T10:00:00.000Z').toLocaleString()).length).toBe(2);
  });

  it('offers exactly two actions on a suggestion, and Refresh is not one of them', () => {
    const { container } = render(pane());
    // SCOPED AND EXACT. It asserted that two buttons EXISTED while the pane renders three in this row plus
    // one per suggestion — so "exactly two" was held by nothing, and a third action beside them would have
    // passed. TWO ACTIONS, FIXED (decision 49): Refresh re-reads the list, it is not something done to a
    // finding.
    // Phase 9 touched the controls in this row, so its selector moved with the change: a class-based
    // selector turns a visual fix into a red suite, which is how a suite stops being trusted.
    const actions = container.querySelector('[data-testid="suggestions-actions"]') as HTMLElement;
    expect([...actions.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Dismiss',
      'Make a card',
      'Refresh',
    ]);
    // And NOT the skills list, which was agreed and then corrected (decision 49): dispatching an
    // implementation skill at a suggestion produced work with no card to report against.
    expect(screen.queryByText(/implement/i)).toBeNull();
  });

  it('offers feature and story as levels, and never task', () => {
    render(pane());
    expect(screen.getByRole('option', { name: /feature/i })).toBeTruthy();
    expect(screen.getByRole('option', { name: /story/i })).toBeTruthy();
    // It looked like the most useful and it is the one that cannot work: a task needs a story to belong
    // to, so carding one either hunts for a parent or makes an orphan the machine never walks to.
    expect(screen.queryByRole('option', { name: /task/i })).toBeNull();
  });

  it('dismisses with a reason, and sends it', () => {
    const onApply = vi.fn();
    api.patchSuggestion.mockResolvedValue(suggestion({ state: 'dismissed', reason: 'not this quarter' }));
    render(pane({ onApply }));
    fireEvent.change(screen.getByLabelText('Why not?'), { target: { value: 'not this quarter' } });
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    // Two states would lose WHY something was rejected, which is what stops a later checkup re-raising it.
    return waitFor(() => {
      expect(api.patchSuggestion).toHaveBeenCalledWith('s-1', 'dismissed', 'not this quarter');
      // The record as the SERVER saved it, handed back so the list stops showing a row whose buttons
      // would now do nothing.
      expect(onApply).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'dismissed', reason: 'not this quarter' }),
      );
    });
  });

  it('cards the selected suggestion at the level that is chosen', async () => {
    const onApply = vi.fn();
    api.cardSuggestion.mockResolvedValue({
      card: { id: 'P-004' },
      suggestion: suggestion({ state: 'actioned', became: 'P-004' }),
    });
    render(pane({ onApply }));
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'feature' } });
    fireEvent.click(screen.getByRole('button', { name: /make a card/i }));
    await waitFor(() => expect(api.cardSuggestion).toHaveBeenCalledWith('s-1', 'feature'));
    // And it says which card it became, because the answer is the only place that fact appears.
    expect(await screen.findByText(/P-004/)).toBeTruthy();
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ became: 'P-004' }));
  });

  it("shows the server's refusal when carding fails", async () => {
    api.cardSuggestion.mockRejectedValue(new Error('That suggestion is already actioned, as P-002.'));
    render(pane());
    fireEvent.click(screen.getByRole('button', { name: /make a card/i }));
    // A control whose refusal is invisible is the dead end this design refuses to ship.
    expect(await screen.findByText(/already actioned, as P-002/)).toBeTruthy();
  });

  it('says so when there is nothing to triage, and offers a way to ask again after a failed read', () => {
    const onRefresh = vi.fn();
    render(pane({ suggestions: [], onRefresh }));
    expect(screen.getByText(/Nothing has been filed/)).toBeTruthy();
    cleanup();
    // "Nothing filed" and "we could not find out" are different facts, and only the second is a cue.
    render(pane({ suggestions: [], failed: true, onRefresh }));
    expect(screen.queryByText(/Nothing has been filed/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRefresh).toHaveBeenCalled();
  });

  // Both notices are about the suggestion they happened to, and the actions move to whichever row is
  // picked — so a stale "carded as P-004" or a stale refusal beside a different finding is a lie.
  it('clears what it said about one suggestion when another is picked', async () => {
    api.cardSuggestion.mockResolvedValue({
      card: { id: 'P-004' },
      suggestion: suggestion({ state: 'actioned', became: 'P-004' }),
    });
    render(
      pane({ suggestions: [suggestion(), suggestion({ id: 's-2', title: 'The gate has no timeout' })] }),
    );
    fireEvent.click(screen.getByRole('button', { name: /make a card/i }));
    expect(await screen.findByText(/P-004/)).toBeTruthy();

    fireEvent.click(screen.getByText('The gate has no timeout'));
    expect(screen.queryByText(/P-004/)).toBeNull();
  });

  it('acts on the suggestion the user picked, not always the first', async () => {
    api.patchSuggestion.mockResolvedValue(suggestion({ id: 's-2', state: 'dismissed' }));
    render(
      pane({ suggestions: [suggestion(), suggestion({ id: 's-2', title: 'The gate has no timeout' })] }),
    );
    fireEvent.click(screen.getByText('The gate has no timeout'));
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await waitFor(() => expect(api.patchSuggestion).toHaveBeenCalledWith('s-2', 'dismissed', undefined));
  });
});
