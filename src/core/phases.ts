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
  | 'task-fix'
  | 'story-fix'
  | 'story-review'
  | 'feature-checkup';

export interface Phase {
  name: PhaseName;
  skill?: string; // absent = the loop acts alone (the two break-down skips)
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
  //
  // `done` AND NOT `review` (decision 80). A task is finished when its work lands; the STORY is what gets
  // judged, once every task under it is settled. Engineering's Review column stays in the scaffolder's
  // defaults — the on-disk format is frozen — and is no longer a state the loop stamps.
  //
  // IT IS ALSO NO LONGER A COLUMN A CARD RESTS IN. A person may still drag one there, and the next tick
  // stamps it `done` on this row: a stateless tick has no run and no judgement to read, so a task the old
  // machine left behind and one dropped in a minute ago are the same board state. The alternative is a task
  // nothing can settle, making its story unjudgeable for ever. `taskPhase` in core/lifecycle/tick.ts is
  // where that happens and carries the same reason.
  {
    name: 'task-implement',
    skill: 'implement',
    board: 'engineering',
    entry: 'in-progress',
    exitPass: 'done',
    bounded: 'skill',
  },
  // No entry stamp: its trigger is a task already in `in-progress`, so there is no move to make.
  //
  // TWO TRIGGERS, both of them outstanding failed verdicts rather than a judgement: the loop's OWN
  // correctness refusal, where a run that left nothing behind earns one (`recordEmptyRun` in
  // service/act/outcomes.ts); and a task the old machine left in `review` still carrying the send-back that
  // put it there, because `taskPhase` asks for an outstanding verdict before it looks at any column. The
  // judgement that used to write those is at the story now, and `story-fix` below is what answers that one.
  {
    name: 'task-fix',
    skill: 'fix',
    board: 'engineering',
    exitPass: 'done',
    bounded: 'skill',
  },
  // WHERE A SENT-BACK STORY'S WORK IS REDONE, and without it a refused judgement has nowhere to go: the
  // story sits settled in `in-progress` carrying a failed verdict, and every later tick re-stamps it to
  // where it already is. The same shape `task-fix` has one level down, and the same SINGLE budget across
  // both send-back kinds — a story the gates sent back and one the judge sent back spend one count.
  //
  // No `exitPass`: a fix does not close a story, the judge does. The story stays where it is, and the next
  // tick finds a work run carrying no verdict — which is the judgement's own trigger.
  { name: 'story-fix', skill: 'fix', board: 'product', bounded: 'skill' },
  // THE ONE JUDGEMENT A STORY GETS (decision 80), and it absorbs the story checkup. At story granularity
  // "does this do what the card asked" and "do the tasks under it compose into it" are the same question,
  // and asking both paid two cold starts for one answer.
  //
  // Stays in `product/in-progress` while it runs, so no entry stamp. It keeps the checkup's authority to
  // create on its OWN board — sibling stories (decision 47) — and ruling 61 stamps those too.
  //
  // Bounded over INCONCLUSIVE judgements rather than judgements (spec, the review cycle row): a successful
  // one burns an attempt, so counting them all would stall a healthy story at three.
  {
    name: 'story-review',
    skill: 'review-story',
    board: 'product',
    exitPass: 'done',
    exitFail: 'in-progress',
    creates: 'product',
    bounded: 'review',
  },
  // `creates: product` on a `features` card: a feature checkup's product is stories under the feature
  // it ran on, which is why `creates` is declared apart from `board`.
  //
  // `exitPass` IS ONLY ONE OF ITS TWO EXITS, and it is the CLOSING one. A feature checkup that created
  // stories has not finished its feature: it stays open, L2 walks what was created, and the checkup
  // after that work closes it (the L1 loop, bounded to one creating round by decision 47). Which of the
  // two happened is not a property of the table — it is whether the board grew while the run went — so
  // the executor holds the card open and this column is stamped only when it created nothing. Stamped
  // unconditionally, the stories a checkup creates are ORPHANS: `derivePosition` picks a feature only
  // from `todo` or `in-progress`, so a closed feature is never re-entered.
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
