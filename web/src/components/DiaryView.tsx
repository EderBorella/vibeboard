import { useState } from 'react';
import { addDiaryEntry, type DiaryEntry } from '../api';
import { useDiary } from '../diary/useDiary';

// The diary, and the permanent way to add to it.
//
// A tab rather than a button in a corner, because the spec asks for a permanent one: a hand-driven session's
// diary should read like an auto-pilot one, so adding an entry has to be reachable from wherever the person
// happens to be working. The Control tab was the obvious home and is the wrong one — that is a file editor
// for files a person edits, and this file is append-only and written only through an endpoint.

// Newest first here, oldest first everywhere else. A file is read forwards; a feed is read backwards.
function newestFirst(entries: DiaryEntry[]): DiaryEntry[] {
  return [...entries].reverse();
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

export function DiaryView({ bump }: { bump: number }) {
  const { entries, failed, refresh } = useDiary(bump);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const text = draft.trim();

  async function add(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await addDiaryEntry({ kind: 'lifecycle', text });
      // Cleared only AFTER the write lands. Clearing first loses whatever was typed the moment the post
      // fails, and a paragraph somebody wrote about why they did something is not recoverable from anywhere.
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="diary">
      <div className="diary-head">
        <h2>Project log</h2>
        <p className="diary-lede">
          One line per event — what happened to this project, in order. Auto-pilot writes here after every
          dispatch and whenever it stops; add your own for anything you did by hand.
        </p>
      </div>

      <div className="diary-compose">
        <textarea
          aria-label="Add to the log"
          placeholder="What happened?"
          value={draft}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          className="btn-primary"
          disabled={busy || text === ''}
          onClick={() => void add()}
        >
          {busy ? 'Adding…' : 'Add entry'}
        </button>
      </div>
      {error && <p className="diary-error">{error}</p>}

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
        <ol className="diary-list">
          {newestFirst(entries).map((entry) => (
            <li className="diary-entry" data-kind={entry.kind} key={`${entry.at}-${entry.text}`}>
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
      )}
    </section>
  );
}
