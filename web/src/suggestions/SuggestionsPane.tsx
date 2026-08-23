import { useState } from 'react';
import { cardSuggestion, patchSuggestion } from '../api';
import { Button } from '../atoms/Button';
import { Chip } from '../atoms/Chip';
import { Control } from '../atoms/Control';
import { Surface } from '../atoms/Surface';
import { Text } from '../atoms/Text';
import { FigureRow } from '../molecules/FigureRow';
import { asState } from '../molecules/state-tones';
import { List } from '../organisms/shared/List';
import { Row } from '../organisms/shared/Row';
import type { Suggestion, SuggestionLevel } from '../shared';
import { SUGGESTION_LEVELS } from '../shared';
import { useAction } from '../useAction';

// The dock's second occupant (decision 48): what agents filed, and the two things a person may do with
// one. `UtilityDock` knows nothing about any particular pane, so this is one descriptor in WorkArea plus
// this component.
//
// TWO ACTIONS, FIXED (decision 49). Dismiss, with a reason; and Make a card, at a level the user picks.
// Nothing is ever DISPATCHED from a suggestion: the answer to one is only ever "this is real work" or
// "no", and dispatching an implementation skill at one produced work with no card to report against,
// outside the lifecycle entirely.
//
// The list is WorkArea's, because the dock's badge needs the count whether or not this pane is on screen.
// The two writes are this pane's own, like SignInPanel's: it holds its busy state, shows the server's
// refusal, and hands back the record as the server saved it.
interface Props {
  suggestions: Suggestion[];
  failed: boolean;
  onRefresh: () => void;
  // The updated record, so the list stops showing a row whose buttons would now do nothing.
  onApply: (suggestion: Suggestion) => void;
}

function when(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString();
}

export function SuggestionsPane({ suggestions, failed, onRefresh, onApply }: Props) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [level, setLevel] = useState<SuggestionLevel>('story');
  const [reason, setReason] = useState('');
  const [became, setBecame] = useState<string | null>(null);
  // A control whose refusal is invisible is a dead end. The server's words win: it knows whether the
  // suggestion was already carded, and as what.
  const { busy, error, run, setError } = useAction();

  // The picked one, else the first — the same fallback the dock uses for panes, so the actions always
  // belong to a row that is on screen even after the list changes under them.
  const picked = suggestions.find((s) => s.id === pickedId) ?? suggestions[0];

  async function act(what: () => Promise<Suggestion>): Promise<void> {
    await run(async () => {
      onApply(await what());
      setReason('');
    });
  }

  // Both notices are about the suggestion they happened to, and the actions follow whichever row is
  // picked — so carrying either across a pick would put a true sentence beside the wrong finding.
  function pick(id: string): void {
    setPickedId(id);
    setBecame(null);
    setError(null);
  }

  function dismiss(id: string): void {
    setBecame(null);
    // Trimmed to undefined rather than sent empty: the server keeps a reason for a dismissal alone, and
    // an empty string recorded as one would read as "we said why" when nobody did.
    const why = reason.trim() === '' ? undefined : reason.trim();
    void act(() => patchSuggestion(id, 'dismissed', why));
  }

  function make(id: string): void {
    void act(async () => {
      const { card, suggestion } = await cardSuggestion(id, level);
      // Which card it became is only in this answer: the row is about to leave the list.
      setBecame(card.id);
      return suggestion;
    });
  }

  if (failed) {
    return (
      <div className="suggestions-pane">
        <div className="diary-empty">
          <p>Could not read what agents filed.</p>
          <Button size="md" onClick={onRefresh}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="suggestions-pane">
      {picked === undefined ? (
        // Said out loud: an empty pane reads as a broken one, and this is the surface a person opens
        // precisely to find out whether anything is waiting.
        <div className="diary-empty">
          <p>Nothing has been filed in this project yet.</p>
        </div>
      ) : (
        <>
          {/* The actions at the top, on the picked suggestion, and Dismiss in its own colour. */}
          <div className="suggestions-actions" data-testid="suggestions-actions">
            <Button variant="danger" size="md" disabled={busy !== null} onClick={() => dismiss(picked.id)}>
              Dismiss
            </Button>
            <Control
              aria-label="Why not?"
              placeholder="Why not? (kept, so a checkup does not raise it again)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {/* NOT a `Field`: an action row of five controls with no labels between them. It drew NO
                box at all before Phase 9 — a bare UA select beside a `.vb-ctl` in the same row. */}
            <Control
              as="select"
              aria-label="Level"
              value={level}
              onChange={(e) => setLevel(e.target.value as SuggestionLevel)}
            >
              {/* Feature and story, and never task: a task needs a story to belong to, so carding one
                  either hunts for a parent or makes an orphan the machine never walks to. */}
              {SUGGESTION_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Control>
            <Button variant="primary" size="md" disabled={busy !== null} onClick={() => make(picked.id)}>
              {busy ? 'Working…' : 'Make a card'}
            </Button>
            <Button size="md" onClick={onRefresh}>
              Refresh
            </Button>
          </div>
          {/* `assertive`: the action did NOT happen, and the row is still there. */}
          <div aria-live="assertive">
            {error && <Text role="error">{error}</Text>}
            {became && <p className="suggestions-became">Carded as {became}.</p>}
          </div>

          <List as="ol" className="suggestions-list">
            {suggestions.map((s) => (
              <Row
                as="li"
                stack
                rail
                className={s.id === picked.id ? 'picked' : undefined}
                key={s.id}
                // NO TONE CLASS BESIDE IT, and that is deliberate: this rail says which row the action
                // bar acts on (`.picked`), not what state the finding is in — the state is a word in the
                // row. So the attribute is a hook for tests and for reading the DOM, and nothing here
                // decides a colour. See molecules/state-tones.ts; the value is `SuggestionState`, every member
                // of which has a row, so giving it the rail later is one declaration.
                data-state={asState(s.state)}
              >
                <Surface
                  as="button"
                  variant="flat"
                  className="vb-list suggestions-pick"
                  data-testid="suggestions-pick"
                  onClick={() => pick(s.id)}
                >
                  <span className="filed-title">{s.title}</span>
                  <FigureRow as="div">
                    <time dateTime={s.created}>{when(s.created)}</time>
                    {/* Which run filed it, and the card it was filed FROM. Only what is there: a
                        project-level finding has no card. */}
                    {s.run && (
                      <Chip pill className="vb-readout">
                        {s.run}
                      </Chip>
                    )}
                    {s.card && (
                      <Chip pill className="vb-readout">
                        {s.card}
                      </Chip>
                    )}
                  </FigureRow>
                  {s.body && <span className="filed-text">{s.body}</span>}
                </Surface>
              </Row>
            ))}
          </List>
        </>
      )}
    </div>
  );
}
