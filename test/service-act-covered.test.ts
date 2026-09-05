import { describe, expect, it } from 'vitest';
import type { TickAction } from '../src/core/actions.js';
import { isSettled } from '../src/core/derived-status.js';
import type { RunRecord } from '../src/core/runs.js';
import { performAction } from '../src/service/act.js';
import { CARD, context, deps, recorder } from './service-act-fixtures.js';

// The same autopilot config the fixtures drive the loop with, so `isSettled` below is asked the question
// the tick asks rather than a second spelling of it.
const AP = {
  terminal: { features: ['done'], product: ['done'], engineering: ['done'] },
  blockedColumn: 'blocked',
} as unknown as Parameters<typeof isSettled>[0];

// DECISION 71: A CREATING PHASE MAY CLOSE ITS CARD BY SHOWING THE WORK IS ALREADY DONE.
//
// `decision 43` refuses to advance a creating phase whose board did not grow, whatever the run reported,
// because agents claimed cards they had never made. That leaves no way to say the truthful version, and
// the cost was watched live: the machine's own smoke-harness feature was created on a project that had
// already declared and exercised a smoke command, its three break-down runs each reported *"I created no
// cards, because every claim this card makes is already true"*, each named the cards that had done it,
// and the loop stalled on the last card of an otherwise finished project. A story blocked the same way,
// citing the file and line of a test its sibling task had written.
//
// The difference from what decision 43 refuses is that this claim is CHECKED against the board.

const feature = CARD('F-007', 'features');

const BREAKDOWN: TickAction = {
  kind: 'dispatch',
  phase: 'feature-breakdown',
  card: feature,
  skill: 'break-down',
};

// A settled run that created nothing and cited `covered`. `filesChanged` is what stops `producedNothing`
// short-circuiting before the branch under test — a creating run's product goes through the API, so the
// fixtures elsewhere use the same trick.
const citing = (covered: string[]): RunRecord =>
  ({
    run: 'R1',
    card: 'F-007',
    board: 'features',
    skill: 'break-down',
    status: 'success',
    outcome: 'success',
    started: 'T',
    finished: 'T',
    filesChanged: 1,
    covered,
  }) as unknown as RunRecord;

const done = (id: string, board: 'features' | 'product' | 'engineering') => ({
  ...CARD(id, board),
  id,
  columnSlug: 'done',
});
const open = (id: string, board: 'features' | 'product' | 'engineering') => ({
  ...CARD(id, board),
  id,
  columnSlug: 'backlog',
});

// EVERY PHASE WRITES AN ENTRY STAMP FIRST (`stampEntry`), so `moves` always opens with the card arriving
// in the phase's own column. A first version of these tests asserted the exit stamp alone and failed on
// that — the premise was mine, not the code's. So each case below asserts what happened AFTER the entry.
const ENTRY = { card: 'F-007', to: 'todo' };

// The board does NOT grow in any of these — that is the premise. `boardBefore` and `boardCards` are the
// same list, so `boardGrew` is false and the empty-create rule is what would otherwise apply.
const noGrowth = (extra: ReturnType<typeof done>[]) =>
  recorder({
    settle: [citing(['P-030', 'E-031'])],
    boardBefore: [feature, ...extra],
    boardCards: [feature, ...extra],
  });

describe('a creating phase that found the work already done', () => {
  it('closes the card when every cited id exists and is settled', async () => {
    const r = noGrowth([done('P-030', 'product'), done('E-031', 'engineering')]);
    const result = await performAction(deps(r.client), BREAKDOWN, context);
    // A TERMINAL COLUMN, not the phase's `exitPass`. Live, `in-progress` was not enough: the tick
    // dispatches feature-breakdown whenever a feature has no children, before it looks at any column, so
    // a card that closed on coverage was re-dispatched until the attempt cap stopped the project.
    expect(r.moves).toEqual([ENTRY, { card: 'F-007', to: 'done' }]);
    expect(result.dispatches).toBe(1);
  });

  it('says in the diary which cards were cited, and that they were checked', async () => {
    const r = noGrowth([done('P-030', 'product'), done('E-031', 'engineering')]);
    await performAction(deps(r.client), BREAKDOWN, context);
    const line = r.diary.map((d) => d.text).join('\n');
    expect(line).toMatch(/the work is already done by P-030, E-031/);
    // A person querying a card that closed having created nothing must find the answer here.
    expect(line).toMatch(/checked against the board/i);
  });

  // THE CLAIM THE LIVE RUN TAUGHT, and it is about what the TICK reads rather than about the move. The
  // first version of this file asserted the card reached the phase's `exitPass` and passed, while the
  // real loop re-dispatched the same break-down three times and stalled: `phaseAction` dispatches
  // feature-breakdown whenever a feature has no children, before it looks at any column at all.
  //
  // So the assertion is tied to `isSettled` — the rule the tick uses — rather than to the string `done`.
  // A config whose terminal column is named something else must still land somewhere the loop is finished
  // with, and a hardcoded column name would pass while the loop span.
  it('lands the card somewhere the tick treats as settled, not merely moved', async () => {
    const r = noGrowth([done('P-030', 'product'), done('E-031', 'engineering')]);
    await performAction(deps(r.client), BREAKDOWN, context);
    const landed = r.moves.at(-1);
    expect(landed).toBeDefined();
    expect(landed?.card).toBe('F-007');
    expect(
      isSettled(AP, { ...feature, columnSlug: landed?.to ?? '' } as unknown as Parameters<
        typeof isSettled
      >[1]),
    ).toBe(true);
  });

  // THE HALF THAT MAKES IT SAFE, and the reason this is not what decision 43 refuses.
  it('refuses a claim citing a card that does not exist, and burns the attempt', async () => {
    const r = noGrowth([done('P-030', 'product')]); // E-031 is absent
    await performAction(deps(r.client), BREAKDOWN, context);
    // The entry stamp and nothing more: the card did not advance.
    expect(r.moves).toEqual([ENTRY]);
  });

  it('refuses a claim citing a card that is still open', async () => {
    const r = noGrowth([done('P-030', 'product'), open('E-031', 'engineering')]);
    await performAction(deps(r.client), BREAKDOWN, context);
    expect(r.moves).toEqual([ENTRY]);
  });

  it('refuses a run that cited nothing at all', async () => {
    const r = recorder({
      settle: [{ ...citing([]), covered: undefined } as unknown as RunRecord],
      boardBefore: [feature],
      boardCards: [feature],
    });
    await performAction(deps(r.client), BREAKDOWN, context);
    expect(r.moves).toEqual([ENTRY]);
  });
});
