import type { CSSProperties } from 'react';
import { Button } from '../../atoms/Button';
import { Chip } from '../../atoms/Chip';
import { Readout } from '../../atoms/Readout';
import { Stack } from '../../atoms/Stack';
import { Surface } from '../../atoms/Surface';
import { Text } from '../../atoms/Text';
import type { RunRecord } from '../../lib/api';
import type { Card } from '../../lib/shared';
import { FigureRow } from '../../molecules/FigureRow';
import { ForgiveAttempts } from '../../organisms/runs/ForgiveAttempts';
import { costLabel, usageTotal } from '../../organisms/runs/format';
import { useAccounting } from '../../organisms/runs/useAccounting';
import { elapsed, groupRuns, runSubject } from '../../organisms/runs/viewmodel';
import { Row } from '../../organisms/shared/Row';

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
  // Refetch after a card's spent tries are cleared. Nothing else brings the new count back: a run
  // record lives under `results/`, which `readBoard` does not read, so stamping one moves no board
  // state and the snapshot the run list is keyed on never changes.
  onForgiven: () => void;
}

const COLUMNS = [
  { key: 'active', label: 'In progress' },
  { key: 'attention', label: 'Requires attention' },
  { key: 'done', label: 'Done' },
] as const;

// What the open button says. Three cases, and a nested ternary inside the JSX pushed the row past
// the complexity ceiling — which is the rule doing its job: this is a decision, not a label.
function openTitle(record: RunRecord, card: Card | undefined): string {
  const subject = runSubject(record);
  if (card) return `Open ${subject}`;
  if (record.card) return `${subject} is no longer on the board`;
  return 'This run is about the project, not a card';
}

// Every run in the project, in three columns: what is happening, what is waiting for a decision,
// and what came back. Failed and interrupted runs sit under "Requires attention" rather than
// "Done" — burying a broken run under successes is how it goes unnoticed for a week.
export function ExecutionView({
  runs,
  active,
  queued,
  cards,
  now,
  onOpenCard,
  onCancel,
  onResolve,
  onForgiven,
}: Props) {
  const grouped = groupRuns(runs);
  // Refetched whenever the run list changes: usage arrives when a run settles, which is a new list.
  const accounting = useAccounting(runs);

  return (
    <main className="execution" style={{ '--exec-cols': COLUMNS.length } as CSSProperties}>
      {accounting && (
        <FigureRow as="p">
          <Readout>{usageTotal(accounting.project)}</Readout>
          {/* S10: which cap will actually stop this project. A dollar figure beside a budget that can
              never trip would tell the reader the opposite of the truth. */}
          {accounting.cap && <Readout>{accounting.cap.why}</Readout>}
        </FigureRow>
      )}
      {COLUMNS.map((column) => {
        const group = grouped[column.key];
        return (
          <Surface
            key={column.key}
            as="section"
            variant="raised"
            className="exec-column"
            aria-label={column.label}
          >
            <h3 className="exec-head">
              {/* `ink="strong"`: the class named no ink, which the label suite pins as its contract. */}
              <Text caps ink="strong">
                {column.label}
              </Text>
              <Chip pill fill className="vb-readout" testId="exec-count">
                {group.length}
              </Chip>
            </h3>
            {group.length === 0 && <Text role="hint">Nothing here.</Text>}
            {group.map((record) => {
              const card = cards.find((c) => c.id === record.card);
              const subject = runSubject(record);
              const stoppable = active.includes(record.run) || queued.includes(record.run);
              return (
                <Row key={record.run} stack variant="inset">
                  <Stack align="baseline" gap={3} className="exec-run-top">
                    <Chip pill state={record.status} className="report-chip vb-readout" testId="report-chip">
                      {record.status}
                    </Chip>
                    <Text ink="strong">{record.skill}</Text>
                    {/* What it cost, beside how long it took — the two things a dashboard row is
                        actually asked. Absent while a run is still in flight. */}
                    {costLabel(record.usage) && (
                      <Readout testId="exec-cost">{costLabel(record.usage)}</Readout>
                    )}
                    <Readout testId="exec-when">{elapsed(record, now)}</Readout>
                  </Stack>
                  <Surface
                    as="button"
                    variant="flat"
                    className="exec-card"
                    data-testid="exec-card"
                    // A run whose card has gone can still be read; there is just nothing to open.
                    disabled={card === undefined}
                    title={openTitle(record, card)}
                    onClick={() => card && onOpenCard(card, record)}
                  >
                    <Readout>{subject}</Readout>{' '}
                    <span className="vb-clip">{card?.title ?? (record.card ? '(gone)' : '')}</span>
                  </Surface>
                  {(record.summary || record.note) && (
                    <Text className="exec-summary">{record.summary ?? record.note}</Text>
                  )}
                  {/* A ROW OF ITS OWN, because `.exec-run` is a flex COLUMN — every direct child of it
                      lands on its own line, so two sibling buttons stacked rather than sitting together.
                      Wrapping, so the result and error lines ForgiveAttempts renders (both
                      `flex-basis: 100%`) still break underneath the buttons rather than squeezing them. */}
                  {(stoppable || column.key === 'attention') && (
                    <Stack gap={2} wrap className="exec-actions">
                      {stoppable && (
                        <Button
                          className="report-stop"
                          data-testid="report-stop"
                          title={`Stop the ${record.skill} run on ${subject}`}
                          onClick={() => onCancel(record)}
                        >
                          Stop
                        </Button>
                      )}
                      {column.key === 'attention' && (
                        <Button
                          className="report-dismiss vb-fixed"
                          data-testid="report-dismiss"
                          title={`Mark the ${record.skill} run on ${subject} dealt with`}
                          onClick={() => onResolve(record)}
                        >
                          Dismiss
                        </Button>
                      )}
                      {/* BESIDE DISMISS, because the two are the pair of answers to a failed run and
                          this column is where a person actually meets one. Dismiss says "I have read
                          this"; this says "stop it counting against the card". Offered only for a run
                          that HAS a card — a project run has no attempt tally to clear. */}
                      {column.key === 'attention' && record.card && record.board && (
                        <ForgiveAttempts board={record.board} card={record.card} onForgiven={onForgiven} />
                      )}
                    </Stack>
                  )}
                </Row>
              );
            })}
          </Surface>
        );
      })}
    </main>
  );
}
