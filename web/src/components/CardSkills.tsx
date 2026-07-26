import type { InvalidSkill, Skill } from '../api';
import type { Card } from '../shared';
import { skillsForCard } from '../skills/filter';

interface Props {
  card: Card;
  skills: Skill[];
  // Files that failed validation. Counted here because a skill that silently never appears is
  // indistinguishable from one nobody wrote.
  invalid: InvalidSkill[];
}

// The card's action rail, driven by the skill files on disk and scoped to this card's board and
// column. Every action is disabled until the run engine lands: a live-looking button that does
// nothing reads as a broken feature rather than an unbuilt one.
export function CardSkills({ card, skills, invalid }: Props) {
  const mine = skillsForCard(skills, card.board, card.columnSlug);
  return (
    <aside className="card-skills" aria-label={`Skills for ${card.id}`}>
      <h3 className="cs-head">Skills</h3>
      {mine.map((s) => (
        <button
          key={s.slug}
          type="button"
          className="cs-action"
          disabled
          title={`${s.description} — dispatch arrives with the run engine`}
        >
          {s.name}
        </button>
      ))}
      {mine.length === 0 && (
        <p className="cs-empty">No skills for this column. Add one in Project Control → Skills.</p>
      )}
      {invalid.length > 0 && (
        <p className="cs-invalid" title={invalid.map((i) => `${i.path}: ${i.reason}`).join('\n')}>
          ⚠ {invalid.length} skill file{invalid.length === 1 ? '' : 's'} invalid
        </p>
      )}
    </aside>
  );
}
