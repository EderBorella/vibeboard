import { describe, expect, it } from 'vitest';
import { performAction } from '../src/service/act.js';
import { CARD, context, deps, IMPLEMENT, record, recorder, STORY } from './service-act-fixtures.js';

// THE CARDS ONE LEVEL DOWN A DISPATCH DELIVERS (decision 83): a story's implement run and the tasks it was
// asked for. Two claims, and the machine rests on both — the tasks are stamped into `in-progress` BEFORE the
// dispatch, because where they stand is the only way the run is told which are its own; and they are stamped
// `done` TOGETHER when it succeeds, because a story is judged once every task under it is settled and a
// partial stamp would leave one half-closed.
//
// The fixtures are the shared ones: `IMPLEMENT` is the story's implement action, and its second argument is
// the group. Three tasks rather than two throughout, because "all of them" and "the first two" are the same
// list with two.

const task = (id: string, columnSlug = 'backlog') => ({ ...CARD(id), columnSlug });

const THREE = [task('E-001'), task('E-002'), task('E-003')];

describe('the tasks a story’s implement run is given', () => {
  it('claims every one of them before the dispatch, in the order the tick handed them over', async () => {
    const r = recorder();
    await performAction(deps(r.client), IMPLEMENT(STORY(), THREE), context);
    // Every move carries its own diary line — that is what `stamp` is — so the sequence is filtered to the
    // two kinds of call this is about rather than restated with the lines in it.
    expect(r.calls.filter((c) => c.startsWith('move:') || c.startsWith('dispatch:')).slice(0, 4)).toEqual([
      'move:in-progress',
      'move:in-progress',
      'move:in-progress',
      'dispatch:implement-story',
    ]);
    expect(r.moves.slice(0, 3)).toEqual([
      { card: 'E-001', to: 'in-progress' },
      { card: 'E-002', to: 'in-progress' },
      { card: 'E-003', to: 'in-progress' },
    ]);
  });

  // ONLY WHERE THE CARD IS NOT THERE ALREADY, the same care the card's own entry stamp takes: a second
  // attempt finds its tasks where the first left them, and re-stamping writes "moved to in-progress" into
  // the diary once an attempt for an event that did not happen.
  it('claims nothing for a task already standing in that column', async () => {
    const r = recorder();
    await performAction(
      deps(r.client),
      IMPLEMENT(STORY(), [task('E-001', 'in-progress'), task('E-002')]),
      context,
    );
    expect(r.moves.slice(0, 1)).toEqual([{ card: 'E-002', to: 'in-progress' }]);
    expect(r.diary.some((d) => d.text.includes('E-001 moved to in-progress'))).toBe(false);
  });

  // AND NOT ONE A PERSON FINISHED WHILE THE TICK WAS DECIDING. The group is formed from what is outstanding,
  // so this is the window between the board being read and the claim being written — and the guard above
  // compares against `entry` alone, so without this one a task already in `done` is pulled back into
  // `in-progress` and a run is asked to do work that has landed.
  it('claims nothing for a task that is already settled', async () => {
    const r = recorder();
    await performAction(deps(r.client), IMPLEMENT(STORY(), [task('E-001', 'done'), task('E-002')]), context);
    expect(r.moves.filter((m) => m.card === 'E-001')).toEqual([]);
    expect(r.diary.some((d) => d.text.includes('E-001 moved'))).toBe(false);
  });

  // THE SAME CARE AT THE OTHER END, and this was the one of the five stamps that did not take it: a move to
  // where a card already stands is a write for nothing and a diary line for an event that did not happen.
  it('settles nothing for a task already standing in the settled column', async () => {
    const r = recorder();
    await performAction(
      deps(r.client),
      IMPLEMENT(STORY(), [task('E-001', 'done'), task('E-002', 'in-progress')]),
      context,
    );
    expect(r.moves).toEqual([{ card: 'E-002', to: 'done' }]);
    expect(r.diary.some((d) => d.text.includes('E-001 moved to done'))).toBe(false);
  });

  // THE ATOMICITY THE STORY'S JUDGEMENT DEPENDS ON. One act: every task, in the one call that followed the
  // run. Stamped one at a time — a tick each, or a group of one at a time — the story spends a window with
  // some tasks settled and some not, and a loop that died inside it would come back to a judgement firing
  // over work no run ever did.
  it('settles all of them together when the run succeeds', async () => {
    const r = recorder();
    const result = await performAction(deps(r.client), IMPLEMENT(STORY(), THREE), context);
    expect(result.dispatches).toBe(1);
    expect(r.moves).toEqual([
      { card: 'E-001', to: 'in-progress' },
      { card: 'E-002', to: 'in-progress' },
      { card: 'E-003', to: 'in-progress' },
      { card: 'E-001', to: 'done' },
      { card: 'E-002', to: 'done' },
      { card: 'E-003', to: 'done' },
    ]);
  });

  // AND THE STORY ITSELF DOES NOT MOVE. Its implement exits into the column it runs in — the one the
  // judgement reads — so the stamp is a write for nothing and the diary line would report an event that did
  // not happen. Asserted as "no product card moved at all", because a move to `in-progress` is exactly the
  // one that would look right in a list.
  it('moves the story nowhere, because it is already where its judgement reads it', async () => {
    const r = recorder();
    await performAction(deps(r.client), IMPLEMENT(STORY(), THREE), context);
    expect(r.moves.filter((m) => m.card === 'P-001')).toEqual([]);
    expect(r.diary.some((d) => d.text.includes('P-001 moved'))).toBe(false);
    // And the line about the run says so rather than naming a column it did not move to.
    expect(r.diary.find((d) => d.kind === 'run')?.text).toContain('it stayed where it is');
  });

  // NOTHING IS SETTLED BY A RUN THAT DID NOT DELIVER. Each of these is a different ending and each already
  // holds the card itself; the tasks have to be held with it, or a story closes over work nobody did.
  it('settles none of them when the run left nothing behind', async () => {
    const r = recorder({ settle: [record({ status: 'failed', outcome: undefined, filesChanged: 0 })] });
    await performAction(deps(r.client), IMPLEMENT(STORY(), THREE), context);
    expect(r.moves.filter((m) => m.to === 'done')).toEqual([]);
  });

  it('settles none of them when the run died', async () => {
    const r = recorder({ settle: [record({ status: 'failed', filesChanged: 3 })] });
    await performAction(deps(r.client), IMPLEMENT(STORY(), THREE), context);
    expect(r.moves.filter((m) => m.to === 'done')).toEqual([]);
  });

  it('settles none of them when the run was cancelled', async () => {
    const r = recorder({ settle: [record({ status: 'cancelled' })] });
    await performAction(deps(r.client), IMPLEMENT(STORY(), THREE), context);
    expect(r.moves.filter((m) => m.to === 'done')).toEqual([]);
  });

  // A REFUSAL MID-GROUP STOPS THE ACT. Both endings leave a partial board — there is no transaction over
  // three HTTP calls — and this one leaves it on the side the machine can recover from: fewer tasks settled
  // means the story stays unjudgeable, and the next dispatch re-forms the group out of what is outstanding.
  //
  // The diary line about the RUN is what must not be written: it says the run completed, and a reader who
  // sees it has no reason to look for the two tasks that never closed.
  it('stops at the first refusal, and does not report the run as completed', async () => {
    const r = recorder();
    const move = r.client.move;
    r.client.move = async (board, card, to) =>
      card === 'E-002' && to === 'done'
        ? { ok: false as const, reason: 'refused with 409', fatal: false }
        : move(board, card, to);

    const result = await performAction(deps(r.client), IMPLEMENT(STORY(), THREE), context);
    // The dispatch HAPPENED and is counted: a real agent run reported as none at all is how both caps came
    // to be told nothing and the next tick re-dispatched over work that had already passed.
    expect(result.dispatches).toBe(1);
    expect(r.moves.filter((m) => m.to === 'done')).toEqual([{ card: 'E-001', to: 'done' }]);
    expect(r.diary.some((d) => d.kind === 'run' && d.text.includes('for its story-implement phase'))).toBe(
      false,
    );
    expect(r.diary.some((d) => d.kind === 'note' && d.text.includes('could not settle E-002'))).toBe(true);
  });

  it('stops the loop when the refusal is one it cannot recover from', async () => {
    const r = recorder();
    const move = r.client.move;
    r.client.move = async (board, card, to) =>
      to === 'done' ? { ok: false as const, reason: 'refused with 401', fatal: true } : move(board, card, to);

    const result = await performAction(deps(r.client), IMPLEMENT(STORY(), THREE), context);
    expect(result.stop?.reason).toBe('stalled');
    expect(result.stop?.detail).toContain('E-001');
  });

  // A PHASE WITH NO GROUP IS UNTOUCHED BY ANY OF THIS, which is what keeps the two stamps from being a rule
  // every other phase has to know about.
  it('claims and settles nothing for a dispatch that carries no group', async () => {
    const r = recorder();
    await performAction(
      deps(r.client),
      { kind: 'dispatch', phase: 'story-fix', skill: 'fix', card: STORY(), previous: 'IMPL-1' },
      context,
    );
    expect(r.moves).toEqual([]);
  });
});
