import type { BoardName } from './types.js';

// The lifecycle as a phase table. A phase is a POSITION IN THE MACHINE, not a (board, column) pair
// (decision 38): a column is a state the loop stamped, never a question the loop asks. The table below
// IS the implementation — every consumer reads it rather than restating it.
//
// In CODE and not in `config.yaml` (ruling 52). This block has already shipped two keys that were lies —
// `setupFeatureFlag`, read by nothing, and `autoPilotConcurrency`, where any value above 1 changed
// nothing — and a phase table a person can edit is a third waiting to happen.
//
// Columns are SLUGS, as everywhere the loop compares one.

export type PhaseName =
  | 'bootstrap'
  | 'feature-breakdown'
  | 'feature-breakdown-skip'
  | 'story-breakdown'
  | 'story-breakdown-skip'
  | 'task-implement'
  | 'task-review'
  | 'task-review-remove'
  | 'task-fix'
  | 'story-checkup'
  | 'feature-checkup';

export interface Phase {
  name: PhaseName;
  skill?: string; // absent = the loop acts alone (the two skips, task-review-remove)
  board?: BoardName; // absent for the bootstrap: a project run has no card
  entry?: string; // column slug stamped before the dispatch
  exitPass?: string;
  exitFail?: string;
  creates?: BoardName; // the ONE board a run of this phase may create cards on
  bounded: 'skill' | 'review' | 'none';
}

export const PHASES: readonly Phase[] = [
  // No board and no column stamps: a project run has no card, and this phase's exit is `setup: true`
  // on the first feature the run produced (decision 44), which is not a move.
  { name: 'bootstrap', skill: 'derive-features', creates: 'features', bounded: 'skill' },
  {
    name: 'feature-breakdown',
    skill: 'break-down',
    board: 'features',
    entry: 'todo',
    exitPass: 'in-progress',
    creates: 'product',
    bounded: 'skill',
  },
  // Decision 50: a card that already has children skips its break-down, or a follow-up feature would
  // get a second set of stories. No skill, so no bound — there is no attempt to burn.
  {
    name: 'feature-breakdown-skip',
    board: 'features',
    exitPass: 'in-progress',
    bounded: 'none',
  },
  {
    name: 'story-breakdown',
    skill: 'break-down',
    board: 'product',
    entry: 'todo',
    exitPass: 'in-progress',
    creates: 'engineering',
    bounded: 'skill',
  },
  {
    name: 'story-breakdown-skip',
    board: 'product',
    exitPass: 'in-progress',
    bounded: 'none',
  },
  // No `creates`: an implement run has no board to create cards on, and the endpoint reads this.
  {
    name: 'task-implement',
    skill: 'implement',
    board: 'engineering',
    entry: 'in-progress',
    exitPass: 'review',
    bounded: 'skill',
  },
  // No entry stamp: the card is already in review, and a move to where it is would be a write for
  // nothing. Bounded over INCONCLUSIVE reviews rather than reviews (spec, the review cycle row): a
  // successful review burns an attempt, so counting them all would stall a healthy task at three.
  {
    name: 'task-review',
    skill: 'review',
    board: 'engineering',
    exitPass: 'done',
    exitFail: 'in-progress',
    bounded: 'review',
  },
  // "Has this already been done": the judgement happened and only the move failed. Re-stamp, never
  // re-judge.
  {
    name: 'task-review-remove',
    board: 'engineering',
    exitPass: 'done',
    exitFail: 'in-progress',
    bounded: 'none',
  },
  // No entry stamp: its trigger is a task already in `in-progress`, so there is no move to make.
  {
    name: 'task-fix',
    skill: 'fix',
    board: 'engineering',
    exitPass: 'review',
    bounded: 'skill',
  },
  // Stays in `product/in-progress` while it runs, so no entry stamp. It creates on its OWN board —
  // sibling stories (decision 47) — and ruling 61 stamps those too.
  {
    name: 'story-checkup',
    skill: 'checkup-story',
    board: 'product',
    exitPass: 'done',
    creates: 'product',
    bounded: 'skill',
  },
  // `creates: product` on a `features` card: a feature checkup's product is stories under the feature
  // it ran on, which is why `creates` is declared apart from `board`.
  {
    name: 'feature-checkup',
    skill: 'checkup-feature',
    board: 'features',
    exitPass: 'done',
    creates: 'product',
    bounded: 'skill',
  },
] as const;

// Throws rather than failing closed: an unknown name is a programming error, not a state of the board.
export function phase(name: PhaseName): Phase {
  const found = PHASES.find((p) => p.name === name);
  if (!found) throw new Error(`no phase named ${name}`);
  return found;
}

// Derived from the table rather than listed a second time, which is the mistake `setupFeatureFlag` was
// (src/core/autopilot.ts:73-76): typed, defaulted, validated, mirrored to the UI, and read by nothing.
export const LIFECYCLE_SKILLS: readonly string[] = [
  ...new Set(PHASES.map((p) => p.skill).filter((s): s is string => s !== undefined)),
];

// Which phase a RUN belongs to, for the endpoint (ruling 56). Matched on `skill` AND `board`, because
// `break-down` is TWO phases with different `creates`: a story's break-down matched on skill alone
// would carry the authority to create features. A project run has no board and resolves to the
// bootstrap, the only card-less phase.
export function phaseForRun(skill: string, board?: BoardName): Phase | undefined {
  return PHASES.find((p) => p.skill === skill && p.board === board);
}
