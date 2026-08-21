import { useState } from 'react';
import { Button } from '../ui/Button';

interface ColumnChoice {
  slug: string;
  name: string;
}

interface Props {
  // What the agent itself offered. Any number, including none.
  options: string[];
  cardId: string;
  columns: ColumnChoice[];
  currentColumn: string;
  // Continue the work: opens the details step with this prompt filled in, editable.
  onContinue: (prompt: string) => void;
  // Close the card without running anything. The only resolution that needs no agent.
  onClose: (columnSlug: string) => void;
  // False when the skill this run used is no longer on disk — there is nothing to continue with.
  canContinue: boolean;
}

// What to do about a run that needs attention.
//
// The agent's own options come first, then two fixed ones. Every option except "Ignore and close"
// leads to the details step with the prompt filled in — a choice is a starting point, not an
// instruction, so it stays editable. Closing is deterministic: ignoring a finding means no work, so
// no agent runs.
export function ReportOptions({
  options,
  cardId,
  columns,
  currentColumn,
  onContinue,
  onClose,
  canContinue,
}: Props) {
  // Defaults to the board's last column — where "done" lives on every default board, and the only
  // sensible guess when the point is to stop thinking about this card.
  const [column, setColumn] = useState(columns.at(-1)?.slug ?? '');
  const createPrompt = `Break this work into separate cards on the boards where they belong, link each one to ${cardId}, and list the ids you created. Do not implement them.`;

  return (
    <section className="options" aria-label="What next">
      <h4 className="vb-label vb-label-caps">What next?</h4>
      {!canContinue && (
        <p className="options-warn">
          The skill this run used is no longer in the project, so there is nothing to continue with. Closing
          the card still works.
        </p>
      )}

      {options.map((option) => (
        <Button
          size="sm"
          key={option}
          className="option-btn"
          data-testid="option-btn"
          disabled={!canContinue}
          onClick={() => onContinue(option)}
        >
          {option}
        </Button>
      ))}

      <Button
        size="sm"
        className="option-btn"
        data-testid="option-btn"
        disabled={!canContinue}
        title="Runs an agent to split this into cards, linked to this one"
        onClick={() => onContinue(createPrompt)}
      >
        Create new cards
      </Button>
      <Button
        size="sm"
        className="option-btn"
        data-testid="option-btn"
        disabled={!canContinue}
        title="Opens the details step with an empty prompt"
        onClick={() => onContinue('')}
      >
        Write my own input
      </Button>

      <div className="options-close">
        <span className="options-close-label">Ignore and close</span>
        <select
          className="theme-select"
          aria-label="Column to close the card into"
          value={column}
          onChange={(e) => setColumn(e.target.value)}
        >
          {columns.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <Button
          size="md"
          disabled={column === '' || column === currentColumn}
          onClick={() => onClose(column)}
        >
          Close card
        </Button>
      </div>
    </section>
  );
}
