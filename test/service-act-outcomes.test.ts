import { describe, expect, it } from 'vitest';
import type { TickAction } from '../src/core/actions.js';
import type { RunRecord } from '../src/core/runs.js';
import { type ActDeps, performAction } from '../src/service/act.js';
import {
  BOOTSTRAP,
  BREAKDOWN,
  CARD,
  context,
  deps,
  IMPLEMENT,
  projectRun,
  record,
  recorder,
} from './service-act-fixtures.js';

// WHAT A SETTLED RUN EARNED: the exit stamp, or one of the endings that do not take it — a run that left nothing
// behind, a creating phase whose board did not grow, a feature checkup that grew it, and a run that died.

// THE FIRST HAND-RUN'S FINDING. A run that left nothing behind must not advance its card: the gates would
// answer about a tree the run never touched — commands that were passing before the dispatch and are passing
// now — so the card advances having implemented nothing, with no model anywhere in the loop to notice.
describe('a run that produced nothing', () => {
  const empty = (over: Partial<RunRecord> = {}) =>
    record({ status: 'failed', outcome: undefined, filesChanged: 0, ...over });

  it('does not stamp the exit column, and records a verdict saying nothing was checked', async () => {
    const r = recorder({ settle: [empty()] });
    const result = await performAction(deps(r.client), IMPLEMENT(), context);
    expect(result.dispatches).toBe(1);
    // The entry stamp stands and the exit one does not: the card is where its phase put it.
    expect(r.moves).toEqual([{ card: 'E-001', to: 'in-progress' }]);
    expect(r.verdicts).toHaveLength(1);
    expect(r.verdicts[0]).toMatchObject({ passed: false });
    expect(r.verdicts[0]?.reason).toContain('left nothing this server can see');
  });

  it('stops at a refused verdict rather than moving the card anyway', async () => {
    const r = recorder({
      settle: [empty()],
      verdict: { ok: false, reason: 'refused with 401', fatal: true },
    });
    const result = await performAction(deps(r.client), IMPLEMENT(), context);
    expect(result.stop?.reason).toBe('stalled');
    // And the dispatch still counts: the agent really ran.
    expect(result.dispatches).toBe(1);
    expect(r.moves).toEqual([{ card: 'E-001', to: 'in-progress' }]);
  });

  it('says in the diary that nothing was checked, rather than that a check failed', async () => {
    // A line whose opening clause contradicts the reason after it is worse than one that says less.
    const r = recorder({ settle: [empty()] });
    await performAction(deps(r.client), IMPLEMENT(), context);
    const line = r.diary.find((d) => d.kind === 'run')?.text ?? '';
    expect(line).toContain('nothing was checked');
    expect(line).not.toContain('failed the gates');
  });

  // DECISION 40'S THIRD CLAUSE, and it needs asserting on its own because `producedNothing` does not cover it:
  // a run killed by the clock after touching one file HAS changed a file, so the predicate is false and the
  // card reached the exit stamp. Nothing here judges the work, so nothing would ever notice.
  it('holds a failed run that changed files, because a run that died does not advance its card', async () => {
    const r = recorder({ settle: [empty({ filesChanged: 3 })] });
    const result = await performAction(deps(r.client), IMPLEMENT(), context);
    // The entry stamp stands and the exit one does not.
    expect(r.moves).toEqual([{ card: 'E-001', to: 'in-progress' }]);
    // And no verdict: a dead run left no state anything can have an opinion about, and a failed verdict would
    // send the task to `fix` instead of retrying its own phase.
    expect(r.verdicts).toEqual([]);
    // The attempt still counts — the agent had its chance — so the phase's own cap is what gives up.
    expect(result.dispatches).toBe(1);
    expect(r.diary.some((d) => d.text.includes('the attempt is spent'))).toBe(true);
  });

  it('advances a run whose product was cards rather than files', async () => {
    // The successful shape of every card-producing skill: cards go through the API, so no file changed. The
    // board has to GROW in the fixture, because a creating phase is judged on that too — see `createdNothing`.
    const r = recorder({
      settle: [record({ status: 'success', outcome: 'success', filesChanged: 0 })],
      boardBefore: [CARD('F-001', 'features')],
      boardCards: [CARD('F-001', 'features'), CARD('P-001', 'product')],
    });
    await performAction(deps(r.client), BREAKDOWN(), context);
    expect(r.moves.at(-1)).toEqual({ card: 'F-001', to: 'in-progress' });
    expect(r.verdicts).toEqual([]);
  });

  it('writes no empty-run verdict when the file count could not be taken at all', async () => {
    // Absent is not zero: a measurement that could not be taken says nothing about what changed, so this run
    // is NOT `producedNothing` and gets no verdict saying nothing was checked. It is still `failed`, so it is
    // still held — the two rules answer different questions about the same run.
    const r = recorder({ settle: [record({ status: 'failed', outcome: undefined })] });
    await performAction(deps(r.client), IMPLEMENT(), context);
    expect(r.verdicts).toEqual([]);
    expect(r.moves).toEqual([{ card: 'E-001', to: 'in-progress' }]);
  });

  // THE WORST CASE THE CLAUSE NAMES: a checkup's `exitPass` is `done`, so a dead `checkup-feature` closed the
  // feature and a dead `checkup-story` closed the story.
  it('does not let a dead checkup close its feature', async () => {
    const feature = { ...CARD('F-001', 'features'), columnSlug: 'in-progress', links: [] };
    const r = recorder({
      settle: [empty({ card: 'F-001', board: 'features', filesChanged: 1 })],
      boardBefore: [feature],
      boardCards: [feature],
    });
    await performAction(
      deps(r.client),
      { kind: 'dispatch', phase: 'feature-checkup', skill: 'checkup-feature', card: feature },
      context,
    );
    expect(r.moves).toEqual([]);
  });

  // AND THE STORY'S, WHICH TAKES THE OTHER PATH SINCE DECISION 80. `reviewStory` bypasses `afterCardRun`
  // entirely, so this clause has to be asserted against it separately — and the fixture is the hard case
  // rather than the easy one: a run the clock killed AFTER it wrote its report has a verdict, so a branch
  // reading only `verdict` would close the story on a dead run.
  it('does not let a dead judgement close its story', async () => {
    const story = { ...CARD('P-001', 'product'), columnSlug: 'in-progress', links: [] };
    const r = recorder({
      settle: [record({ card: 'P-001', board: 'product', status: 'failed', verdict: 'done' })],
      boardCards: [story],
    });
    await performAction(
      deps(r.client, {
        verify: {
          gates: async () => ({ mode: 'gates' as const, passed: true, at: 'T' }),
          smoke: async () => ({ mode: 'smoke' as const, passed: true, at: 'T' }),
        } as unknown as ActDeps['verify'],
      }),
      { kind: 'dispatch', phase: 'story-review', skill: 'review-story', card: story, previous: 'W-1' },
      context,
    );
    expect(r.moves).toEqual([]);
    expect(r.verdicts).toEqual([]);
  });
});

