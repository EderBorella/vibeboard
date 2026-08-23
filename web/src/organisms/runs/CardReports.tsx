import { Button } from '../../atoms/Button';
import { Chip } from '../../atoms/Chip';
import { Readout } from '../../atoms/Readout';
import { Surface } from '../../atoms/Surface';
import { Text } from '../../atoms/Text';
import type { CardLedgerData, RunRecord, RunStatus } from '../../lib/api';
import type { Card } from '../../lib/shared';
import { FigureRow } from '../../molecules/FigureRow';
import { Row } from '../shared/Row';
import { ForgiveAttempts } from './ForgiveAttempts';
import { costLabel, usageTotal } from './format';

interface Props {
  // The card these runs belong to. The records name it too, but the ledger offers an action ON the
  // card, and reading its identity out of the first row would make a control depend on a list.
  card: Card;
  runs: RunRecord[];
  // What this card has cost and how many attempts each skill has used. Null until it arrives.
  account: CardLedgerData | null;
  onOpen: (run: RunRecord) => void;
  onCancel: (run: RunRecord) => void;
  // Refetch, after the attempts have been cleared — see ForgiveAttempts.
  onForgiven: () => void;
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
export function CardReports({ card, runs, account, onOpen, onCancel, onForgiven }: Props) {
  if (runs.length === 0) return null;
  return (
    <section className="reports" aria-label="Reports">
      <Text caps>Reports</Text>
      {[...runs].reverse().map((r) => (
        <Row key={r.run} className={r.resolved ? 'resolved' : undefined}>
          <Surface
            as="button"
            variant="flat"
            className="report-open"
            data-testid="report-open"
            title={`Open the report from ${r.skill}`}
            onClick={() => onOpen(r)}
          >
            {/* A resolved run keeps its chip — it did end needing you — but says it was answered,
                so the history reads as history rather than a row still asking. */}
            <Chip pill state={r.status} className="report-chip vb-readout vb-fixed" testId="report-chip">
              {r.resolved ? `${LABELS[r.status]} · dealt with` : LABELS[r.status]}
            </Chip>
            <span className="report-skill">{r.skill}</span>
            {/* Cost only, and only when reported: the row has one line, and the full breakdown is
                one click away in the report itself. */}
            {costLabel(r.usage) && <Readout testId="report-cost">{costLabel(r.usage)}</Readout>}
            <Readout testId="report-when">{when(r)}</Readout>
            <span className="report-summary">{r.summary ?? r.note ?? ''}</span>
          </Surface>
          {(r.status === 'running' || r.status === 'queued') && (
            // Acts — it cancels a live run. `.report-stop` still owns the danger-on-hover colour.
            <Button
              className="report-stop vb-fixed"
              data-testid="report-stop"
              title={`Stop the ${r.skill} run`}
              onClick={() => onCancel(r)}
            >
              Stop
            </Button>
          )}
        </Row>
      ))}
      {account && <CardLedger card={card} account={account} onForgiven={onForgiven} />}
    </section>
  );
}

// What this card has cost, and how close each skill is to its attempt cap. The cap is the number that
// decides whether auto-pilot will try again, so "2 of 3" is the fact worth showing — a bare count says
// nothing about how much room is left.
//
// Says "usage" rather than "cost": for a subscription-backed model the figure the backend reports is
// API-equivalent, not what you were billed.
function CardLedger({
  card,
  account,
  onForgiven,
}: {
  card: Card;
  account: CardLedgerData;
  onForgiven: () => void;
}) {
  const { spend, attempts, attemptCap } = account;
  const used = Object.entries(attempts).filter(([, n]) => n > 0);
  if (spend.runs === 0) return null;
  // A `div` and not the `p` this was, because the clear-attempts control brings the confirmation
  // dialog's backdrop with it and a `div` inside a `p` is closed by the parser before it is reached —
  // the dialog would be rendered outside the tree React thinks it put it in.
  return (
    <FigureRow testId="reports-ledger">
      <Readout>{usageTotal(spend)}</Readout>
      {/* The count and the way to clear it, in the same line. Offered from the first spent attempt
          rather than only at the cap: a card blocked by the machine is worth clearing before it runs
          out of tries, and a control that appears only once everything has already stopped is one
          nobody finds in time. Not offered at all where nothing has burned — there is nothing to
          clear, and a button that can only report "nothing happened" is noise. */}
      {used.length > 0 && (
        <>
          <Readout>{used.map(([skill, n]) => `${skill} ${n} of ${attemptCap}`).join(' · ')}</Readout>
          <ForgiveAttempts board={card.board} card={card.id} onForgiven={onForgiven} />
        </>
      )}
    </FigureRow>
  );
}
