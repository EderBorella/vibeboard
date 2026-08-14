import { useCallback, useState } from 'react';
import { listSuggestions } from '../api';
import type { Suggestion, SuggestionState } from '../shared';
import { useFetched } from '../useFetched';

const EMPTY: Suggestion[] = [];

// What agents filed, as the two surfaces that show it see it. Mirrors `useDiary`: the endpoint answers on
// mount, `bump` is a project switch, and `refresh` is an explicit ask.
//
// NO SOCKET HALF, and that is the one deliberate difference. The suggestions route broadcasts nothing —
// the watcher already rebuilds the board snapshot when a file lands in the folder — so there is no message
// to subscribe to. A second channel nothing listened on fired the same refresh twice, and `POST` says so
// where it declines to add one.
export function useSuggestions(
  bump: number,
  // Filtered by the SERVER, so the pane can ask for the active ones and never scan the rest.
  state?: SuggestionState,
): {
  suggestions: Suggestion[];
  failed: boolean;
  refresh: () => void;
  // For the surface that just changed one: the answer carries the record as the server saved it, and
  // without this the row went on showing the state it had before the click.
  apply: (suggestion: Suggestion) => void;
} {
  const [asked, setAsked] = useState(0);

  // `bump` is a new project and `asked` is an explicit refresh; neither is read by the fetch, and both
  // must refetch.
  //
  // A failure is said out loud rather than shown as an empty list. "Nothing has been filed" and "we
  // could not find out what was filed" are different facts, and only the second is a cue to ask again.
  const {
    value: suggestions,
    failed,
    setValue: setSuggestions,
  } = useFetched<Suggestion[]>(() => listSuggestions(state), [bump, asked, state], EMPTY);

  const refresh = useCallback(() => setAsked((n) => n + 1), []);
  const apply = useCallback(
    (updated: Suggestion) => {
      setSuggestions((current) =>
        current.flatMap((s) => {
          if (s.id !== updated.id) return [s];
          // This surface asked for one state and the record is no longer in it, so it LEAVES the list:
          // an actioned suggestion sitting in a list of active ones is a row whose buttons do nothing.
          return state !== undefined && updated.state !== state ? [] : [updated];
        }),
      );
    },
    [state, setSuggestions],
  );
  return { suggestions, failed, refresh, apply };
}
