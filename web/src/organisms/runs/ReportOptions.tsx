import { useState } from 'react';
import { Button } from '../../atoms/Button';
import { Control } from '../../atoms/Control';
import { Stack } from '../../atoms/Stack';
import { Text } from '../../atoms/Text';

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
    // `<section aria-label>` IS A `Stack` NOW, which is what kept the flex column in the sheet: the atom
    // rendered neither the tag nor the name. `edge="top"` is the hairline; the `padding-top` is all the
    // class still says, because `pad` sets a whole axis and this is one edge of one.
    // `align="start"` IS NOT WANTED HERE and the column default is what draws it: the option buttons are
    // full-width rows you pick, which is the same claim `align="start"` on the buttons' text makes.
    <Stack as="section" label="What next" direction="column" gap={2} edge="top" pad={[4, 0, 0]}>
      <Text caps>What next?</Text>
      {!canContinue && (
        <Text role="error">
          The skill this run used is no longer in the project, so there is nothing to continue with. Closing
          the card still works.
        </Text>
      )}

      {options.map((option) => (
        <Button
          size="sm"
          key={option}
          align="start"
          data-testid="option-btn"
          disabled={!canContinue}
          onClick={() => onContinue(option)}
        >
          {option}
        </Button>
      ))}

      <Button
        size="sm"
        align="start"
        data-testid="option-btn"
        disabled={!canContinue}
        title="Runs an agent to split this into cards, linked to this one"
        onClick={() => onContinue(createPrompt)}
      >
        Create new cards
      </Button>
      <Button
        size="sm"
        align="start"
        data-testid="option-btn"
        disabled={!canContinue}
        title="Opens the details step with an empty prompt"
        onClick={() => onContinue('')}
      >
        Write my own input
      </Button>

      <Stack gap={4} className="options-close">
        <Text className="options-close-label">Ignore and close</Text>
        {/* NOT a `Field`: an action row. "Ignore and close" names the BUTTON, and the select is one of
            its two operands — a Field's label names one control. */}
        <Control
          as="select"
          aria-label="Column to close the card into"
          value={column}
          onChange={(e) => setColumn(e.target.value)}
        >
          {columns.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </Control>
        <Button
          size="md"
          disabled={column === '' || column === currentColumn}
          onClick={() => onClose(column)}
        >
          Close card
        </Button>
      </Stack>
    </Stack>
  );
}
