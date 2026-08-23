import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';

// One asked-and-answered fetch, with the cancel flag that fourteen hooks and panes had each written
// out for themselves: a response that lands after its trigger moved on is DROPPED, so the previous
// project's — or the previous card's — answer cannot overwrite the current one.
//
// What is NOT unified is what a rejection means, because the copies genuinely disagreed and the
// disagreement is the design. Three cases exist and each call site states which it wants:
//
//  - keep, silently — a rail that empties reads as "this project has nothing", which is a lie the
//    next trigger would quietly correct. `failed` is returned anyway and simply ignored.
//  - keep, and SAY SO — "nothing has been filed" and "we could not find out what was filed" are
//    different facts, and only the second is a cue to ask again.
//  - clear — the value is a menu of choices rather than a record, and a stale menu offers something
//    that may no longer be there.
interface FetchedOptions {
  // False asks nothing. Note this is not the same as clearing: see `onDisabled`.
  enabled?: boolean;
  onFailure?: 'keep' | 'clear';
  // What "not asking" does to what is already on screen. `keep` for a question that is merely not
  // being asked right now; `clear` when the reason it is not being asked is that its subject has
  // gone — the runs of the card you just closed must not linger under the next thing you open.
  onDisabled?: 'keep' | 'clear';
}

export interface Fetched<T> {
  value: T;
  // True when the last attempt rejected. Cleared by the next good answer.
  failed: boolean;
  // For the surface that just changed one record and knows what it became, rather than re-reading
  // the whole list to learn one row.
  setValue: Dispatch<SetStateAction<T>>;
}

export function useFetched<T>(
  fetcher: () => Promise<T>,
  // What a refetch depends on. Deliberately the caller's list: most of these hooks are triggered by
  // a snapshot or a counter that the fetcher itself never reads.
  deps: unknown[],
  initial: T,
  options: FetchedOptions = {},
): Fetched<T> {
  const { enabled = true, onFailure = 'keep', onDisabled = 'keep' } = options;
  const [value, setValue] = useState<T>(initial);
  const [failed, setFailed] = useState(false);
  // Both are remade on every render — an inline arrow, an inline `[]` — so neither can be a
  // dependency without refetching for ever. The ref holds the latest closure, which is the one the
  // render that scheduled this effect built.
  const latest = useRef(fetcher);
  latest.current = fetcher;
  const blank = useRef(initial);

  useEffect(() => {
    if (!enabled) {
      if (onDisabled === 'clear') {
        setValue(blank.current);
        setFailed(false);
      }
      return;
    }
    let live = true;
    latest
      .current()
      .then((next) => {
        if (!live) return;
        setFailed(false);
        setValue(next);
      })
      .catch(() => {
        if (!live) return;
        setFailed(true);
        if (onFailure === 'clear') setValue(blank.current);
      });
    return () => {
      live = false;
    };
  }, [...deps, enabled, onFailure, onDisabled]);

  return { value, failed, setValue };
}
