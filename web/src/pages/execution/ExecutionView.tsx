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

// ONE RUN, AS ITS OWN COMPONENT, and the gate is what asked for it rather than taste. This block was the
// body of a `.map` nested inside another `.map` inside `ExecutionView`, which scored 16 against a ceiling
// of 15 — the same rule that already made `openTitle` a function above, doing its job a second time on the
// same file. EXTRACTED RATHER THAN SUPPRESSED: the rule was pointing at real nesting, and nesting is what
// the metric punishes far more heavily than length, so flattening one level is worth more here than any
// amount of shortening. The four decisions the row makes are now props, decided by the caller that has the
// lists to decide them with — which is also why `stoppable` and `attention` are booleans and not the
// `active`/`queued` arrays and a column key: this component renders one run and should not be able to ask
// about any other.
function RunRow({
  record,
  card,
  stoppable,
  attention,
  now,
  onOpenCard,
  onCancel,
  onResolve,
  onForgiven,
}: {
  record: RunRecord;
  card: Card | undefined;
  stoppable: boolean;
  attention: boolean;
  now: number;
  onOpenCard: (card: Card, run: RunRecord) => void;
  onCancel: (run: RunRecord) => void;
  onResolve: (run: RunRecord) => void;
  onForgiven: () => void;
}) {
  const subject = runSubject(record);
  return (
    <Row stack variant="inset">
      <Stack align="baseline" gap={3}>
        <Chip pill state={record.status} caps className="vb-readout vb-fixed" testId="report-chip">
          {record.status}
        </Chip>
        <Text ink="strong">{record.skill}</Text>
        {/* What it cost, beside how long it took — the two things a dashboard row is actually asked.
            Absent while a run is still in flight.
            `push` ON WHICHEVER OF THE PAIR COMES FIRST, and that is the repair: the rule this replaces was
            `.exec-run-top > .vb-readout { margin-left: auto }`, meaning "the cost takes the push-right".
            But the status chip beside it wears `vb-readout` too — it wants the mono face — so it matched as
            well, and TWO auto margins in a flex row SPLIT the free space between them. Every chip was
            pushed right by half of whatever slack that row had, so a column of them read as random. `push`
            says which element, at the site, where it can be seen. */}
        {costLabel(record.usage) ? (
          <>
            <Readout className="push" testId="exec-cost">
              {costLabel(record.usage)}
            </Readout>
            <Readout testId="exec-when">{elapsed(record, now)}</Readout>
          </>
        ) : (
          <Readout className="push" testId="exec-when">
            {elapsed(record, now)}
          </Readout>
        )}
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
      {/* A ROW OF ITS OWN, because `.exec-run` is a flex COLUMN — every direct child of it lands on its own
          line, so two sibling buttons stacked rather than sitting together. Wrapping, so the result and
          error lines ForgiveAttempts renders (both `flex-basis: 100%`) still break underneath the buttons
          rather than squeezing them. */}
      {(stoppable || attention) && (
        <Stack gap={2} wrap>
          {stoppable && (
            <Button
              className="report-stop vb-fixed"
              data-testid="report-stop"
              title={`Stop the ${record.skill} run on ${subject}`}
              onClick={() => onCancel(record)}
            >
              Stop
            </Button>
          )}
          {attention && (
            <Button
              className="report-dismiss vb-fixed"
              data-testid="report-dismiss"
              title={`Mark the ${record.skill} run on ${subject} dealt with`}
              onClick={() => onResolve(record)}
            >
              Dismiss
            </Button>
          )}
          {/* BESIDE DISMISS, because the two are the pair of answers to a failed run and this column is
              where a person actually meets one. Dismiss says "I have read this"; this says "stop it
              counting against the card". Offered only for a run that HAS a card — a project run has no
              attempt tally to clear. */}
          {attention && record.card && record.board && (
            <ForgiveAttempts board={record.board} card={record.card} onForgiven={onForgiven} />
          )}
        </Stack>
      )}
    </Row>
  );
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
            {group.map((record) => (
              <RunRow
                key={record.run}
                record={record}
                card={cards.find((c) => c.id === record.card)}
                stoppable={active.includes(record.run) || queued.includes(record.run)}
                attention={column.key === 'attention'}
                now={now}
                onOpenCard={onOpenCard}
                onCancel={onCancel}
                onResolve={onResolve}
                onForgiven={onForgiven}
              />
            ))}
          </Surface>
        );
      })}
    </main>
  );
}
