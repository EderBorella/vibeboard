import type { RunRecord, Skill } from '../api';
import type { Card, ProjectConfig } from '../shared';
import { ReportPane } from './ReportPane';

interface Props {
  record: RunRecord;
  card: Card;
  config: ProjectConfig;
  // The live board, for resolving the cards a run says it created.
  live: Card[];
  skills: Skill[];
  onOpenCard: (card: Card) => void;
  onMove: (columnSlug: string) => void;
  // Ignore and close: resolve the run, then move the card.
  onClose: (columnSlug: string) => void;
  onBack: () => void;
  // Continue from this run with a starting prompt. Given the skill, because resolving it is this
  // component's job, not the caller's.
  onContinue: (skill: Skill, prompt: string) => void;
}

// What a report needs resolving before it can be shown: which of the ids it claims to have created
// actually exist, and whether the skill it used is still in the project. Its own component so
// CardsPane stays orchestration — those lookups are what pushed the pane past the complexity gate.
export function ActiveReport({
  record,
  card,
  config,
  live,
  skills,
  onOpenCard,
  onMove,
  onClose,
  onBack,
  onContinue,
}: Props) {
  const skill = skills.find((s) => s.slug === record.skill);
  return (
    <ReportPane
      record={record}
      card={card}
      config={config}
      // Only the ids that resolve: an agent can claim a card it never wrote, and a dead link is
      // worse than none.
      createdCards={live.filter((c) => record.created?.includes(c.id))}
      onOpenCard={onOpenCard}
      onMove={onMove}
      onClose={onClose}
      onBack={onBack}
      canContinue={skill !== undefined}
      onContinue={(prompt) => {
        if (skill) onContinue(skill, prompt);
      }}
    />
  );
}
