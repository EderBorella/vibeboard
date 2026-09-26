import { describe, expect, it } from 'vitest';
import type { TickAction } from '../src/core/actions.js';
import { performAction } from '../src/service/act.js';
import {
  BREAKDOWN,
  CARD,
  commits,
  context,
  deps,
  FIX,
  IMPLEMENT,
  record,
  recorder,
  STORY,
} from './service-act-fixtures.js';

// CARRYING ONE ACTION OUT, through `performAction` itself: the ORDER and the CONDITIONS — commit before the
// entry stamp before the dispatch, the exit column stamped because the run COMPLETED rather than because it said
// it had, and a dispatch that happened counted even when what came after it broke. What each ending EARNS is in
// service-act-outcomes.test.ts; the fixtures are in service-act-fixtures.ts.

describe('one dispatch, end to end', () => {
  it('stamps the entry column before the dispatch, and commits before both', async () => {
    // Step 10 is load-bearing: a commit before every dispatch is what makes an aborted run one command from
    // gone, and a commit afterwards would capture the agent's work rather than the tree it started from. The
    // ORDER is asserted, not just the presence of all three.
    const order: string[] = [];
    const r = recorder();
    const originalDispatch = r.client.dispatch;
    const originalMove = r.client.move;
    r.client.dispatch = async (input) => {
      order.push('dispatch');
      return originalDispatch(input);
    };
    r.client.move = async (board, card, to) => {
      order.push(`move:${to}`);
      return originalMove(board, card, to);
    };
    await performAction(
      deps(r.client, {
        commit: async () => {
          order.push('commit');
          return { committed: true };
        },
      }),
      BREAKDOWN(),
      context,
    );
    expect(order.slice(0, 3)).toEqual(['commit', 'move:todo', 'dispatch']);
  });

  // A RETRY HAS THE SAME ENTRY COLUMN AS THE ATTEMPT BEFORE IT, so the card is already there — and re-stamping
  // it put "moved to todo" in the diary for an event that did not happen, which is exactly what the entry
  // stamp's own comment says the design avoids.
  it('stamps nothing on entry when the card is already in the entry column', async () => {
    const already = { ...CARD('F-001', 'features'), columnSlug: 'todo' };
    const r = recorder({
      boardBefore: [already],
      boardCards: [already, CARD('P-001', 'product')],
    });
    await performAction(deps(r.client), BREAKDOWN(already), context);
    // The exit stamp only. Asserted as the whole list, because an extra `todo` in front of it is the defect.
    expect(r.moves).toEqual([{ card: 'F-001', to: 'in-progress' }]);
    expect(r.diary.some((d) => d.text.includes('moved to todo'))).toBe(false);
  });

  it('stamps nothing at either end for a phase that names no column', async () => {
    // A story being fixed is already in `in-progress`; a move to where it is would be a write for nothing —
    // and a diary line about an event that did not happen. Its exit is the JUDGE's, not the fix's, so this
    // phase names neither column and the whole action is a commit and a dispatch. Asserted as the ORDER
    // rather than as an empty `moves`, so a stamp appearing in the wrong PLACE would also fail.
    const order: string[] = [];
    const r = recorder();
    const originalDispatch = r.client.dispatch;
    const originalMove = r.client.move;
    r.client.dispatch = async (input) => {
      order.push('dispatch');
      return originalDispatch(input);
    };
    r.client.move = async (board, card, to) => {
      order.push(`move:${to}`);
      return originalMove(board, card, to);
    };
    await performAction(
      deps(r.client, {
        commit: async () => {
          order.push('commit');
          return { committed: true };
        },
      }),
      FIX(),
      context,
    );
    expect(order).toEqual(['commit', 'dispatch']);
  });

  it('commits the run’s own tree, on the run’s own branch', async () => {
    commits.length = 0;
    const r = recorder();
    await performAction(deps(r.client), IMPLEMENT(), context);
    expect(commits[0]).toMatchObject({ root: '/tmp/project', branch: 'autopilot/2026-08-06' });
    // The STORY is what the run is about, and the message names it: the tasks under it are what the run
    // was asked for, not what it was dispatched against.
    expect(commits[0]?.message).toContain('P-001');
    expect(commits[0]?.message).toContain('implement-story');
    expect(commits[0]?.message).toContain('iteration 4');
  });

  // THROUGH THE ENDPOINT, and into `review`: a completed run delivers its task and never closes it — that is
  // the story's judgement to do (decision 87).
  it('delivers its task through the endpoint once the run completes, and closes nothing', async () => {
    const r = recorder();
    const result = await performAction(deps(r.client), IMPLEMENT(), context);
    expect(result.dispatches).toBe(1);
    expect(r.moves).toEqual([
      { card: 'E-001', to: 'in-progress' },
      { card: 'E-001', to: 'review' },
    ]);
  });

  // DECISION 40. The loop reads its own record of how the run ended — `status`, which the runner assigns —
  // and never the `outcome` the agent wrote about itself. A run that finished saying it could not do the
  // work still delivers its task, into exactly the column a success does, and the STORY's gates and
  // judgement take it as it stands — the claim cannot change where the card goes either way. What it can no
  // longer do is close the task (decision 87): `done` is the judgement's to write.
  it('ignores what the agent said about its own work', async () => {
    const r = recorder({ settle: [record({ status: 'attention', outcome: 'attention' })] });
    await performAction(deps(r.client), IMPLEMENT(), context);
    expect(r.moves.at(-1)).toEqual({ card: 'E-001', to: 'review' });
  });

  it('does not stamp on exit when the run did not settle', async () => {
    const r = recorder({ settle: [record({ status: 'running' })] });
    const result = await performAction(deps(r.client), IMPLEMENT(), context);
    expect(result.stop?.reason).toBe('stalled');
    expect(result.stop?.detail).toContain('did not finish');
    // The ENTRY stamp happened and the exit one did not: a card mid-phase is the honest state to leave.
    expect(r.moves).toEqual([{ card: 'E-001', to: 'in-progress' }]);
  });

  it('writes a diary line naming the phase as well as the skill', async () => {
    // `break-down` is two phases and `in-progress` is stamped by two, so the skill alone does not say which
    // part of the machine a line came from.
    const r = recorder();
    await performAction(deps(r.client), BREAKDOWN(), context);
    const line = r.diary.find((d) => d.kind === 'run')?.text ?? '';
    expect(line).toContain('F-001');
    expect(line).toContain('break-down');
    expect(line).toContain('feature-breakdown');
    expect(line).toContain('iteration 4'.replace('iteration', 'Iteration'));
  });

  it('appends what the agent said about its own work', async () => {
    const r = recorder({ settle: [record({ summary: 'split it into two stories' })] });
    await performAction(deps(r.client), IMPLEMENT(), context);
    expect(r.diary.find((d) => d.kind === 'run')?.text).toContain('split it into two stories');
  });

  it('burns nothing and moves nothing on exit when the run was cancelled', async () => {
    // An ending nobody is answerable for. The entry stamp already happened, but the card does not advance:
    // the work never happened, and `burnsAttempt` is false so the next tick tries again.
    const r = recorder({ settle: [record({ status: 'cancelled' })] });
    const result = await performAction(deps(r.client), IMPLEMENT(), context);
    expect(result.dispatches).toBe(1);
    expect(r.moves).toEqual([{ card: 'E-001', to: 'in-progress' }]);
    expect(r.diary.some((d) => d.text.includes('no attempt was used'))).toBe(true);
  });

  // THE BUG THIS COUNT EXISTS FOR: a dispatch that happened and then failed to move its card was reported as
  // no dispatch at all, so neither cap was told about a real agent run, the tick counted as idle, and the next
  // tick re-picked the same card and dispatched over work that had already passed — three times over.
  it('reports a dispatch that happened even when the stamp after it was refused', async () => {
    // THE STORY'S IMPLEMENT AND NOT ITS FIX, since the fix stamps no column at all: with that action this
    // test passed with no move ever attempted, which is a test that cannot fail for its own reason.
    //
    // THE TASK STARTS WHERE THE DISPATCH WANTS IT, so the stamp that is refused is the one AFTER the run —
    // every move in this recorder is refused, and with the task in `backlog` the refusal would land before
    // anything was dispatched and `dispatches` would be 0 for the honest reason.
    const r = recorder({ move: { ok: false, reason: 'refused with 409', fatal: false } });
    const claimed = { ...CARD(), columnSlug: 'in-progress' };
    const result = await performAction(deps(r.client), IMPLEMENT(STORY(), [claimed]), context);
    expect(result.dispatches).toBe(1);
  });

  it('stops the loop when a commit fails, before anything is spent', async () => {
    const r = recorder();
    const result = await performAction(
      deps(r.client, { commit: async () => ({ committed: false, reason: 'the tree is dirty' }) }),
      IMPLEMENT(),
      context,
    );
    expect(result.stop?.reason).toBe('stalled');
    expect(result.stop?.detail).toContain('the tree is dirty');
    expect(r.requests).toEqual([]);
    expect(r.moves).toEqual([]);
  });

  it('carries on when the tree was clean — that is not a failure', async () => {
    const r = recorder();
    const result = await performAction(
      deps(r.client, { commit: async () => ({ committed: false }) }),
      IMPLEMENT(),
      context,
    );
    expect(result.stop).toBeUndefined();
    expect(result.dispatches).toBe(1);
  });

  it('hands the fix run the run carrying the findings, rather than telling it to look', async () => {
    const r = recorder();
    await performAction(
      deps(r.client),
      { kind: 'dispatch', phase: 'story-fix', skill: 'fix', card: STORY(), previous: 'IMPL-1' },
      context,
    );
    expect(r.requests[0]).toMatchObject({ skill: 'fix', previous: 'IMPL-1' });
  });

  it('stops rather than dispatching when the entry stamp is refused fatally', async () => {
    // Nothing has been spent yet, and a run whose entry columns could not be stamped is one whose cards are
    // not where the machine believes they are — which for a story's implement is also the only thing that
    // tells the run which tasks are its own.
    const r = recorder({ move: { ok: false, reason: 'refused with 401', fatal: true } });
    const result = await performAction(deps(r.client), IMPLEMENT(), context);
    expect(result.stop?.reason).toBe('stalled');
    expect(r.requests).toEqual([]);
  });
});

