import { useState } from 'react';
import { Button } from '../../atoms/Button';
import { Chip } from '../../atoms/Chip';
import { Control } from '../../atoms/Control';
import { Readout } from '../../atoms/Readout';
import { Stack } from '../../atoms/Stack';
import { Surface } from '../../atoms/Surface';
import { Text } from '../../atoms/Text';
import type { RunRecord } from '../../lib/api';
import { renderMarkdown } from '../../lib/markdown';
import type { Card, ProjectConfig } from '../../lib/shared';
import { slugify } from '../../lib/viewmodel';
import { usageLine } from './format';
import { ReportOptions } from './ReportOptions';
import { needsAttention } from './viewmodel';

interface Props {
  record: RunRecord;
  card: Card;
  config: ProjectConfig;
  // Cards the run created, resolved against the live board — an id it claims to have created may
  // not exist, and a dead link would be worse than none.
  createdCards: Card[];
  onOpenCard: (card: Card) => void;
  // Moving the card is the user's click, never a consequence of the run finishing.
  onMove: (columnSlug: string) => void;
  // Ignore and close: the run is dealt with AND the card moves. One click, two facts, because
  // "I am not acting on this" is a decision about the run as much as about the card.
  onClose: (columnSlug: string) => void;
  onBack: () => void;
  // Continue from this run: opens the details step carrying this record as `previous`, so the agent
  // gets the report it is following on from.
  onContinue: (prompt: string) => void;
  // False when the skill this run used has since been deleted.
  canContinue: boolean;
}

// One run's report: what was dispatched, what came back, and what the user may want to do next.
export function ReportPane({
  record,
  card,
  config,
  createdCards,
  onOpenCard,
  onMove,
  onClose,
  onBack,
  onContinue,
  canContinue,
}: Props) {
  const columns = config.boards[card.board].columns;
  // Defaults to a column named Review where the board has one — it does not exist on every board,
  // and guessing another would move a card somewhere nobody asked for.
  const review = columns.find((name) => slugify(name) === 'review');
  // The SLUG, not the display name: that is what the options carry and what the API takes.
  const [column, setColumn] = useState(review ? slugify(review) : '');

  return (
    // `<article aria-label>` IS A `Stack` NOW — the tag and the accessible name are what kept the flex
    // column in the sheet. `overflow-wrap` is all the class still says, and no atom carries it.
    <Stack
      as="article"
      label={`Report from ${record.skill} on ${card.id}`}
      direction="column"
      gap={4}
      className="report"
    >
      <Stack as="header" gap={4}>
        <Button size="sm" onClick={onBack} title="Back to the card">
          ←
        </Button>
        {/* `ink="strong"` because the class named no ink and inherited the body's: the atom's default is
            muted, and a title is not. `.report-title` IS GONE WITH IT: the display family and the
            `--t-lead` step were its only two declarations and both are attributes now. */}
        <Text ink="strong" size="lead" family="display">
          {record.skill} <Readout>on {card.id}</Readout>
        </Text>
        <Chip pill state={record.status} className="report-chip vb-readout vb-fixed" testId="report-chip">
          {record.status}
        </Chip>
      </Stack>

      {/* Every definition here is a machine fact — a model id, two timestamps, a token and cost line —
          so each is a `Readout`. `plain` because the list has already decided its size and colour;
          `.report-meta dd` restated the mono face by hand until Phase 12. */}
      <dl className="report-meta">
        <div>
          <dt>Model</dt>
          <dd>
            <Readout>
              {record.model} · {record.effort} · {record.mode}
            </Readout>
          </dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>
            <Readout>{record.started.replace('T', ' ').slice(0, 19)}</Readout>
          </dd>
        </div>
        {record.finished && (
          <div>
            <dt>Finished</dt>
            <dd>
              <Readout>{record.finished.replace('T', ' ').slice(0, 19)}</Readout>
            </dd>
          </div>
        )}
        {record.attached && (
          <div>
            <dt>Attached</dt>
            <dd>
              <Readout>{record.attached.join(', ')}</Readout>
            </dd>
          </div>
        )}
        {/* "Usage", not "Cost": for Claude Code this is the API-equivalent figure, which is not what
            a subscription was billed. Absent for older runs and for a turn that died before saying. */}
        {record.usage && (
          <div>
            <dt>Usage</dt>
            <dd>
              <Readout>{usageLine(record.usage)}</Readout>
            </dd>
          </div>
        )}
        {/* Shown for what it is: the run still reads as `attention`, and this is the answer to it. */}
        {record.resolved && (
          <div>
            <dt>Dealt with</dt>
            <dd>
              <Readout>{record.resolved.replace('T', ' ').slice(0, 19)}</Readout>
            </dd>
          </div>
        )}
      </dl>

      {/* The step is the atom's; the quoted edge and its inset are what the class still carries. */}
      {record.summary && (
        <Text ink="strong" size="lead" className="report-lead">
          {record.summary}
        </Text>
      )}
      {/* VibeBoard's own words, shown when the agent left none of its own. */}
      {record.note && (
        <Text lead ink="accent2" testId="report-note">
          {record.note}
        </Text>
      )}
      {record.prompt && (
        <Text lead testId="report-prompt">
          {/* `.report-prompt-label` IS GONE: `--t-micro` was its whole content. */}
          <Text caps size="micro">
            You asked:
          </Text>{' '}
          {record.prompt}
        </Text>
      )}

      {record.report.trim() ? (
        <div className="markdown report-body">{renderMarkdown(record.report)}</div>
      ) : (
        <Text role="hint" lead>
          This run left no report.
        </Text>
      )}

      {createdCards.length > 0 && (
        <Stack direction="column" gap={2} testId="report-created">
          <Text>Cards this run created</Text>
          {createdCards.map((c) => (
            <Surface
              as="button"
              variant="flat"
              key={c.id}
              className="cv-link-btn"
              data-testid="cv-link"
              title={`Open ${c.id}`}
              onClick={() => onOpenCard(c)}
            >
              <Readout testId="created-id">{c.id}</Readout> <span className="vb-clip">{c.title}</span>
            </Surface>
          ))}
        </Stack>
      )}

      {/* A run still waiting on someone gets options; one that succeeded gets a move. Both are the
          user's click — nothing here happens because a run ended. `needsAttention` rather than a
          status list: it also covers an interrupted run, which until now had no button anywhere, and
          it drops the options once the run has been dealt with. */}
      {needsAttention(record) && (
        <ReportOptions
          options={record.options ?? []}
          cardId={card.id}
          columns={columns.map((name) => ({ slug: slugify(name), name }))}
          currentColumn={card.columnSlug}
          onContinue={onContinue}
          onClose={onClose}
          canContinue={canContinue}
        />
      )}

      {record.status === 'success' && (
        <Stack gap={4} justify="end">
          {/* NOT a `Field`: an action row, and its own first option — "Choose a column…" — names it. */}
          <Control
            as="select"
            aria-label="Column to move the card to"
            value={column}
            onChange={(e) => setColumn(e.target.value)}
          >
            <option value="">Choose a column…</option>
            {columns.map((name) => (
              <option key={name} value={slugify(name)}>
                {name}
              </option>
            ))}
          </Control>
          <Button
            variant="primary"
            size="md"
            disabled={column === '' || column === card.columnSlug}
            onClick={() => onMove(column)}
          >
            Move card
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
