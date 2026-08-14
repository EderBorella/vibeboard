import { byQueueOrder } from '../../core/board/ordering.js';
import { countLive, createdNothing } from '../../core/created.js';
import { HARNESS_FEATURE } from '../../core/harness-feature.js';
import type { RunRecord } from '../../core/runs.js';
import { hasSetupFeature } from '../../core/setup-feature.js';
import type { Card } from '../../core/types.js';
import type { ActResult, TickContext } from '../loop.js';
import type { ActDeps, Dispatch } from './index.js';
import { bootstrapLine, harnessFeatureLine, scaffoldingFeatureLine } from './sentences.js';

// THE BOOTSTRAP'S TAIL: one run about the project, with no card to be about. It departs from a card run in
// exactly two places, both because there is no card:
//
//  * NO VERDICT IS RECORDED. `POST /runs/:board/:card/:run/verification` is card-scoped, and there is no card
//    for it to be written beside. Nothing is lost that a person needs: what this run did is on the board.
//  * NO COLUMN IS STAMPED, because there is no card to stamp. What this phase produced is read off the board
//    instead — cards are created through the API, so a bootstrap that worked changes no files and a
//    file-based check would call every success a failure.
//
// A bootstrap that produced nothing does NOT stop the loop here. The attempt is burned by the record itself,
// `decideTick` counts those attempts, and it is the one place that decides when to give up — a second opinion
// here would be a second cap disagreeing with the first.
//
// ITS EXIT IS THE SCAFFOLDING FLAG AND THE SMOKE-HARNESS FEATURE, and this is the only place either happens
// (decision 44, ruling 66). Both are board writes the loop makes about a derivation that has already finished,
// and both are the loop's rather than the agent's for the same reason: a fact that decides what gets built
// must not be a fact an agent can forget to state.
//
// THE FLAG FIRST, THEN THE CARD, and the order is load-bearing: `stampSetup` picks the FIRST feature in
// `features/backlog`, and the harness is created after the derivation so that it sorts last. Creating it first
// would make it a candidate for a flag that means the opposite — the scaffolding is built first, the harness
// last.
export async function afterProjectRun(
  deps: ActDeps,
  action: Dispatch,
  settled: RunRecord,
  context: TickContext,
  before: number | undefined,
): Promise<ActResult> {
  const board = await deps.client.board();
  // `countLive`, the same count `createdNothing` is defined over: two ways of counting one board would be two
  // answers to "did this run produce anything".
  const created = board.ok ? countLive(board.value.boards) : undefined;
  // Only where the board actually grew. A bootstrap that produced nothing has no scaffolding feature to name,
  // and a board that could not be read is not evidence that it did.
  if (board.ok && before !== undefined && created !== undefined && !createdNothing(before, created)) {
    await stampSetup(deps, board.value.boards.features ?? []);
    await createHarnessFeature(deps);
  }
  await deps.client.log('run', bootstrapLine(action.skill, settled, created, context), {
    iteration: context.iteration + 1,
    skill: action.skill,
    outcome: settled.status,
  });
  return { dispatches: 1 };
}

// `setup: true` ON THE FIRST FEATURE IN `features/backlog`, by the `order` THE ENDPOINT ASSIGNED — read off the
// board rather than out of the run's `created` list, which is the agent's claim about itself (finding F).
//
// WHICH FEATURE IS THE SCAFFOLDING IS NOT ASKED OF THE MODEL: it is the first one, and the loop stamps it. The
// skill is told to derive features in the order they must be built and cannot set this flag at all.
//
// GUARDED BY `hasSetupFeature` over the live board AND THE ARCHIVE, because "once" is a board fact (decision
// 50): a feature somebody archived after the bootstrap stamped it must still count, or a second derivation
// would hand the flag to a card nobody chose — and under decision 51 the flag is what makes an absent gate set
// expected instead of a failure.
async function stampSetup(deps: ActDeps, features: Card[]): Promise<void> {
  const archived = await deps.client.archive('features');
  // A read that failed is not "no scaffolding feature". Withholding the stamp costs an ordering fact; awarding
  // it on no evidence switches off a fail-closed check, so this fails the cheaper way.
  if (!archived.ok) {
    deps.log?.(`could not read the archive, so the scaffolding flag was left alone: ${archived.reason}`);
    return;
  }
  if (hasSetupFeature([...features, ...archived.value.cards])) return;
  const first = features.filter((c) => c.columnSlug === 'backlog').sort(byQueueOrder)[0];
  if (!first) return;
  const done = await deps.client.flags(first.board, first.id, { setup: true });
  if (!done.ok) {
    // NOT FATAL. This is the exit of a run that has already happened; losing the flag costs an ordering fact,
    // and stopping the loop over it costs the project.
    deps.log?.(`could not flag ${first.id} as the scaffolding feature: ${done.reason}`);
    return;
  }
  await deps.client.log('lifecycle', scaffoldingFeatureLine(first), {
    card: first.id,
    board: first.board,
  });
}

// THE SMOKE-HARNESS FEATURE (ruling 66), created here and nowhere else. The card is canned — its title and its
// body are in core/harness-feature.ts, with the argument for each — and this function is only the write.
//
// LAST BY CONSTRUCTION rather than by asking for a position: the endpoint gives a new card the next order in
// `features/backlog`, and this runs after the derivation has already filled it. That is what makes the harness
// the last feature built, which is the only order it can be built in — there is nothing to smoke test before the
// product exists.
//
// NOT FATAL, exactly like the flag above. This is the exit of a run that has already happened, and stopping the
// loop over it would cost the project the whole derivation. What it costs instead is bounded: `complete` refuses
// while the smoke command is still one of the gates (core/tick.ts), so a project that lost this card is a project
// that says why it will not report itself finished rather than one that quietly does.
//
// AND A CREATE THAT WAS REFUSED IS ALSO NOT FATAL, which covers the one case worth naming: a second bootstrap on
// a board that already holds the card is refused by the endpoint's duplicate-title rule, and being told "that
// card already exists" is the answer this wanted.
async function createHarnessFeature(deps: ActDeps): Promise<void> {
  const made = await deps.client.create({
    board: 'features',
    // The column the endpoint stamps anyway, sent because the request takes one. A card a run creates enters its
    // board's first column whatever it asked for.
    columnSlug: 'backlog',
    title: HARNESS_FEATURE.title,
    body: HARNESS_FEATURE.body,
  });
  if (!made.ok) {
    deps.log?.(`could not create the smoke-harness feature: ${made.reason}`);
    return;
  }
  await deps.client.log('lifecycle', harnessFeatureLine(made.value.id), {
    card: made.value.id,
    board: 'features',
  });
}
