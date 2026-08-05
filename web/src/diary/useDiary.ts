import { useCallback, useEffect, useState } from 'react';
import { type DiaryEntry, listDiary } from '../api';
import { useSharedWs } from './../ws';

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
} {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [failed, setFailed] = useState(false);
  const [asked, setAsked] = useState(0);
  const ws = useSharedWs(bump);

  // `bump` is a new project and `asked` is an explicit refresh; neither is read inside the effect, and
  // both must refetch. Same idiom as useAutopilot and useCardRuns.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate triggers
  useEffect(() => {
    let live = true;
    listDiary()
      .then((next) => {
        if (!live) return;
        setEntries(next);
        setFailed(false);
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
        if (entry) setEntries((current) => [...current, entry]);
      }),
    [ws],
  );

  const refresh = useCallback(() => setAsked((n) => n + 1), []);
  return { entries, failed, refresh };
}
