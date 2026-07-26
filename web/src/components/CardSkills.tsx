import { SKILL_ACTIONS } from '../dock/skills';
import type { Card } from '../shared';

interface Props {
  card: Card;
}

// The card's action rail, down the right of the cards pane. Every action is disabled: running one
// needs a model, a backend and cost accounting that do not exist yet, and a button that looks live
// and does nothing reads as a broken feature rather than an unbuilt one.
export function CardSkills({ card }: Props) {
  return (
    <aside className="card-skills" aria-label={`Skills for ${card.id}`}>
      <h3 className="cs-head">Skills</h3>
      {SKILL_ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          className="cs-action"
          disabled
          title={`${action.hint} — not wired up yet`}
        >
          {action.label}
        </button>
      ))}
      <p className="cs-note">Not wired up yet.</p>
    </aside>
  );
}