// `createdNothing`'s FIRST AND ONLY CALLER. A card-creating phase whose run produced no card has not done its
// job, whatever it reported — and it is counted from the BOARD rather than from `record.created`, which is the
// agent's claim about itself (decision 43).
describe('a creating run that created nothing', () => {
  it('fails a break-down that created no card, and leaves the card where it is', async () => {
    const r = recorder({ boardBefore: [CARD('F-001', 'features')], boardCards: [CARD('F-001', 'features')] });
    const result = await performAction(deps(r.client), BREAKDOWN(), context);
    expect(r.verdicts[0]).toMatchObject({ passed: false });
    expect(r.verdicts[0]?.reason).toContain('no card');
    // The ENTRY stamp only: the card is where its phase put it, and the attempt is burned by the record.
    expect(r.moves).toEqual([{ card: 'F-001', to: 'todo' }]);
    expect(result.dispatches).toBe(1);
  });

  it('advances a break-down that created one card even though it changed no files', async () => {
    // Cards go through the API, so a real derivation legitimately changes nothing on disk — which is why this
    // is a board comparison and not a file count.
    const r = recorder({
      boardBefore: [CARD('F-001', 'features')],
      boardCards: [CARD('F-001', 'features'), CARD('P-001', 'product')],
      settle: [record({ status: 'success', outcome: 'success', filesChanged: 0 })],
    });
    await performAction(deps(r.client), BREAKDOWN(), context);
    expect(r.verdicts).toEqual([]);
    expect(r.moves.at(-1)).toEqual({ card: 'F-001', to: 'in-progress' });
  });

  it('does not apply to a checkup, whose ordinary case is creating nothing', async () => {
    // FINDING B, folded into decision 43: a checkup's product is a REPORT. Applied to them this rule would
    // refuse every close. The FEATURE's is the one that still takes this path — the story's judgement is
    // never asked whether the board grew at all (`reviewStory`), which is the same rule by construction.
    const feature = { ...CARD('F-001', 'features'), columnSlug: 'in-progress', links: ['P-001'] };
    const story = CARD('P-001', 'product');
    const r = recorder({ boardBefore: [feature, story], boardCards: [feature, story] });
    await performAction(
      deps(r.client),
      { kind: 'dispatch', phase: 'feature-checkup', skill: 'checkup-feature', card: feature },
      context,
    );
    expect(r.verdicts).toEqual([]);
    expect(r.moves).toEqual([{ card: 'F-001', to: 'done' }]);
  });

  it('advances the card when the board could not be read back, rather than failing on no evidence', async () => {
    // A failed read is not evidence that nothing was created. Being wrong the other way would fail a good run.
    const r = recorder({ board: { ok: false, reason: 'could not reach the board', fatal: false } });
    await performAction(deps(r.client), BREAKDOWN(), context);
    expect(r.verdicts).toEqual([]);
    expect(r.moves.at(-1)).toEqual({ card: 'F-001', to: 'in-progress' });
  });

  it('fails a bootstrap that created no card, and burns its attempt', async () => {
    const r = recorder({ settle: [projectRun()], boardBefore: [], boardCards: [] });
    const result = await performAction(deps(r.client), BOOTSTRAP, context);
    // A project run has no card to write a verdict beside, so the record itself is what burns the attempt —
    // and `decideTick` is the one place that decides when to give up.
    expect(r.verdicts).toEqual([]);
    expect(r.flags).toEqual([]);
    expect(r.diary.some((d) => d.text.includes('the board is still empty'))).toBe(true);
    expect(result.stop).toBeUndefined();
    expect(result.dispatches).toBe(1);
  });
});

