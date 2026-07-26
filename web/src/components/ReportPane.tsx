import { useState } from 'react';
import type { RunRecord } from '../api';
import { renderMarkdown } from '../markdown';
import type { Card, ProjectConfig } from '../shared';
import { slugify } from '../viewmodel';
import { ReportOptions } from './ReportOptions';

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
    <article className="report" aria-label={`Report from ${record.skill} on ${record.card}`}>
      <header className="report-head">
        <button type="button" className="dispatch-back" onClick={onBack} title="Back to the card">
          ←
        </button>
        <h3 className="report-title">
          {record.skill} <span className="dispatch-on">on {record.card}</span>
        </h3>
        <span className={`report-chip chip-${record.status}`}>{record.status}</span>
      </header>

      <dl className="report-meta">
        <div>
          <dt>Model</dt>
          <dd>
            {record.model} · {record.effort} · {record.mode}
          </dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{record.started.replace('T', ' ').slice(0, 19)}</dd>
        </div>
        {record.finished && (
          <div>
            <dt>Finished</dt>
            <dd>{record.finished.replace('T', ' ').slice(0, 19)}</dd>
          </div>
        )}
        {record.attached && (
          <div>
            <dt>Attached</dt>
            <dd>{record.attached.join(', ')}</dd>
          </div>
        )}
      </dl>

      {record.summary && <p className="report-lead">{record.summary}</p>}
      {/* VibeBoard's own words, shown when the agent left none of its own. */}
      {record.note && <p className="report-note">{record.note}</p>}
      {record.prompt && (
        <p className="report-prompt">
          <span className="report-prompt-label">You asked:</span> {record.prompt}
        </p>
      )}

      {record.report.trim() ? (
        <div className="markdown report-body">{renderMarkdown(record.report)}</div>
      ) : (
        <p className="report-empty">This run left no report.</p>
      )}

      {createdCards.length > 0 && (
        <div className="report-created">
          <span className="cv-label">Cards this run created</span>
          {createdCards.map((c) => (
            <button
              key={c.id}
              type="button"
              className="cv-link-btn"
              title={`Open ${c.id}`}
              onClick={() => onOpenCard(c)}
            >
              <span className="link-id">{c.id}</span> <span className="link-title">{c.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* A run that needs attention gets options; one that succeeded gets a move. Both are the
          user's click — nothing here happens because a run ended. */}
      {(record.status === 'attention' || record.status === 'failed') && (
        <ReportOptions
          options={record.options ?? []}
          cardId={record.card}
          columns={columns.map((name) => ({ slug: slugify(name), name }))}
          currentColumn={card.columnSlug}
          onContinue={onContinue}
          onClose={onMove}
          canContinue={canContinue}
        />
      )}

      {record.status === 'success' && (
        <div className="report-foot">
          <select
            className="theme-select"
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
          </select>
          <button
            type="button"
            className="btn-primary"
            disabled={column === '' || column === card.columnSlug}
            onClick={() => onMove(column)}
          >
            Move card
          </button>
        </div>
      )}
    </article>
  );
}
