import type { RunRecord, RunStatus } from '../api';
import { costLabel } from '../runs/format';

interface Props {
  runs: RunRecord[];
  onOpen: (run: RunRecord) => void;
  onCancel: (run: RunRecord) => void;
}

// How each status reads to a human. The label is not the status word: "attention" is a state, but
// "Needs you" is what the user has to do about it.
const LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  success: 'Done',
  attention: 'Needs you',
  failed: 'Failed',
  cancelled: 'Stopped',
  interrupted: 'Interrupted',
};

function when(record: RunRecord): string {
  const stamp = record.finished ?? record.started;
  // The id is a stamp too, but a run's own timestamps are what a person means by "when".
  return stamp.slice(0, 16).replace('T', ' ');
}

// A card's run history. Deliberately not link-shaped: chips, times and one-line summaries, so it
// cannot be mistaken for the card links above it — a report is not another card.
export function CardReports({ runs, onOpen, onCancel }: Props) {
  if (runs.length === 0) return null;
  return (
    <section className="reports" aria-label="Reports">
      <h4 className="reports-head">Reports</h4>
      {[...runs].reverse().map((r) => (
        <div key={r.run} className={`report-row status-${r.status}${r.resolved ? ' resolved' : ''}`}>
          <button
            type="button"
            className="report-open"
            title={`Open the report from ${r.skill}`}
            onClick={() => onOpen(r)}
          >
            {/* A resolved run keeps its chip — it did end needing you — but says it was answered,
                so the history reads as history rather than a row still asking. */}
            <span className={`report-chip chip-${r.status}`}>
              {r.resolved ? `${LABELS[r.status]} · dealt with` : LABELS[r.status]}
            </span>
            <span className="report-skill">{r.skill}</span>
            {/* Cost only, and only when reported: the row has one line, and the full breakdown is
                one click away in the report itself. */}
            {costLabel(r.usage) && <span className="report-cost">{costLabel(r.usage)}</span>}
            <span className="report-when">{when(r)}</span>
            <span className="report-summary">{r.summary ?? r.note ?? ''}</span>
          </button>
          {(r.status === 'running' || r.status === 'queued') && (
            <button
              type="button"
              className="report-stop"
              title={`Stop the ${r.skill} run`}
              onClick={() => onCancel(r)}
            >
              Stop
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
