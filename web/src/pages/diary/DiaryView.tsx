import { memo, useMemo, useState } from 'react';
import { Button } from '../../atoms/Button';
import { Chip } from '../../atoms/Chip';
import { Control } from '../../atoms/Control';
import { Stack } from '../../atoms/Stack';
import { Text } from '../../atoms/Text';
import { addDiaryEntry, type DiaryEntry } from '../../lib/api';
import { MAX_ENTRY_TEXT, type Suggestion } from '../../lib/shared';
import { useAction } from '../../lib/useAction';
import { FigureRow } from '../../molecules/FigureRow';
import { stateClass } from '../../molecules/state-tones';
import { useDiary } from '../../organisms/diary/useDiary';
import { List } from '../../organisms/shared/List';
import { Row } from '../../organisms/shared/Row';
import { useSuggestions } from '../../organisms/suggestions/useSuggestions';

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
    <Stack wrap gap={3} testId="diary-about">
      {bits.map((bit) => (
        <Chip pill className="vb-readout" testId="diary-chip" key={bit}>
          {bit}
        </Chip>
      ))}
    </Stack>
  );
}

// Its own memoised component, because the composer sits above it: without this, every keystroke re-rendered
// every row — measured at 143ms per character with 3,000 entries, which is unusable on a project that has had
// a long night. `entries` only changes when the log does.
const DiaryList = memo(function DiaryList({ entries }: { entries: DiaryEntry[] }) {
  const ordered = useMemo(() => newestFirst(entries), [entries]);
  return (
    <List as="ol" className="diary-list">
      {ordered.map(({ entry, at }) => (
        // `Row stack rail` — the kind still colours the rail, and the four `[data-kind]` rules are the
        // only thing left of `.diary-entry`: three of the four kinds are not tones (`--accent-2` is the
        // palette's secondary hue and Phase 13 ruled it is not a state).
        <Row as="li" stack variant="flat" rail data-kind={entry.kind} key={`${at}-${entry.at}`}>
          <FigureRow>
            <Text caps ink="strong" size="micro">
              {entry.kind}
            </Text>
            <time dateTime={entry.at}>{when(entry.at)}</time>
            <About entry={entry} />
            {entry.outcome && <Text ink="strong">{entry.outcome}</Text>}
          </FigureRow>
          <p className="diary-text">{entry.text}</p>
        </Row>
      ))}
    </List>
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
  // `filed-list` declares nothing now that `List` owns the column's layout — it is kept as the handle
  // three readers reach this column by (`visual/support/surfaces.ts`, `test/diary-view.test.tsx`,
  // `test/state-inks.test.tsx`), and dropping it silently emptied all three.
  return (
    <List as="ol" className="filed-list">
      {/* `stateClass` beside the attribute, and it is not decoration: React types every `data-*` as
          `any`, so `data-state={s.state}` alone would compile for a state with no row in the table and
          the rail would silently take whatever colour it inherited. The call is what the compiler
          checks — see molecules/state-tones.ts. */}
      {ordered.map((s) => (
        <Row
          as="li"
          stack
          variant="flat"
          rail
          className={stateClass(s.state)}
          data-state={s.state}
          key={s.id}
        >
          {/* TWO LINES, NOT ONE WRAPPED ONE. This column is 42% of the split and its readout block held
              four figures — a state, a full locale timestamp and up to three id chips, 366px of content
              in a 266px line — so it wrapped, and check 7 read it as what it was: a row of figures that
              does not align. A `FigureRow` of the two facts the entry is ABOUT ITSELF fits (188px),
              and the ids it POINTS AT are a `.diary-about` group, which the diary beside it already
              uses for exactly that. Stacked rather than wrapped in this column — see pages/log/log.css. */}
          <FigureRow>
            <Text caps ink="strong" size="micro" testId="filed-state">
              {s.state}
            </Text>
            <time dateTime={s.created}>{when(s.created)}</time>
          </FigureRow>
          {/* Only what is there: a project-level finding carries no card, and an invented dash for
              every absent field would make every row look the same shape. */}
          {(s.run || s.card || s.became) && (
            <Stack direction="column" gap={3} align="start" testId="diary-about">
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
              {s.became && (
                <Chip pill className="vb-readout">
                  became {s.became}
                </Chip>
              )}
            </Stack>
          )}
          <Text lead size="lead" ink="strong">
            {s.title}
          </Text>
          {/* `.filed-text` IS DELETED: it was `--t-body`, 1.5 and `--muted`, which is `Text lead`
              declaration for declaration. `.filed-reason` was that plus the italic, which is `hint`. */}
          {s.body && <Text lead>{s.body}</Text>}
          {s.reason && (
            <Text lead role="hint">
              {s.reason}
            </Text>
          )}
        </Row>
      ))}
    </List>
  );
}

function FiledColumn({ bump }: { bump: number }) {
  const { suggestions, failed, refresh } = useSuggestions(bump);
  return (
    <section className="filed" aria-label="What agents filed">
      <Stack direction="column" gap={2} className="diary-head">
        <h2>What agents filed</h2>
        <Text lead>
          Work an agent noticed and deliberately did not do. Nothing blocks on one and nothing is lost; triage
          them in the Suggestions pane.
        </Text>
        <Button size="md" className="diary-refresh" onClick={refresh}>
          Refresh suggestions
        </Button>
      </Stack>
      {failed ? (
        <Stack direction="column" align="start" gap={4} className="diary-empty">
          <p>Could not read what agents filed.</p>
          <Button size="md" onClick={refresh}>
            Try again
          </Button>
        </Stack>
      ) : suggestions.length === 0 ? (
        // Said out loud, like the diary's own empty state: an empty column reads as a broken one.
        <Stack direction="column" align="start" gap={4} className="diary-empty">
          <p>Nothing has been filed in this project yet.</p>
        </Stack>
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
        <Stack direction="column" gap={2} className="diary-head">
          <h2>Project log</h2>
          <Text lead>
            One line per event — what happened to this project, in order. Auto-pilot will write here after
            every dispatch and whenever it stops; add your own for anything you did by hand.
          </Text>
          {/* Always reachable, not only after a failed read. New entries arrive over the socket, and a dropped
            socket is invisible: reconnecting does not change `bump`, and the server replays only the board
            snapshot on connect — so without this the log can sit silently stale with no way to ask again. */}
          <Button size="md" className="diary-refresh" onClick={refresh}>
            Refresh
          </Button>
        </Stack>

        <Stack align="start" gap={4} className="diary-compose">
          {/* NOT a `Field`: a composer's label is its placeholder and the button beside it. */}
          <Control
            as="textarea"
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
          <Button
            variant="primary"
            size="md"
            disabled={busy !== null || text === ''}
            onClick={() => void add()}
          >
            {busy ? 'Adding…' : 'Add entry'}
          </Button>
        </Stack>
        {/* `assertive`, not `polite`: the entry was NOT written, and the box still holds what was typed. */}
        <div aria-live="assertive">{error && <Text role="error">{error}</Text>}</div>

        {failed ? (
          <Stack direction="column" align="start" gap={4} className="diary-empty">
            <p>Could not read this project’s log.</p>
            <Button size="md" onClick={refresh}>
              Try again
            </Button>
          </Stack>
        ) : entries.length === 0 ? (
          // Said out loud. An empty screen would read as a broken one, and this is the file a reader comes
          // to precisely when they want to know what has been going on.
          <Stack direction="column" align="start" gap={4} className="diary-empty">
            <p>Nothing has happened in this project yet.</p>
          </Stack>
        ) : (
          <DiaryList entries={entries} />
        )}
      </section>
      <FiledColumn bump={bump} />
    </div>
  );
}
