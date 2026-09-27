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
  | 'story-satisfied'
  | 'story-task'
  | 'story-implement'
  | 'story-fix'
  | 'story-review'
  | 'feature-checkup';

export interface Phase {
  name: PhaseName;
  skill?: string; // absent = the loop acts alone (the two skips, a satisfied story, a story's task)
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
  // THE OTHER WAY A BREAK-DOWN DOES NOT HAPPEN (decision 85), and the difference from the skip above is
  // the exit. That one says "this story already has its tasks, work them"; this one says "this story's one
  // acceptance criterion is a command the project declares as a gate, and it already passes" — so there is
  // nothing to break down, nothing to implement, and nothing for a judge to add that the exit code has not
  // already said.
  //
  // `exitPass: done` FOR THAT REASON, and it is the only phase that closes a story without a run. Four
  // cards in a measured trial asked for work an earlier story's scaffold had already done, and each paid a
  // full implement and a full review to find out.
  //
  // No skill: the loop carries it out alone, exactly as it does the two skips. The evidence is a command's
  // exit code, which is the most deterministic thing in this design, and handing that to an agent would
  // make a settled fact a judgement.
  {
    name: 'story-satisfied',
    board: 'product',
    exitPass: 'done',
    bounded: 'none',
  },
  // A STORY'S ONE TASK, WRITTEN BY THE LOOP (decision 92). Its break-down had become a run that produced one
  // task per story — a quarter of what an era spent — and a story is already cut to one acceptance criterion by
  // the feature break-down that wrote it, so the task is the story restated as the record its implement works
  // from. No skill: the loop writes it, linked in the same call, and the story goes straight to its implement.
  // `story-breakdown` stays in the table for a break-down a person dispatches by hand.
  {
    name: 'story-task',
    board: 'product',
    exitPass: 'in-progress',
    creates: 'engineering',
    bounded: 'none',
  },
  // THE WORK OF A WHOLE STORY, IN ONE RUN (decision 83). It replaces the per-task implement and the per-task
  // fix: one agent given a story and the tasks under it did three tasks' work in 18 turns and 50k of context
  // against 41 turns and 148k, for equivalent code and equivalent defect detection.
  //
  // ON PRODUCT, and that is the whole of the change — the unit of work is the story, and the tasks under it
  // are the record of what was asked rather than the thing dispatched. They stay on the board (the format is
  // frozen) and are stamped into `review` TOGETHER when this run completes — delivered, awaiting judgement,
  // and never `done`, which only a passing `story-review` writes (decision 87): `Group` in core/actions.ts
  // carries which ones and which columns, `deliverGroup` in service/act/group.ts does the writing.
  //
  // `entry` AND `exitPass` ARE THE SAME COLUMN, and they are both declared rather than left out. A story is
  // already in `in-progress` every time this phase is reached — `derivePosition` picks the open story out of
  // `todo` or `in-progress`, and `storyPhase` has already skipped the break-down for either entering column
  // — so both stamps are no-ops today and are written down for the day the derivation changes. Neither is
  // WRITTEN while the card is already there: `stampEntry` in service/act/index.ts skips one and
  // `afterCardRun` in service/act/outcomes.ts skips the other, because a move to where a card stands is a
  // write for nothing and a diary line about an event that did not happen.
  //
  // No `creates`: an implement run has no board to create cards on, and the endpoint reads this.
  {
    name: 'story-implement',
    skill: 'implement-story',
    board: 'product',
    entry: 'in-progress',
    exitPass: 'in-progress',
    bounded: 'skill',
  },
  // WHERE A SENT-BACK STORY'S WORK IS REDONE, and without it a refused judgement has nowhere to go: the
  // story sits settled in `in-progress` carrying a failed verdict, and every later tick re-stamps it to
  // where it already is. ONE budget across both send-back kinds — a story the gates sent back and one the
  // judge sent back spend one count — which is the whole of the bound now that the per-task fix it used to
  // share that rule with has gone (decision 83).
  //
  // No `exitPass`: a fix does not close a story, the judge does. The story stays where it is, and the next
  // tick finds a work run carrying no verdict — which is the judgement's own trigger.
  //
  // IT CARRIES A GROUP, as the implement does (decision 87): the tasks the send-back re-opened into
  // `in-progress`, delivered back into `review` when it completes, so the judgement after it has something
  // to judge and the board does not call re-opened work finished.
  { name: 'story-fix', skill: 'fix', board: 'product', bounded: 'skill' },
  // THE ONE JUDGEMENT A STORY GETS (decision 80), and it absorbs the story checkup. At story granularity
  // "does this do what the card asked" and "do the tasks under it compose into it" are the same question,
  // and asking both paid two cold starts for one answer.
  //
  // Stays in `product/in-progress` while it runs, so no entry stamp. It keeps the checkup's authority to
  // create on its OWN board — sibling stories (decision 47) — and ruling 61 stamps those too.
  //
  // ITS VERDICT MOVES THE TASKS TOO (decision 87), which the table cannot express because they are not its
  // card: a pass closes every task waiting in `review` before the story, and a send-back re-opens them.
  // `Judged` in core/actions.ts carries which ones and where.
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

// THE HAND BREAK-DOWNS (decision 96). No phase dispatches them, so they are neither in the table nor in
// LIFECYCLE_SKILLS, and the loop never dispatches, counts or asks a project for them. Outside the loop each
// acts as the break-down of its own board: that row decides the board it may create on and how its prompt is
// sized, and on any other board it has none.
export const HAND_BREAKDOWNS: Readonly<Record<string, PhaseName>> = {
  'break-down-feature': 'feature-breakdown',
  'break-down-story': 'story-breakdown',
};

export function actingPhase(skill: string, board?: BoardName): Phase | undefined {
  const borrowed = HAND_BREAKDOWNS[skill];
  if (borrowed === undefined) return phaseForRun(skill, board);
  const row = phase(borrowed);
  return row.board === board ? row : undefined;
}
