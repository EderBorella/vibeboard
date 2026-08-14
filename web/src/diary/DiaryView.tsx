import { memo, useMemo, useState } from 'react';
import { addDiaryEntry, type DiaryEntry } from '../api';
import { MAX_ENTRY_TEXT, type Suggestion } from '../shared';
import { useSuggestions } from '../suggestions/useSuggestions';
import { useAction } from '../useAction';
import { useDiary } from './useDiary';

// The diary, and the permanent way to add to it.
//
// A tab rather than a button in a corner, because the spec asks for a permanent one: a hand-driven session's
// diary should read like an auto-pilot one, so adding an entry has to be reachable from wherever the person
// happens to be working. The Control tab was the obvious home and is the wrong one — that is a file editor
// for files a person edits, and this file is append-only and written only through an endpoint.

// Newest first here, oldest first everywhere else. A file is read forwards; a feed is read backwards. Copied,
// never reversed in place — `entries` belongs to the hook.
//
// Paired with the index it had in the file, which is what gives each row a stable React key. Content is not an
// identity: two identical events in the same millisecond are possible, and duplicate keys make React drop one.
function newestFirst(entries: DiaryEntry[]): { entry: DiaryEntry; at: number }[] {
  return entries.map((entry, at) => ({ entry, at })).reverse();
}

function when(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString();
}

// What the entry was about, as a line of chips. Only what is actually there: a checkup carries no card, and
// an invented "—" for every absent field would make every entry look the same shape.
function About({ entry }: { entry: DiaryEntry }) {
  const bits: string[] = [];
  if (entry.iteration !== undefined) bits.push(`iteration ${entry.iteration}`);
  if (entry.card) bits.push(entry.board ? `${entry.board}/${entry.card}` : entry.card);
  if (entry.skill) bits.push(entry.skill);
  if (bits.length === 0) return null;
  return (
    <span className="diary-about">
      {bits.map((bit) => (
        <span className="diary-chip" key={bit}>
          {bit}
        </span>
      ))}
    </span>
  );
}

// Its own memoised component, because the composer sits above it: without this, every keystroke re-rendered
// every row — measured at 143ms per character with 3,000 entries, which is unusable on a project that has had
// a long night. `entries` only changes when the log does.
const DiaryList = memo(function DiaryList({ entries }: { entries: DiaryEntry[] }) {
  const ordered = useMemo(() => newestFirst(entries), [entries]);
  return (
    <ol className="diary-list">
      {ordered.map(({ entry, at }) => (
        <li className="diary-entry" data-kind={entry.kind} key={`${at}-${entry.at}`}>
          <div className="diary-meta">
            <span className="diary-kind">{entry.kind}</span>
            <time dateTime={entry.at}>{when(entry.at)}</time>
            <About entry={entry} />
            {entry.outcome && <span className="diary-outcome">{entry.outcome}</span>}
          </div>
          <p className="diary-text">{entry.text}</p>
        </li>
      ))}
    </ol>
  );
});

// The right-hand half (decision 48). Newest first, like the diary beside it, and copied rather than
// reversed in place — `suggestions` belongs to the hook.
//
// Read-only here. The two actions live in the dock's pane, where a person is working on one thing; this
// column is the RECORD, and it shows dismissed ones with their reason, which is the part that stops a
// later checkup re-raising the same finding.
function FiledList({ suggestions }: { suggestions: Suggestion[] }) {
  const ordered = useMemo(() => [...suggestions].reverse(), [suggestions]);
  return (
    <ol className="filed-list">
      {ordered.map((s) => (
        <li className="filed-entry" data-state={s.state} key={s.id}>
          <div className="filed-meta">
            <span className="filed-state">{s.state}</span>
            <time dateTime={s.created}>{when(s.created)}</time>
            {/* Only what is there: a project-level finding carries no card, and an invented dash for
                every absent field would make every row look the same shape. */}
            {s.run && <span className="diary-chip">{s.run}</span>}
            {s.card && <span className="diary-chip">{s.card}</span>}
            {s.became && <span className="diary-chip">became {s.became}</span>}
          </div>
          <p className="filed-title">{s.title}</p>
          {s.body && <p className="filed-text">{s.body}</p>}
          {s.reason && <p className="filed-reason">{s.reason}</p>}
        </li>
      ))}
    </ol>
  );
}

