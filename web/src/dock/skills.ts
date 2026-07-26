// The per-card skill actions on the roadmap: each will eventually run a prompt about the card
// against a chosen backend and model, with token and cost accounting. None of that exists yet, so
// this is a catalogue and nothing more — kept as data so wiring an action up replaces where the
// list comes from, not the rail that renders it.

export interface SkillAction {
  id: string;
  label: string;
  // Shown on hover: what the action will do once it runs.
  hint: string;
}

export const SKILL_ACTIONS: readonly SkillAction[] = [
  { id: 'execute', label: 'Execute', hint: 'Hand the card to the copilot to implement' },
  { id: 'research', label: 'Research', hint: 'Gather background and context for the card' },
  { id: 'review', label: 'Review', hint: 'Critique the work the card describes' },
  { id: 'breakdown', label: 'Break down', hint: 'Split the card into smaller cards' },
  { id: 'summarise', label: 'Summarise', hint: 'Condense the card and everything it links to' },
];