// THE FEATURE CHECKUP'S TWO EXITS (the L1 loop). Created stories → the feature stays OPEN and L2 walks them;
// created nothing → `done`. Stamped `done` regardless, everything a checkup creates is an ORPHAN:
// `derivePosition` picks a feature only out of `todo` or `in-progress`, so a closed feature is never
// re-entered — and `creatingRoundSpent`, which bounds the second round, is then unreachable through the loop.
describe('a feature checkup that created work', () => {
  const feature = { ...CARD('F-001', 'features'), columnSlug: 'in-progress', links: ['P-001'] };
  const story = CARD('P-001', 'product');
  const CHECKUP: TickAction = {
    kind: 'dispatch',
    phase: 'feature-checkup',
    skill: 'checkup-feature',
    card: feature,
  };

  it('leaves the feature open when the board grew while it ran', async () => {
    const r = recorder({ boardBefore: [feature], boardCards: [feature, story] });
    const result = await performAction(deps(r.client), CHECKUP, context);
    expect(r.moves).toEqual([]);
    // Not a failure: the run did what it is for, and what it found is on the board.
    expect(r.verdicts).toEqual([]);
    expect(result.dispatches).toBe(1);
    expect(r.diary.some((d) => d.text.includes('stays open until that work is done'))).toBe(true);
  });

  it('closes the feature when it created nothing, which is the ordinary case', async () => {
    const r = recorder({ boardBefore: [feature, story], boardCards: [feature, story] });
    await performAction(deps(r.client), CHECKUP, context);
    expect(r.moves).toEqual([{ card: 'F-001', to: 'done' }]);
  });

  it('closes the feature when the board could not be read, rather than holding it open on no evidence', async () => {
    // A comparison nobody could make is not evidence that stories were created. Holding the card open on it
    // would stop the feature closing for as long as the read kept failing.
    const r = recorder({ board: { ok: false, reason: 'could not reach the board', fatal: false } });
    await performAction(deps(r.client), CHECKUP, context);
    expect(r.moves).toEqual([{ card: 'F-001', to: 'done' }]);
  });

  it('closes a STORY that its judgement gave siblings, because closing and creating are one act', async () => {
    // Ruling 54: leaving the story open while its new siblings are worked would mean two open stories, which
    // is the one invariant the derived position cannot survive. Since decision 80 the story's judgement does
    // not take this path at all and is never asked whether the board grew — so the rule holds by
    // construction, and this asserts it where the behaviour now lives.
    const open = { ...story, columnSlug: 'in-progress' };
    const r = recorder({
      settle: [record({ card: 'P-001', board: 'product', verdict: 'done' })],
      boardBefore: [open],
      boardCards: [open, CARD('P-002', 'product')],
    });
    await performAction(
      deps(r.client, {
        verify: {
          gates: async () => ({ mode: 'gates' as const, passed: true, at: 'T' }),
          smoke: async () => ({ mode: 'smoke' as const, passed: true, at: 'T' }),
        } as unknown as ActDeps['verify'],
      }),
      { kind: 'dispatch', phase: 'story-review', skill: 'review-story', card: open, previous: 'W-1' },
      context,
    );
    expect(r.moves).toEqual([{ card: 'P-001', to: 'done' }]);
  });
});