function FiledColumn({ bump }: { bump: number }) {
  const { suggestions, failed, refresh } = useSuggestions(bump);
  return (
    <section className="filed" aria-label="What agents filed">
      <div className="diary-head">
        <h2>What agents filed</h2>
        <p className="diary-lede">
          Work an agent noticed and deliberately did not do. Nothing blocks on one and nothing is lost; triage
          them in the Suggestions pane.
        </p>
        <button type="button" className="btn-secondary diary-refresh" onClick={refresh}>
          Refresh suggestions
        </button>
      </div>
      {failed ? (
        <div className="diary-empty">
          <p>Could not read what agents filed.</p>
          <button type="button" className="btn-secondary" onClick={refresh}>
            Try again
          </button>
        </div>
      ) : suggestions.length === 0 ? (
        // Said out loud, like the diary's own empty state: an empty column reads as a broken one.
        <div className="diary-empty">
          <p>Nothing has been filed in this project yet.</p>
        </div>
      ) : (
        <FiledList suggestions={suggestions} />
      )}
    </section>
  );
}

export function DiaryView({ bump }: { bump: number }) {
  const { entries, failed, refresh, add: onWritten } = useDiary(bump);
  const [draft, setDraft] = useState('');
  const { busy, error, run } = useAction();

  const text = draft.trim();

  async function add(): Promise<void> {
    await run(async () => {
      // The server's copy, not the draft: it carries the timestamp and whatever the server made of the rest,
      // so showing our own guess would put a different entry on screen from the one on disk.
      // `note`, not `lifecycle`. That class is the spec's own for pre-flight, approval and every stop with
      // its reason — the class auto-pilot's loop reads — and a line somebody typed by hand is none of them.
      const written = await addDiaryEntry({ kind: 'note', text });
      onWritten(written);
      // Cleared only AFTER the write lands. Clearing first loses whatever was typed the moment the post
      // fails, and a paragraph somebody wrote about why they did something is not recoverable from anywhere.
      setDraft('');
    });
  }

  return (
    // THE SPLIT (decision 48): the diary on the left, what agents filed on the right, in the space the
    // diary list never uses. Both are the record of what happened while nobody was watching.
    <div className="log-split">
      <section className="diary" aria-label="Project log">
        <div className="diary-head">
          <h2>Project log</h2>
          <p className="diary-lede">
            One line per event — what happened to this project, in order. Auto-pilot will write here after
            every dispatch and whenever it stops; add your own for anything you did by hand.
          </p>
          {/* Always reachable, not only after a failed read. New entries arrive over the socket, and a dropped
            socket is invisible: reconnecting does not change `bump`, and the server replays only the board
            snapshot on connect — so without this the log can sit silently stale with no way to ask again. */}
          <button type="button" className="btn-secondary diary-refresh" onClick={refresh}>
            Refresh
          </button>
        </div>

        <div className="diary-compose">
          <textarea
            aria-label="Add to the log"
            placeholder="What happened?"
            value={draft}
            rows={2}
            // The server bounds an entry at this length and truncates quietly, which is right for an
            // agent's summary and wrong for a paragraph somebody typed — this file argues two screens down
            // that such a paragraph is not recoverable from anywhere. So the box will not accept more than
            // will survive, rather than accepting it and losing the tail on save.
            maxLength={MAX_ENTRY_TEXT}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null || text === ''}
            onClick={() => void add()}
          >
            {busy ? 'Adding…' : 'Add entry'}
          </button>
        </div>
        {/* `assertive`, not `polite`: the entry was NOT written, and the box still holds what was typed. */}
        <div aria-live="assertive">{error && <p className="diary-error">{error}</p>}</div>

        {failed ? (
          <div className="diary-empty">
            <p>Could not read this project’s log.</p>
            <button type="button" className="btn-secondary" onClick={refresh}>
              Try again
            </button>
          </div>
        ) : entries.length === 0 ? (
          // Said out loud. An empty screen would read as a broken one, and this is the file a reader comes
          // to precisely when they want to know what has been going on.
          <div className="diary-empty">
            <p>Nothing has happened in this project yet.</p>
          </div>
        ) : (
          <DiaryList entries={entries} />
        )}
      </section>
      <FiledColumn bump={bump} />
    </div>
  );
}
