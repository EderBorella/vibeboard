import type { CardAccount, RunRecord, RunStatus } from '../api';
import { costLabel, usageTotal } from '../runs/format';

interface Props {
  runs: RunRecord[];
  // What this card has cost and how many attempts each skill has used. Null until it arrives.
  account: CardAccount | null;
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
export function CardReports({ runs, account, onOpen, onCancel }: Props) {
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
      {account && <CardLedger account={account} />}
    </section>
  );
}

// What this card has cost, and how close each skill is to its attempt cap. The cap is the number that
// decides whether auto-pilot will try again, so "2 of 3" is the fact worth showing — a bare count says
// nothing about how much room is left.
//
// Says "usage" rather than "cost": for a subscription-backed model the figure the backend reports is
// API-equivalent, not what you were billed.
function CardLedger({ account }: { account: CardAccount }) {
  const { spend, attempts, attemptCap } = account;
  const used = Object.entries(attempts).filter(([, n]) => n > 0);
  if (spend.runs === 0) return null;
  return (
    <p className="reports-ledger">
      <span>{usageTotal(spend)}</span>
      {used.length > 0 && (
        <span className="reports-attempts">
          {used.map(([skill, n]) => `${skill} ${n} of ${attemptCap}`).join(' · ')}
        </span>
      )}
    </p>
  );
}
