// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Suggestion, SuggestionState } from '../web/src/shared.js';

const api = vi.hoisted(() => ({ listSuggestions: vi.fn() }));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { useSuggestions } = await import('../web/src/suggestions/useSuggestions.js');

afterEach(() => {
  cleanup();
  api.listSuggestions.mockReset();
});

// NO SOCKET HALF, and that is the one deliberate difference from `useDiary`: the suggestions route
// broadcasts nothing, because the watcher already rebuilds the snapshot when a file lands in the folder. So
// there is no fake socket here — a mock for a channel the hook does not use would be a claim that it does.

const suggestion = (over: Partial<Suggestion> = {}): Suggestion => ({
  id: 's-1',
  state: 'active',
  created: '2026-08-05T10:00:00.000Z',
  title: 'The card query is linear',
  body: 'It scans every card on every keystroke.',
  ...over,
});

// Rendered through a probe rather than poked at as an object: `apply` is a state setter, so what matters is
// what a consumer would see afterwards. Both fields of every row, because "the row left" and "the row is
// still there showing the state it had before the click" are the two outcomes being told apart.
function Probe({
  bump,
  state,
  updated,
}: {
  bump: number;
  state?: SuggestionState;
  updated: Suggestion;
}) {
  const { suggestions, failed, apply } = useSuggestions(bump, state);
  return (
    <div>
      <span data-testid="rows">{suggestions.map((s) => `${s.id}:${s.state}`).join(',')}</span>
      <span data-testid="failed">{String(failed)}</span>
      <button type="button" onClick={() => apply(updated)}>
        apply
      </button>
    </div>
  );
}

const rows = () => screen.getByTestId('rows').textContent;
const apply = () => fireEvent.click(screen.getByRole('button', { name: 'apply' }));

describe('useSuggestions', () => {
  it('starts empty and fills from the endpoint, asking for the state it was given', async () => {
    api.listSuggestions.mockResolvedValue([suggestion(), suggestion({ id: 's-2' })]);
    render(<Probe bump={0} state="active" updated={suggestion()} />);
    // Empty on the first paint, which is why the pane renders its own "nothing has been filed" rather than
    // a spinner.
    expect(rows()).toBe('');
    await waitFor(() => expect(rows()).toBe('s-1:active,s-2:active'));
    // FILTERED BY THE SERVER, so the pane can ask for the active ones and never scan the rest.
    expect(api.listSuggestions).toHaveBeenCalledWith('active');
  });

  // The ONLY thing that makes an actioned suggestion leave the dock list and the badge count fall. The pane's
  // own test asserts the mock was called with the right record, which passes while the row stays put.
  it('drops a row the surface no longer asked for, so an actioned one leaves a list of active ones', async () => {
    api.listSuggestions.mockResolvedValue([suggestion(), suggestion({ id: 's-2' })]);
    render(
      <Probe bump={0} state="active" updated={suggestion({ state: 'actioned', became: 'P-004' })} />,
    );
    await waitFor(() => expect(rows()).toBe('s-1:active,s-2:active'));

    apply();
    // Gone, not merely restyled: a row whose buttons would now be refused is a dead control, and the badge
    // counts what is in this list.
    await waitFor(() => expect(rows()).toBe('s-2:active'));
    // And nothing was refetched to achieve it — the endpoint broadcasts nothing, so a refetch is the only
    // other way this could have happened and it would be a different mechanism.
    expect(api.listSuggestions).toHaveBeenCalledTimes(1);
  });

  it('keeps a row the surface still asks for, in place', async () => {
    // Two rows and the FIRST one updated: a fixture of one cannot tell "replaced where it was" from
    // "removed and appended", and both would satisfy a length assertion.
    api.listSuggestions.mockResolvedValue([suggestion(), suggestion({ id: 's-2' })]);
    render(<Probe bump={0} updated={suggestion({ state: 'dismissed', reason: 'not this quarter' })} />);
    await waitFor(() => expect(rows()).toBe('s-1:active,s-2:active'));

    apply();
    // An UNFILTERED list is every state, so a dismissal is a row that changed rather than one that left —
    // and it must not jump to the bottom under the reader.
    await waitFor(() => expect(rows()).toBe('s-1:dismissed,s-2:active'));
    // The unfiltered ask is no query at all, rather than a state that happens to match everything.
    expect(api.listSuggestions).toHaveBeenCalledWith(undefined);
  });

  it('ignores a record that is not in this list', async () => {
    api.listSuggestions.mockResolvedValue([suggestion()]);
    render(<Probe bump={0} state="active" updated={suggestion({ id: 's-9', state: 'actioned' })} />);
    await waitFor(() => expect(rows()).toBe('s-1:active'));

    apply();
    // Neither dropped nor inserted: two surfaces share this hook, and one applying its own record must not
    // reshape the other's list.
    expect(rows()).toBe('s-1:active');
  });

  it('says a read failed rather than showing an empty list', async () => {
    api.listSuggestions.mockRejectedValue(new Error('nope'));
    render(<Probe bump={0} state="active" updated={suggestion()} />);
    // "Nothing has been filed" and "we could not find out what was filed" are different facts, and only the
    // second is a cue to ask again.
    await waitFor(() => expect(screen.getByTestId('failed').textContent).toBe('true'));
    expect(rows()).toBe('');
  });
});