describe('a stamp with no run behind it', () => {
  const SKIP: TickAction = {
    kind: 'stamp',
    phase: 'feature-breakdown-skip',
    card: CARD('F-001', 'features'),
    to: 'in-progress',
    why: 'it already has stories, so its break-down is skipped.',
  };

  it('moves the card through the endpoint and says why in the diary', async () => {
    const r = recorder();
    const result = await performAction(deps(r.client), SKIP, context);
    expect(result.dispatches).toBe(0);
    expect(r.moves).toEqual([{ card: 'F-001', to: 'in-progress' }]);
    expect(r.diary[0]?.kind).toBe('lifecycle');
    expect(r.diary[0]?.text).toContain('already has stories');
  });

  it('spends no dispatch and starts no run', async () => {
    const r = recorder();
    await performAction(deps(r.client), SKIP, context);
    expect(r.requests).toEqual([]);
  });

  it('does nothing at all for a wait', async () => {
    const r = recorder();
    expect(await performAction(deps(r.client), { kind: 'wait' }, context)).toEqual({ dispatches: 0 });
    expect(r.calls).toEqual([]);
  });

  it('stops the loop when a refusal is one it cannot recover from', async () => {
    const r = recorder({ move: { ok: false, reason: 'refused with 401', fatal: true } });
    expect((await performAction(deps(r.client), SKIP, context)).stop?.reason).toBe('stalled');
  });

  it('carries on past a refusal that might not happen again', async () => {
    const r = recorder({ move: { ok: false, reason: 'refused with 409: card is locked', fatal: false } });
    const result = await performAction(deps(r.client), SKIP, context);
    expect(result.stop).toBeUndefined();
    // And it says so where a person will see it, rather than only in a log nobody reads.
    expect(r.diary.some((d) => d.kind === 'note')).toBe(true);
  });
});

