import { useCallback, useEffect, useRef, useState } from 'react';
import { type DiaryEntry, listDiary } from '../../lib/api';
import { useSharedWs } from '../../lib/ws';

// The project's narrative, as this tab sees it.
//
// Two sources, the same pair `useAutopilot` uses and for the same reason: the endpoint answers on mount,
// and every append arrives over the socket the board already shares. The socket half is not a nicety here
// — `PROJECT-LOG.md` is excluded from the watcher, so nothing else would ever tell this tab that
// auto-pilot has written twenty lines since it was opened.
//
// Oldest first, exactly as the file is written. The view reverses it: a file is read forwards, a feed is
// read backwards, and doing that here would mean the hook and the endpoint disagreed about what "the
// diary" is.
export function useDiary(bump: number): {
  entries: DiaryEntry[];
  failed: boolean;
  refresh: () => void;
  // For the tab that just wrote one. The socket carries an append to the OTHER tabs; this tab is the one that
  // posted it, and without this its own entry appeared only on the next fetch.
  add: (entry: DiaryEntry) => void;
} {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [failed, setFailed] = useState(false);
  const [asked, setAsked] = useState(0);
  // Set by the socket handler, read when a fetch resolves. A push arriving while the first fetch is in flight
  // used to be overwritten by that fetch's answer and lost for good — reachable, because the route broadcasts
  // AFTER the append, so the entry may not be in the response already on its way back.
  const pushedMidFetch = useRef(false);
  const ws = useSharedWs(bump);

  // `bump` is a new project and `asked` is an explicit refresh; neither is read inside the effect, and
  // both must refetch. Same idiom as useAutopilot and useCardRuns.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate triggers
  useEffect(() => {
    let live = true;
    pushedMidFetch.current = false;
    listDiary()
      .then((next) => {
        if (!live) return;
        setFailed(false);
        // One more read rather than a merge. Merging needs an identity for an entry, and the only candidate is
        // its content — so two genuinely identical events would collapse into one. Asking again is cheap,
        // cannot lose anything, and terminates: it only repeats if another push lands during the retry.
        if (pushedMidFetch.current) {
          pushedMidFetch.current = false;
          setAsked((n) => n + 1);
          return;
        }
        setEntries(next);
      })
      .catch(() => {
        // Said out loud rather than shown as an empty diary. "Nothing has happened in this project" and
        // "we could not find out what happened" are different facts, and the second one is the reader's
        // cue to reload rather than to believe the screen.
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [bump, asked]);

  useEffect(
    () =>
      ws.subscribe((msg) => {
        if (msg.type !== 'diary:entry') return;
        const entry = (msg as { entry?: DiaryEntry }).entry;
        // Appended rather than refetched: the server pushes the entry itself, and asking for the whole
        // file again on every dispatch would re-read a monotonically growing document to learn one line.
        if (!entry) return;
        pushedMidFetch.current = true;
        setEntries((current) => [...current, entry]);
      }),
    [ws],
  );

  const refresh = useCallback(() => setAsked((n) => n + 1), []);
  const add = useCallback((entry: DiaryEntry) => setEntries((current) => [...current, entry]), []);
  return { entries, failed, refresh, add };
}
