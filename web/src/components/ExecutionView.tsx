import type { RunRecord } from '../api';
import { costLabel } from '../runs/format';
import { elapsed, groupRuns } from '../runs/viewmodel';
import type { Card } from '../shared';

interface Props {
  runs: RunRecord[];
  // Ids the server is holding: a record can say `running` while the server has already moved on, and
  // only the server knows what it can still stop.
  active: string[];
  queued: string[];
  // For resolving a run's card, so a row can say what it is about and open it.
  cards: Card[];
  now: number;
  onOpenCard: (card: Card, run: RunRecord) => void;
  onCancel: (run: RunRecord) => void;
  // Deal with a run without opening its card. The only way to clear an interrupted run whose card
  // has since been closed, and the quick path for one you have already read.
  onResolve: (run: RunRecord) => void;
}

const COLUMNS = [
  { key: 'active', label: 'In progress' },
  { key: 'attention', label: 'Requires attention' },
  { key: 'done', label: 'Done' },
] as const;

// Every run in the project, in three columns: what is happening, what is waiting for a decision,
// and what came back. Failed and interrupted runs sit under "Requires attention" rather than
// "Done" — burying a broken run under successes is how it goes unnoticed for a week.
export function ExecutionView({ runs, active, queued, cards, now, onOpenCard, onCancel, onResolve }: Props) {
  const grouped = groupRuns(runs);

  return (
    <main className="execution">
      {COLUMNS.map((column) => {
        const group = grouped[column.key];
        return (
          <section key={column.key} className="exec-column" aria-label={column.label}>
            <h3 className="exec-head">
              {column.label}
              <span className="exec-count">{group.length}</span>
            </h3>
            {group.length === 0 && <p className="exec-empty">Nothing here.</p>}
            {group.map((record) => {
              const card = cards.find((c) => c.id === record.card);
              const stoppable = active.includes(record.run) || queued.includes(record.run);
              return (
                <div key={record.run} className="exec-run">
                  <div className="exec-run-top">
                    <span className={`report-chip chip-${record.status}`}>{record.status}</span>
                    <span className="exec-skill">{record.skill}</span>
                    {/* What it cost, beside how long it took — the two things a dashboard row is
                        actually asked. Absent while a run is still in flight. */}
                    {costLabel(record.usage) && <span className="exec-cost">{costLabel(record.usage)}</span>}
                    <span className="exec-when">{elapsed(record, now)}</span>
                  </div>
                  <button
                    type="button"
                    className="exec-card"
                    // A run whose card has gone can still be read; there is just nothing to open.
                    disabled={card === undefined}
                    title={card ? `Open ${record.card}` : `${record.card} is no longer on the board`}
                    onClick={() => card && onOpenCard(card, record)}
                  >
                    <span className="link-id">{record.card}</span>{' '}
                    <span className="link-title">{card?.title ?? '(gone)'}</span>
                  </button>
                  {(record.summary || record.note) && (
                    <p className="exec-summary">{record.summary ?? record.note}</p>
                  )}
                  {stoppable && (
                    <button
                      type="button"
                      className="report-stop"
                      title={`Stop the ${record.skill} run on ${record.card}`}
                      onClick={() => onCancel(record)}
                    >
                      Stop
                    </button>
                  )}
                  {column.key === 'attention' && (
                    <button
                      type="button"
                      className="report-dismiss"
                      title={`Mark the ${record.skill} run on ${record.card} dealt with`}
                      onClick={() => onResolve(record)}
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </main>
  );
}
