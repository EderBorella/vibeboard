import type { InvalidSkill, Skill } from '../api';
import { Button } from '../atoms/Button';
import { Text } from '../atoms/Text';
import type { Card } from '../shared';
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
    <aside className="card-skills" aria-label={`Skills for ${card.id}`}>
      <h3 className="cs-head">Skills</h3>
      {mine.map((s) => (
        <Button
          size="sm"
          key={s.slug}
          className="cs-action"
          data-testid="cs-action"
          disabled={onRun === undefined}
          title={onRun ? s.description : `${s.description} — archived cards cannot be run`}
          onClick={() => onRun?.(s)}
        >
          {s.name}
        </Button>
      ))}
      {mine.length === 0 && (
        <Text role="hint" lead className="cs-empty">
          No skills for this column. Add one in Project Control → Skills.
        </Text>
      )}
      {invalid.length > 0 && (
        <Text role="error" title={invalid.map((i) => `${i.path}: ${i.reason}`).join('\n')}>
          ⚠ {invalid.length} skill file{invalid.length === 1 ? '' : 's'} invalid
        </Text>
      )}
    </aside>
  );
}