// A STORY'S ONE TASK, WRITTEN BY THE LOOP (decision 92): the create with its link, the diary line, then the move.
describe('a task the loop writes for a story', () => {
  const WRITE: TickAction = {
    kind: 'create',
    phase: 'story-task',
    card: CARD('P-001', 'product'),
    task: {
      board: 'engineering',
      column: 'backlog',
      title: 'Stay signed in',
      description: 'A session survives.',
      body: 'The whole of P-001.',
    },
    to: 'in-progress',
    why: 'auto-pilot wrote its one task from it, so it goes straight to its implement.',
  };

  it('creates the task linked to its story, says so, and then moves the story', async () => {
    const r = recorder();
    const result = await performAction(deps(r.client), WRITE, context);
    expect(result).toEqual({ dispatches: 0 });
    expect(r.created).toEqual([
      {
        board: 'engineering',
        columnSlug: 'backlog',
        title: 'Stay signed in',
        description: 'A session survives.',
        body: 'The whole of P-001.',
        links: ['P-001'],
      },
    ]);
    expect(r.diary[0]).toMatchObject({
      kind: 'lifecycle',
      text: 'F-099 written from P-001, as its one task.',
    });
    expect(r.moves).toEqual([{ card: 'P-001', to: 'in-progress' }]);
    expect(r.requests).toEqual([]);
  });

  // Refused, nothing is moved: a story moved on with no task under it would be handed to an implement with
  // nothing to do, and the next tick writes it again instead.
  it('moves nothing when the create is refused, and notes why', async () => {
    const r = recorder({ create: { ok: false, reason: 'refused with 409', fatal: false } });
    const result = await performAction(deps(r.client), WRITE, context);
    expect(result.stop).toBeUndefined();
    expect(r.moves).toEqual([]);
    expect(r.diary.some((d) => d.kind === 'note' && d.text.includes("could not write P-001's task"))).toBe(
      true,
    );
  });

  it('stops the loop when the refusal is one it cannot recover from', async () => {
    const r = recorder({ create: { ok: false, reason: 'refused with 401', fatal: true } });
    expect((await performAction(deps(r.client), WRITE, context)).stop?.reason).toBe('stalled');
  });
});
