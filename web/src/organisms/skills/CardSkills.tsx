import { Button } from '../../atoms/Button';
import { Stack } from '../../atoms/Stack';
import { Text } from '../../atoms/Text';
import type { InvalidSkill, Skill } from '../../lib/api';
import type { Card } from '../../lib/shared';
import { skillsForCard } from './filter';

interface Props {
  card: Card;
  skills: Skill[];
  // Files that failed validation. Counted here because a skill that silently never appears is
  // indistinguishable from one nobody wrote.
  invalid: InvalidSkill[];
  // Absent for an archived card: a run edits the project and reports against a card that is not on
  // the board, so there would be nowhere for the result to show.
  onRun?: (skill: Skill) => void;
}

// The card's action rail, driven by the skill files on disk and scoped to this card's board and
// column. Clicking one opens the details step — nothing dispatches from here.
export function CardSkills({ card, skills, invalid, onRun }: Props) {
  const mine = skillsForCard(skills, card.board, card.columnSlug);
  return (
    // A LABELLED LANDMARK IS A `Stack` NOW, and that is the one thing that kept this class holding a
    // column, a gap and a padding: `aria-label` is a live test contract (`Skills for E-042`) and the atom
    // could not carry it. What is left is the rail's width, its left edge and its ground.
    <Stack
      as="aside"
      label={`Skills for ${card.id}`}
      direction="column"
      gap={3}
      pad={[5, 4]}
      className="card-skills"
    >
      <Text as="h3" caps>
        Skills
      </Text>
      {mine.map((s) => (
        <Button
          size="sm"
          key={s.slug}
          align="start"
          data-testid="cs-action"
          disabled={onRun === undefined}
          title={onRun ? s.description : `${s.description} — archived cards cannot be run`}
          onClick={() => onRun?.(s)}
        >
          {s.name}
        </Button>
      ))}
      {mine.length === 0 && (
        <Text role="hint" lead size="micro" testId="cs-empty">
          No skills for this column. Add one in Project Control → Skills.
        </Text>
      )}
      {invalid.length > 0 && (
        <Text role="error" title={invalid.map((i) => `${i.path}: ${i.reason}`).join('\n')}>
          ⚠ {invalid.length} skill file{invalid.length === 1 ? '' : 's'} invalid
        </Text>
      )}
    </Stack>
  );
}
