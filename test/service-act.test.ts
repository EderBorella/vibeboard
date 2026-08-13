import { describe, expect, it } from 'vitest';
import type { TickAction } from '../src/core/actions.js';
import type { RunRecord, RunStatus } from '../src/core/runs.js';
import type { BoardName, Card } from '../src/core/types.js';
import type { Verification } from '../src/core/verify.js';
import { type ActDeps, performAction, reviewTask } from '../src/service/act.js';
import type { DispatchRequest } from '../src/service/board-client.js';

// One action, carried out, and this is where the phase table finally has an executor.
//
// Everything is injected: no agent is spawned, no project's test suite is run, no git repository is touched.
// What is under test is the ORDER and the CONDITIONS — commit before the entry stamp before the dispatch, the
// exit column stamped because the run COMPLETED rather than because it said it had, and a dispatch that
// happened counted even when what came after it broke.

const CARD = (id = 'E-001', board: BoardName = 'engineering'): Card => ({
  id,
  title: id,
  order: 10,
  tags: [],
  links: [],
  created: '2026-08-06',
  board,
  columnSlug: 'backlog',
  body: '',
  filePath: `/tmp/${id}.md`,
});

// A feature's break-down: the phase with BOTH stamps, which is what makes it the fixture for the order.
const BREAKDOWN = (card = CARD('F-001', 'features')): TickAction => ({
  kind: 'dispatch',
  phase: 'feature-breakdown',
  skill: 'break-down',
  card,
});

const IMPLEMENT = (card = CARD()): TickAction => ({
  kind: 'dispatch',
  phase: 'task-implement',
  skill: 'implement',
  card,
});

// The review phase. It carries the run it is judging, because a verdict lands on a run and there is nothing
// for one to be written onto otherwise — and it does NOT take the ordinary dispatch path at all: its gates run
// first, in this process (decision 51).
const REVIEW = (card = CARD()): TickAction => ({
  kind: 'dispatch',
  phase: 'task-review',
  skill: 'review',
  card,
  previous: 'IMPL-1',
});

// The phase with NO entry column that DOES take the ordinary path: a task being fixed is already in
// `in-progress`, so a move to where it is would be a write for nothing — and a diary line about an event that
// did not happen.
const FIX = (card = CARD()): TickAction => ({
  kind: 'dispatch',
  phase: 'task-fix',
  skill: 'fix',
  card,
  previous: 'IMPL-1',
});

const BOOTSTRAP: TickAction = { kind: 'dispatch', phase: 'bootstrap', skill: 'derive-features' };

let runCount = 0;
const record = (over: Partial<RunRecord> = {}): RunRecord => {
  runCount += 1;
  return {
    run: `2026-08-06T10-00-0${runCount}-abc`,
    card: 'E-001',
    board: 'engineering',
    skill: 'implement',
    status: 'success' as RunStatus,
    started: '2026-08-06T10:00:00Z',
    backend: 'test',
    model: 'test',
    effort: 'medium',
    mode: 'skill',
    report: '',
    ...over,
  };
};

const projectRun = (over: Partial<RunRecord> = {}): RunRecord =>
  record({ card: undefined, board: undefined, skill: 'derive-features', ...over });

// A recording client. Every call the loop can make, in the order it made them, so a test can assert that a
// commit happened BEFORE a stamp rather than merely that both happened.
function recorder(
  opts: {
    settle?: RunRecord[];
    dispatch?: { ok: false; reason: string; fatal: boolean };
    move?: { ok: false; reason: string; fatal: boolean };
    verdict?: { ok: false; reason: string; fatal: boolean };
    // What the board holds when it is read back — the bootstrap's only evidence that it worked, since cards
    // are created through the API and a run that made a dozen of them changes no files.
    boardCards?: Card[];
    // AND WHAT IT HELD BEFORE. A creating phase is judged on the board growing, so a fixture that answers the
    // same thing twice can only express "created nothing" — which is the failure case, not the ordinary one.
    boardBefore?: Card[];
    board?: { ok: false; reason: string; fatal: boolean };
    archive?: Card[];
    suggestions?: { id: string; title: string }[];
    flags?: { ok: false; reason: string; fatal: boolean };
  } = {},
) {
  const calls: string[] = [];
  // WHICH RUN each verdict landed on, not only what it said: a review verdict belongs on the run it judged
  // and never on the review run itself, and only the run id can tell those apart.
  const verdicts: (Verification & { run: string })[] = [];
  const moves: { card: string; to: string }[] = [];
  // The two frontmatter flags, which have their own route: the PATCH allow-list is what stops a work agent
  // flagging its own card, so the loop's stamp cannot go through it.
  const flags: { board: BoardName; card: string; body: Record<string, boolean> }[] = [];
  const diary: { kind: string; text: string }[] = [];
  const dispatched: string[] = [];
  // The requests themselves, not only the skill names: `previous` — which run a fix is addressing — is
  // carried on the request and nowhere else, so a test can only hold it here.
  const requests: DispatchRequest[] = [];
  // The real sequence: `POST /runs` answers with the record it just created, and the same record — same id —
  // is what `GET /runs/:board/:card` shows once it has settled. An earlier version of this fixture invented a
  // fresh id per call, so nothing the loop dispatched could ever be found again and every test failed on a
  // timeout rather than on its subject.
  let dispatchIndex = 0;
  const live: RunRecord[] = [];
  const client = {
    dispatch: async (input: DispatchRequest) => {
      calls.push(`dispatch:${input.skill}`);
      dispatched.push(input.skill);
      requests.push(input);
      if (opts.dispatch) return opts.dispatch;
      // ONE TEMPLATE PER DISPATCH, asserted rather than clamped: with fewer templates than dispatches two
      // records would share a run id and `settle`'s `find` would answer about the wrong one.
      const template = opts.settle?.[dispatchIndex];
      if (opts.settle && !template) {
        throw new Error(
          `the fixture has ${opts.settle.length} settle templates and this is dispatch ${dispatchIndex + 1}`,
        );
      }
      dispatchIndex += 1;
      const started = { ...(template ?? record()), skill: input.skill };
      live.push(started);
      return { ok: true as const, value: { run: started } };
    },
    cardRuns: async () => {
      calls.push('cardRuns');
      return { ok: true as const, value: { runs: live } };
    },
    // The project's whole list, which is where a run with no card is found. Answering from the same `live`
    // array as `cardRuns` on purpose: a fixture with two sources would let a test pass while the code looked
    // in the wrong one.
    runs: async () => {
      calls.push('runs');
      return { ok: true as const, value: { runs: live } };
    },
    board: async () => {
      calls.push('board');
      if (opts.board) return opts.board;
      // The FIRST read answers `boardBefore` where a test supplied one, every later read `boardCards`. That
      // is the whole of "a card appeared while the run was going".
      const reads = calls.filter((c) => c === 'board').length;
      const showing = reads === 1 && opts.boardBefore ? opts.boardBefore : (opts.boardCards ?? []);
      const boards = { features: [], product: [], engineering: [] } as Record<BoardName, Card[]>;
      for (const card of showing) boards[card.board].push(card);
      return {
        ok: true as const,
        value: { config: { boards: {} } as never, boards, problems: [] },
      };
    },
    move: async (_board: BoardName, card: string, to: string) => {
      calls.push(`move:${to}`);
      moves.push({ card, to });
      return opts.move ?? { ok: true as const, value: {} };
    },
    verdict: async (_b: BoardName, _c: string, run: string, verification: Verification) => {
      calls.push(`verdict:${run}`);
      verdicts.push({ ...verification, run });
      return opts.verdict ?? { ok: true as const, value: {} };
    },
    log: async (kind: string, text: string) => {
      calls.push(`log:${kind}`);
      diary.push({ kind, text });
      return { ok: true as const, value: {} };
    },
    suggestions: async () => {
      calls.push('suggestions');
      return { ok: true as const, value: { suggestions: opts.suggestions ?? [] } };
    },
    archive: async (board: BoardName) => {
      calls.push(`archive:${board}`);
      return { ok: true as const, value: { cards: (opts.archive ?? []).filter((c) => c.board === board) } };
    },
    flags: async (board: BoardName, card: string, body: Record<string, boolean>) => {
      calls.push(`flags:${card}`);
      flags.push({ board, card, body });
      return opts.flags ?? { ok: true as const, value: {} };
    },
  };
  return { client, calls, verdicts, moves, diary, dispatched, requests, flags };
}

const commits: { root: string; message: string; branch?: string }[] = [];

function deps(
  client: ReturnType<typeof recorder>['client'] | ActDeps['client'],
  over: Partial<ActDeps> = {},
): ActDeps {
  return {
    client: client as unknown as ActDeps['client'],
    root: '/tmp/project',
    branch: 'autopilot/2026-08-06',
    now: () => new Date('2026-08-06T10:05:00Z'),
    // Nothing unreviewed by default. Injected as a READER rather than a value because the refusal below is
    // about the state at the moment the commands would run, not at the moment the loop was built.
    state: async () => ({ unreviewedGates: [] }),
    // Records what it was asked to commit. Ignoring the arguments meant `deps.root` and `deps.branch` could
    // both be wrong and the whole suite still passed — so the promise that a commit cannot land on someone
    // else's branch under an agent's message was held by nothing.
    commit: async (root: string, message: string, opts?: { branch?: string }) => {
      commits.push({ root, message, branch: opts?.branch });
      return { committed: true };
    },
    // One check, no waiting: the record is already settled in these fixtures. `settle`'s own bound is tested
    // where it belongs, and a poll of zero used to make it spin for ever — which is how that was found.
    settlePollMs: 1,
    settleTimeoutMs: 0,
    sleep: async () => undefined,
    ...over,
  } as ActDeps;
}

const context = { iteration: 3, columns: {} as Record<BoardName, string[]> };

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

  it('stamps nothing on entry for a phase with no entry column', async () => {
    // A task being fixed is already in `in-progress`; a move to where it is would be a write for nothing — and
    // a diary line about an event that did not happen. Asserted through the ORDER, because the phase does have
    // an EXIT column and `moves` being non-empty afterwards is correct.
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
    expect(order).toEqual(['commit', 'dispatch', 'move:review']);
  });

  it('commits the run’s own tree, on the run’s own branch', async () => {
    commits.length = 0;
    const r = recorder();
    await performAction(deps(r.client), IMPLEMENT(), context);
    expect(commits[0]).toMatchObject({ root: '/tmp/project', branch: 'autopilot/2026-08-06' });
    expect(commits[0]?.message).toContain('E-001');
    expect(commits[0]?.message).toContain('implement');
    expect(commits[0]?.message).toContain('iteration 4');
  });

  it('stamps the exit column through the endpoint once the run completes', async () => {
    const r = recorder();
    const result = await performAction(deps(r.client), IMPLEMENT(), context);
    expect(result.dispatches).toBe(1);
    expect(r.moves).toEqual([
      { card: 'E-001', to: 'in-progress' },
      { card: 'E-001', to: 'review' },
    ]);
  });

  // DECISION 40. The loop reads its own record of how the run ended — `status`, which the runner assigns —
  // and never the `outcome` the agent wrote about itself. A run that finished saying it could not do the work
  // still goes to review, where the gates and the reviewer judge it.
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
    const r = recorder({ move: { ok: false, reason: 'refused with 409', fatal: false } });
    const result = await performAction(deps(r.client), FIX(), context);
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
      { kind: 'dispatch', phase: 'task-fix', skill: 'fix', card: CARD(), previous: 'IMPL-1' },
      context,
    );
    expect(r.requests[0]).toMatchObject({ skill: 'fix', previous: 'IMPL-1' });
  });

  it('stops rather than dispatching when the entry stamp is refused fatally', async () => {
    // Nothing has been spent yet, and a phase whose entry column could not be stamped is one whose card is
    // not where the machine believes it is.
    const r = recorder({ move: { ok: false, reason: 'refused with 401', fatal: true } });
    const result = await performAction(deps(r.client), IMPLEMENT(), context);
    expect(result.stop?.reason).toBe('stalled');
    expect(r.requests).toEqual([]);
  });
});

describe('waiting for a run to settle', () => {
  const never = (polls: { n: number }) =>
    ({
      dispatch: async () => ({ ok: true as const, value: { run: record() } }),
      cardRuns: async () => {
        polls.n += 1;
        return { ok: true as const, value: { runs: [] } };
      },
      move: async () => ({ ok: true as const, value: {} }),
      log: async () => ({ ok: true as const, value: {} }),
    }) as unknown as ActDeps['client'];

  // The poll interval is large in the first two cases on purpose: an infinite patience is clamped to a day, so
  // with a one-millisecond interval the bound is a hundred thousand polls — correct, and far too slow to watch.
  // A large interval makes the same clamp observable in four.
  it.each([
    ['an infinite patience', { settleTimeoutMs: Number.POSITIVE_INFINITY, settlePollMs: 1_000_000 }],
    ['a patience that is not a number', { settleTimeoutMs: Number.NaN, settlePollMs: 1_000_000 }],
    ['a poll interval that is not a number', { settleTimeoutMs: 10, settlePollMs: Number.NaN }],
    ['a poll interval of zero', { settleTimeoutMs: 10, settlePollMs: 0 }],
    ['a negative patience', { settleTimeoutMs: -1, settlePollMs: 1 }],
  ])('gives up rather than spinning, given %s', async (_name, timing) => {
    const polls = { n: 0 };
    const result = await performAction(
      // A real macrotask, so a bound that has gone fails on vitest's timeout instead of starving it: a
      // microtask-only sleep spins without ever letting a `setTimeout` fire, and the suite hangs.
      deps(never(polls), { ...timing, sleep: () => new Promise((r) => setTimeout(r, 0)) }),
      IMPLEMENT(),
      context,
    );
    // It ends, it says why, and it looked at least once — a bound that answers zero polls is a dispatch
    // nobody ever checked on.
    expect(result.stop?.reason).toBe('stalled');
    expect(result.stop?.detail).toContain('did not finish');
    expect(polls.n).toBeGreaterThan(0);
    // Small, because every one of these is an absurd input clamped to something sane — not merely finite.
    expect(polls.n).toBeLessThanOrEqual(20);
  });

  it('keeps asking while the run is still going', async () => {
    // The polling half was unreached once: the fixture always answered already-settled, so accepting a
    // `running` record as finished changed no test — and a card would then advance over work in progress.
    const settledRun = record({ status: 'success' });
    let look = 0;
    const client = {
      dispatch: async () => ({ ok: true as const, value: { run: settledRun } }),
      cardRuns: async () => {
        look += 1;
        return {
          ok: true as const,
          value: {
            runs: [{ ...settledRun, status: look < 3 ? ('running' as const) : ('success' as const) }],
          },
        };
      },
      verdict: async () => ({ ok: true as const, value: {} }),
      move: async () => ({ ok: true as const, value: {} }),
      log: async () => ({ ok: true as const, value: {} }),
    } as unknown as ActDeps['client'];
    const result = await performAction(
      deps(client, {
        settlePollMs: 1,
        settleTimeoutMs: 1000,
        sleep: () => new Promise((r) => setTimeout(r, 0)),
      }),
      IMPLEMENT(),
      context,
    );
    expect(look).toBe(3);
    expect(result.stop).toBeUndefined();
    expect(result.dispatches).toBe(1);
  });
});

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

  it('advances a failed run that changed files, because it may have done real work', async () => {
    const r = recorder({ settle: [empty({ filesChanged: 3 })] });
    await performAction(deps(r.client), IMPLEMENT(), context);
    expect(r.moves.at(-1)).toEqual({ card: 'E-001', to: 'review' });
    expect(r.verdicts).toEqual([]);
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

  it('advances when the file count could not be taken at all', async () => {
    // Absent is not zero: a measurement that could not be taken says nothing about what changed.
    const r = recorder({ settle: [record({ status: 'failed', outcome: undefined })] });
    await performAction(deps(r.client), IMPLEMENT(), context);
    expect(r.moves.at(-1)).toEqual({ card: 'E-001', to: 'review' });
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

// THE BOOTSTRAP: the one dispatch about the PROJECT rather than about a card, and therefore the one with no
// stamps and no verdict.
describe('deriving an empty board', () => {
  it('dispatches with no card at all, and says so rather than naming one', async () => {
    // The whole point: `card` and `board` absent, `project` true. A request that named a card would be the
    // trigger-card workaround this replaces, and the run record would land beside a card that does not exist.
    const r = recorder({ settle: [projectRun()] });
    const result = await performAction(deps(r.client), BOOTSTRAP, context);
    expect(result.dispatches).toBe(1);
    expect(r.requests).toEqual([{ project: true, skill: 'derive-features' }]);
  });

  it('carries a project run out with no stamps at all', async () => {
    const r = recorder({ settle: [projectRun()] });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.moves).toEqual([]);
    expect(r.verdicts).toEqual([]);
  });

  it('commits before it dispatches, exactly as a card dispatch does', async () => {
    // Rule 1 is not about cards: from the moment the agent starts writing, a commit first is what makes any of
    // it one command from gone.
    const order: string[] = [];
    const r = recorder({ settle: [projectRun()] });
    const original = r.client.dispatch;
    r.client.dispatch = async (input) => {
      order.push('dispatch');
      return original(input);
    };
    await performAction(
      deps(r.client, {
        commit: async () => {
          order.push('commit');
          return { committed: true };
        },
      }),
      BOOTSTRAP,
      context,
    );
    expect(order).toEqual(['commit', 'dispatch']);
  });

  it('stops the loop when that commit fails', async () => {
    const r = recorder({ settle: [projectRun()] });
    const result = await performAction(
      deps(r.client, { commit: async () => ({ committed: false, reason: 'the tree is dirty' }) }),
      BOOTSTRAP,
      context,
    );
    expect(result.stop?.reason).toBe('stalled');
    expect(result.stop?.detail).toContain('the tree is dirty');
    expect(r.requests).toEqual([]);
  });

  it('watches the PROJECT list for its ending, not a card route', async () => {
    // A project run has no card in its path, so `GET /runs/:board/:card` cannot find it. Asserted through the
    // calls rather than by mocking one away: pointed at the card route the run never settles and the loop
    // reports a timeout, which reads as a broken agent rather than as looking in the wrong place.
    const r = recorder({ settle: [projectRun()] });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.calls).toContain('runs');
    expect(r.calls).not.toContain('cardRuns');
  });

  it('reports what the board holds afterwards, which is the only evidence there is', async () => {
    // NOT the run's own outcome (decision 40), and not files changed: cards are created through the API, so a
    // bootstrap that worked perfectly changes nothing on disk.
    const r = recorder({
      settle: [projectRun({ summary: 'Derived four features' })],
      boardCards: [CARD('F-001', 'features'), CARD('F-002', 'features')],
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    const line = r.diary.find((d) => d.kind === 'run')?.text ?? '';
    expect(line).toContain('the board now has 2 cards');
    expect(line).toContain('Derived four features');
  });

  it('says the board is still empty when nothing was created, and does not stop the loop', async () => {
    // The attempt is burned by the record itself and `decideTick` counts it — one cap, in one place. A stop
    // here would be a second opinion about when to give up.
    const r = recorder({ settle: [projectRun({ status: 'attention' })] });
    const result = await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.diary.find((d) => d.kind === 'run')?.text).toContain('the board is still empty');
    expect(result.stop).toBeUndefined();
    expect(result.dispatches).toBe(1);
  });

  it('does not claim the board is empty when it could not be read', async () => {
    // "Created no cards" is a verdict; a failed read is not evidence for it.
    const r = recorder({
      settle: [projectRun()],
      board: { ok: false, reason: 'could not reach the board', fatal: false },
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    const line = r.diary.find((d) => d.kind === 'run')?.text ?? '';
    expect(line).toContain('unknown');
    expect(line).not.toContain('still empty');
  });

  it('stops when the derivation never finishes', async () => {
    const r = recorder({ settle: [projectRun({ status: 'running' })] });
    const result = await performAction(deps(r.client), BOOTSTRAP, context);
    expect(result.stop?.reason).toBe('stalled');
    expect(result.stop?.detail).toContain('did not finish');
  });

  it('reports a refused dispatch rather than pretending it ran', async () => {
    const r = recorder({ dispatch: { ok: false, reason: 'refused with 403', fatal: false } });
    const result = await performAction(deps(r.client), BOOTSTRAP, context);
    expect(result.dispatches).toBe(0);
    expect(r.diary.some((d) => d.kind === 'note' && d.text.includes('403'))).toBe(true);
  });
});

// THE REVIEW PHASE: deterministic first (decision 51). The loop runs the gates in its OWN process, and a
// model is dispatched only for what a command's exit code cannot express — does this do what the card asked.
//
// A gate is a command with an exit code, which is the most deterministic thing in this design; handing it to
// an agent would make a settled fact a judgement.
describe('the review phase', () => {
  const gatesPass = async (): Promise<Verification> => ({ mode: 'gates', passed: true, at: 'T' });
  const gatesFail = async (): Promise<Verification> => ({
    mode: 'gates',
    passed: false,
    at: 'T',
    command: 'npm test',
    output: 'Tests  1 failed | 40 passed',
    reason: '`npm test` exited with 1.',
  });
  // NO COMMAND, because none was run: an absent, empty or unparseable gate set (core/verify.ts). That is the
  // shape the setup exception recognises, and the only shape it recognises.
  const noGates = async (): Promise<Verification> => ({
    mode: 'gates',
    passed: false,
    at: 'T',
    reason: 'foundation/CODE-QUALITY.md declares no gates.',
  });

  const smoke = async (): Promise<Verification> => ({ mode: 'smoke', passed: true, at: 'T' });

  // Records whether a gate command was even attempted. `ran` empty is a different claim from "the gates
  // failed", and it is the claim the security refusal makes.
  const watching = (gates: () => Promise<Verification>, ran: string[]) => ({
    gates: async (...args: unknown[]) => {
      ran.push('gates');
      void args;
      return await gates();
    },
    smoke,
  });

  const reviewRun = (over: Partial<RunRecord> = {}): RunRecord =>
    record({ run: 'REV-1', skill: 'review', status: 'success', outcome: 'success', ...over });

  // THE SECURITY GATE, first because it is the one that must never regress. Running the gates BEFORE a
  // dispatch takes `POST /api/runs`'s refusal out from in front of them, and that refusal was the only thing
  // between an agent-rewritten gate document and its commands running unsandboxed as the server's user.
  it('runs NO gate command while a gate document is unreviewed, and stops saying so', async () => {
    const ran: string[] = [];
    const r = recorder();
    const result = await reviewTask(
      deps(r.client, {
        state: async () => ({ unreviewedGates: ['CODE-QUALITY.md'] }),
        verify: watching(gatesPass, ran) as unknown as ActDeps['verify'],
      }),
      CARD(),
      'IMPL-1',
      {},
      context,
    );
    // NOT "it failed" — it never ran.
    expect(ran).toEqual([]);
    expect(result.stop?.reason).toBe('stalled');
    expect(result.stop?.detail).toContain('I have read the gate commands');
    expect(r.requests).toHaveLength(0);
    expect(r.moves).toEqual([]);
    expect(r.verdicts).toEqual([]);
  });

  it('runs the gates when nothing is unreviewed', async () => {
    const ran: string[] = [];
    const r = recorder({ settle: [reviewRun({ verdict: 'done' })] });
    const result = await reviewTask(
      deps(r.client, { verify: watching(gatesPass, ran) as unknown as ActDeps['verify'] }),
      CARD(),
      'IMPL-1',
      {},
      context,
    );
    expect(ran).toEqual(['gates']);
    expect(result.stop).toBeUndefined();
  });

  it('sends a task back with the command’s own output when a gate fails, dispatching nothing', async () => {
    const r = recorder();
    const result = await reviewTask(
      deps(r.client, { verify: { gates: gatesFail, smoke } as unknown as ActDeps['verify'] }),
      CARD(),
      'IMPL-1',
      {},
      context,
    );
    // No model, no tokens, no iteration.
    expect(r.requests).toHaveLength(0);
    expect(result.dispatches).toBe(0);
    expect(r.verdicts[0]).toMatchObject({ run: 'IMPL-1', mode: 'gates', passed: false, command: 'npm test' });
    expect(r.verdicts[0]?.output).toContain('1 failed');
    expect(r.moves).toEqual([{ card: 'E-001', to: 'in-progress' }]);
    // And the diary carries the command, so a person reads why without opening a run record.
    expect(r.diary.find((d) => d.kind === 'run')?.text).toContain('npm test');
  });

  it('dispatches a review run only when the gates pass', async () => {
    const r = recorder({ settle: [reviewRun({ verdict: 'done' })] });
    await reviewTask(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      CARD(),
      'IMPL-1',
      {},
      context,
    );
    expect(r.requests[0]).toMatchObject({ skill: 'review', card: 'E-001', previous: 'IMPL-1' });
  });

  // FAIL CLOSED (decision 3). Seven of the design review's findings were this one bug, and every one ended
  // with auto-pilot reporting success over work that never happened.
  it('fails a task whose project declares no gates', async () => {
    const r = recorder();
    await reviewTask(
      deps(r.client, { verify: { gates: noGates, smoke } as unknown as ActDeps['verify'] }),
      CARD(),
      'IMPL-1',
      {},
      context,
    );
    expect(r.verdicts[0]).toMatchObject({ mode: 'gates', passed: false });
    expect(r.requests).toHaveLength(0);
  });

  // THE ONE NARROW EXCEPTION, narrow in two ways at once: only in the setup subtree, and only for a gate set
  // that is ABSENT. Installing the test runner is what that card is for.
  it('reviews a setup-subtree card whose gate set is absent, by reading', async () => {
    const r = recorder({ settle: [reviewRun({ verdict: 'done' })] });
    await reviewTask(
      deps(r.client, { verify: { gates: noGates, smoke } as unknown as ActDeps['verify'] }),
      CARD(),
      'IMPL-1',
      { setupSubtree: true },
      context,
    );
    expect(r.requests[0]).toMatchObject({ skill: 'review' });
    expect(r.verdicts[0]).toMatchObject({ mode: 'review' });
  });

  it('still sends a setup-subtree card back when a gate EXISTS and fails', async () => {
    // Absent is expected; failing is not. A runner that is installed and red is a different fact.
    const r = recorder();
    await reviewTask(
      deps(r.client, { verify: { gates: gatesFail, smoke } as unknown as ActDeps['verify'] }),
      CARD(),
      'IMPL-1',
      { setupSubtree: true },
      context,
    );
    expect(r.requests).toHaveLength(0);
    expect(r.verdicts[0]).toMatchObject({ mode: 'gates', passed: false });
  });

  it('passes the gate result and the setup subtree through to the prompt', async () => {
    // Task 11's field, and this is its producer. Read off the dispatch the client received, because that is
    // the only carrier there is.
    const r = recorder({ settle: [reviewRun({ verdict: 'done' })] });
    await reviewTask(
      deps(r.client, { verify: { gates: noGates, smoke } as unknown as ActDeps['verify'] }),
      CARD(),
      'IMPL-1',
      { setupSubtree: true },
      context,
    );
    expect(r.requests[0]?.review).toEqual({ gatesPassed: true, setupSubtree: true });
  });

  it('writes the review verdict onto the run it judged, never onto the review run', async () => {
    const r = recorder({ settle: [reviewRun({ verdict: 'done', summary: 'does what the card asked' })] });
    await reviewTask(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      CARD(),
      'IMPL-1',
      {},
      context,
    );
    expect(r.verdicts).toHaveLength(1);
    expect(r.verdicts[0]).toMatchObject({ run: 'IMPL-1', mode: 'review', passed: true, by: 'REV-1' });
    // The findings travel with the verdict: a `fix` run is handed this, not told to go and look.
    expect(r.verdicts[0]?.reason).toContain('does what the card asked');
    expect(r.moves).toEqual([{ card: 'E-001', to: 'done' }]);
  });

  it('sends a task back on a sent-back verdict', async () => {
    const r = recorder({ settle: [reviewRun({ verdict: 'sent-back', summary: 'the flag is not parsed' })] });
    await reviewTask(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      CARD(),
      'IMPL-1',
      {},
      context,
    );
    expect(r.verdicts[0]).toMatchObject({ mode: 'review', passed: false, by: 'REV-1' });
    expect(r.moves).toEqual([{ card: 'E-001', to: 'in-progress' }]);
  });

  // RULE 2 (act.ts): `outcome` is what the agent said about its own turn. A review whose turn went perfectly
  // and which decided nothing has not passed anything.
  it('advances a task only on the verdict, never on the review run’s own outcome', async () => {
    const r = recorder({ settle: [reviewRun({ outcome: 'success', verdict: undefined })] });
    const result = await reviewTask(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      CARD(),
      'IMPL-1',
      {},
      context,
    );
    expect(r.verdicts).toEqual([]);
    expect(r.moves).toEqual([]);
    // The dispatch still counts, and the tick's own bound over inconclusive reviews is what gives up.
    expect(result.dispatches).toBe(1);
  });

  it('counts the review dispatch against the caps', async () => {
    // Decision 8: everything a model does counts. A boolean here let every judged card cost one iteration
    // instead of two.
    const r = recorder({ settle: [reviewRun({ verdict: 'done' })] });
    const result = await reviewTask(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      CARD(),
      'IMPL-1',
      {},
      context,
    );
    expect(result.dispatches).toBe(1);
  });

  it('leaves the task in review and burns no move when the review run does not settle', async () => {
    const r = recorder({ settle: [reviewRun({ status: 'running' })] });
    const result = await reviewTask(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      CARD(),
      'IMPL-1',
      {},
      context,
    );
    expect(result.stop?.reason).toBe('stalled');
    expect(r.moves).toEqual([]);
    expect(r.verdicts).toEqual([]);
  });

  // THE WIRING, through the executor rather than the function: a `task-review` dispatch must not go down the
  // ordinary path, which would spend a model before anything deterministic had run.
  it('carries a task-review action out through the gates, not through an ordinary dispatch', async () => {
    const ran: string[] = [];
    const r = recorder();
    const result = await performAction(
      deps(r.client, { verify: watching(gatesFail, ran) as unknown as ActDeps['verify'] }),
      REVIEW(),
      context,
    );
    expect(ran).toEqual(['gates']);
    expect(r.requests).toHaveLength(0);
    expect(result.dispatches).toBe(0);
  });

  // WHO DECIDES the setup subtree: the loop, off the board it can already read. A `work` credential could not
  // be asked for it, and being told by the card would make the exception something a card could claim.
  it('reads the setup subtree off the board rather than being told', async () => {
    const feature = { ...CARD('F-001', 'features'), setup: true, links: ['P-001'] };
    const story = { ...CARD('P-001', 'product'), links: ['E-001'] };
    const r = recorder({
      settle: [reviewRun({ verdict: 'done' })],
      boardCards: [feature, story, CARD()],
    });
    await performAction(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      REVIEW(),
      context,
    );
    expect(r.requests[0]?.review).toEqual({ gatesPassed: true, setupSubtree: true });
  });

  it('treats a board it could not read as outside the setup subtree, which fails closed', async () => {
    // Being wrong the other way excuses an absent gate set for a card nobody chose.
    const r = recorder({
      settle: [reviewRun({ verdict: 'done' })],
      board: { ok: false, reason: 'could not reach the board', fatal: false },
    });
    await performAction(
      deps(r.client, { verify: { gates: gatesPass, smoke } as unknown as ActDeps['verify'] }),
      REVIEW(),
      context,
    );
    expect(r.requests[0]?.review).toEqual({ gatesPassed: true, setupSubtree: false });
  });
});

// THE BOOTSTRAP'S EXIT (decision 44, corrected). `setup: true` fires here and at NO other time.
//
// The first draft made it a board predicate — "cards exist and none is flagged" — which would stamp it on any
// project whose first feature a person added by hand. That was harmless while the flag only ordered work; under
// decision 51 it is what makes an ABSENT GATE SET EXPECTED instead of a failure, so auto-stamping would switch
// off a fail-closed check for a subtree nobody chose.
describe('the scaffolding stamp', () => {
  const feature = (id: string, columnSlug = 'backlog', order = 10): Card => ({
    ...CARD(id, 'features'),
    columnSlug,
    order,
  });

  it('stamps setup on the first backlog feature after a bootstrap run', async () => {
    const r = recorder({
      settle: [projectRun()],
      boardBefore: [],
      boardCards: [feature('F-001'), feature('F-002', 'backlog', 20)],
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.flags).toEqual([{ board: 'features', card: 'F-001', body: { setup: true } }]);
    // And it says which card it chose, because a flag nobody recorded is a rule nobody can check afterwards.
    expect(r.diary.some((d) => d.kind === 'lifecycle' && d.text.includes('F-001'))).toBe(true);
  });

  it('picks the first feature by the endpoint-assigned order, not by the run’s created list', async () => {
    // FINDING F: the run reports `created: ['F-005']`, the board says F-001 is first. `RunRecord.created` is
    // frontmatter the agent wrote about itself; `order` is what the endpoint assigned.
    const r = recorder({
      settle: [projectRun({ created: ['F-005', 'F-001'] })],
      boardBefore: [],
      boardCards: [feature('F-005', 'backlog', 50), feature('F-001', 'backlog', 10)],
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.flags[0]?.card).toBe('F-001');
  });

  it('breaks an equal order by id, so the choice is at least deterministic', async () => {
    const r = recorder({
      settle: [projectRun()],
      boardBefore: [],
      boardCards: [feature('F-005', 'backlog', 10), feature('F-002', 'backlog', 10)],
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.flags[0]?.card).toBe('F-002');
  });

  it('ignores a feature that is not in backlog', async () => {
    // The derivation puts every feature in `features/backlog`; anything elsewhere was moved by a person, and
    // the scaffolding is the first of what this run produced.
    const r = recorder({
      settle: [projectRun()],
      boardBefore: [],
      boardCards: [feature('F-000', 'in-progress', 5), feature('F-001', 'backlog', 10)],
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.flags[0]?.card).toBe('F-001');
  });

  it('stamps nothing when the bootstrap created no card', async () => {
    const r = recorder({ settle: [projectRun()], boardBefore: [], boardCards: [] });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.flags).toEqual([]);
  });

  it('stamps nothing when a card already carries setup', async () => {
    const r = recorder({
      settle: [projectRun()],
      boardBefore: [],
      boardCards: [{ ...feature('F-001'), setup: true }, feature('F-002', 'backlog', 20)],
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.flags).toEqual([]);
  });

  it('stamps nothing when the only flagged feature has been ARCHIVED', async () => {
    // "Once" is a board fact (decision 50), and an archived card is still a fact about this board. The live
    // board alone cannot answer it, which is why the archive is read.
    const r = recorder({
      settle: [projectRun()],
      boardBefore: [],
      boardCards: [feature('F-009')],
      archive: [{ ...feature('F-001', 'archive'), setup: true, archived: '2026-08-13T00:00:00Z' }],
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.flags).toEqual([]);
  });

  it('never stamps outside a bootstrap exit', async () => {
    // THE CORRECTION. A break-down exit on a board of unflagged features must not acquire the flag.
    const r = recorder({ boardBefore: [], boardCards: [feature('F-001'), CARD('P-001', 'product')] });
    await performAction(deps(r.client), BREAKDOWN(), context);
    expect(r.flags).toEqual([]);
  });

  it('carries on when the flag could not be written, rather than stopping the loop', async () => {
    // The stamp is the exit of a run that has already happened. Losing it costs an ordering fact; stopping
    // costs the project.
    const r = recorder({
      settle: [projectRun()],
      boardBefore: [],
      boardCards: [feature('F-001')],
      flags: { ok: false, reason: 'refused with 409', fatal: false },
    });
    const result = await performAction(deps(r.client), BOOTSTRAP, context);
    expect(result.stop).toBeUndefined();
    expect(result.dispatches).toBe(1);
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
    // refuse every close.
    const story = CARD('P-001', 'product');
    const r = recorder({ boardBefore: [story], boardCards: [story] });
    await performAction(
      deps(r.client),
      { kind: 'dispatch', phase: 'story-checkup', skill: 'checkup-story', card: story },
      context,
    );
    expect(r.verdicts).toEqual([]);
    expect(r.moves).toEqual([{ card: 'P-001', to: 'done' }]);
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

  it('closes a STORY checkup that created siblings, because closing and creating are one act', async () => {
    // Ruling 54: leaving the story open while its new siblings are worked would mean two open stories, which
    // is the one invariant the derived position cannot survive.
    const r = recorder({ boardBefore: [story], boardCards: [story, CARD('P-002', 'product')] });
    await performAction(
      deps(r.client),
      { kind: 'dispatch', phase: 'story-checkup', skill: 'checkup-story', card: story },
      context,
    );
    expect(r.moves).toEqual([{ card: 'P-001', to: 'done' }]);
  });
});

// THE CHECKUP'S EVIDENCE, GATHERED BY THE LOOP (ruling 60). Every card run is minted `work` scope, and three of
// the four facts a checkup needs are unreachable from it. Widening the scope table would grant an agent
// authority to solve a problem the loop can solve — and the loop already holds every one of them.
describe('a checkup’s evidence', () => {
  const smokePass = async (): Promise<Verification> => ({
    mode: 'smoke',
    passed: true,
    at: 'T',
  });
  const smokeFail = async (): Promise<Verification> => ({
    mode: 'smoke',
    passed: false,
    at: 'T',
    command: 'npm run smoke',
    output: 'exited 1',
    reason: '`npm run smoke` exited with 1.',
  });
  const gates = async (): Promise<Verification> => ({ mode: 'gates', passed: true, at: 'T' });

  const verify = (smoke: () => Promise<Verification>) => ({ gates, smoke }) as unknown as ActDeps['verify'];

  // F-001 → P-001, P-002. P-001 → E-001 (blocked). Two stories, so "all of them" can be told from "one of
  // them", and a blocked grandchild so `blockedUnder` has something to find two levels down.
  const feature = { ...CARD('F-001', 'features'), columnSlug: 'in-progress', links: ['P-001', 'P-002'] };
  const story = { ...CARD('P-001', 'product'), columnSlug: 'done', links: ['E-001'] };
  const story2 = { ...CARD('P-002', 'product'), columnSlug: 'done', links: [] };
  const task = { ...CARD('E-001', 'engineering'), columnSlug: 'blocked' };

  const FEATURE_CHECKUP: TickAction = {
    kind: 'dispatch',
    phase: 'feature-checkup',
    skill: 'checkup-feature',
    card: feature,
  };
  const STORY_CHECKUP: TickAction = {
    kind: 'dispatch',
    phase: 'story-checkup',
    skill: 'checkup-story',
    card: story,
  };

  const board = () => [feature, story, story2, task];

  it('runs the smoke command before dispatching checkup-feature, and hands the result over', async () => {
    const order: string[] = [];
    const r = recorder({ boardCards: board() });
    const original = r.client.dispatch;
    r.client.dispatch = async (input) => {
      order.push('dispatch');
      return original(input);
    };
    await performAction(
      deps(r.client, {
        verify: {
          gates,
          smoke: async () => {
            order.push('smoke');
            return await smokePass();
          },
        } as unknown as ActDeps['verify'],
      }),
      FEATURE_CHECKUP,
      context,
    );
    expect(order).toEqual(['smoke', 'dispatch']);
    expect(r.requests[0]?.checkup?.smoke).toMatchObject({ mode: 'smoke', passed: true });
  });

  it('does not run the smoke command for a story checkup', async () => {
    // A story has no end-to-end command of its own; the one `foundation/TESTING.md` declares is the feature's.
    let ran = 0;
    const r = recorder({ boardCards: board() });
    await performAction(
      deps(r.client, {
        verify: {
          gates,
          smoke: async () => {
            ran += 1;
            return await smokePass();
          },
        } as unknown as ActDeps['verify'],
      }),
      STORY_CHECKUP,
      context,
    );
    expect(ran).toBe(0);
    expect(r.requests[0]?.checkup?.smoke).toBeUndefined();
  });

  it('dispatches the checkup even when the smoke command failed', async () => {
    // EVIDENCE, NOT A GATE (ruling 55). A feature whose smoke command fails is exactly what a person needs
    // told about, and blocking there would stop the project instead of reporting it.
    const r = recorder({ boardCards: board() });
    await performAction(deps(r.client, { verify: verify(smokeFail) }), FEATURE_CHECKUP, context);
    expect(r.requests).toHaveLength(1);
    expect(r.requests[0]?.checkup?.smoke).toMatchObject({ passed: false, command: 'npm run smoke' });
  });

  it('assembles the children and the blocked list from the board it already read', async () => {
    const r = recorder({ boardCards: board() });
    await performAction(deps(r.client, { verify: verify(smokePass) }), FEATURE_CHECKUP, context);
    const evidence = r.requests[0]?.checkup;
    // A feature's children are its STORIES, one board down — not its tasks.
    expect(evidence?.children.map((c) => c.id)).toEqual(['P-001', 'P-002']);
    // And the blocked list reaches through as many levels as there are: E-001 is under P-001, which is done,
    // so a one-level walk would call this feature clean.
    expect(evidence?.blocked).toEqual(['E-001']);
  });

  it('names each child’s column and how its last run ended', async () => {
    const r = recorder({ boardCards: board() });
    // A run on P-001, which is the fact `GET /api/runs` would otherwise have been asked for.
    r.client.runs = async () => ({
      ok: true as const,
      value: {
        runs: [record({ card: 'P-001', board: 'product', skill: 'break-down', status: 'attention' })],
      },
    });
    await performAction(deps(r.client, { verify: verify(smokePass) }), FEATURE_CHECKUP, context);
    const children = r.requests[0]?.checkup?.children ?? [];
    expect(children.find((c) => c.id === 'P-001')).toMatchObject({ column: 'done', outcome: 'attention' });
    // Absent rather than invented for a child nothing has run on yet.
    expect(children.find((c) => c.id === 'P-002')?.outcome).toBeUndefined();
  });

  it('marks a blocked child as blocked, so the prompt need not know which slug means it', async () => {
    const r = recorder({ boardCards: board() });
    await performAction(deps(r.client), STORY_CHECKUP, context);
    expect(r.requests[0]?.checkup?.children).toEqual([{ id: 'E-001', column: 'blocked', blocked: true }]);
  });

  it('fetches the suggestions with its OWN service credential, not the checkup’s', async () => {
    // `GET /api/suggestions` is open to `service` (auth.ts), which the loop holds and a `work` run does not.
    const r = recorder({
      boardCards: board(),
      suggestions: [{ id: 'S-1', title: 'the config loader has no tests' }],
    });
    await performAction(deps(r.client, { verify: verify(smokePass) }), FEATURE_CHECKUP, context);
    expect(r.calls).toContain('suggestions');
    expect(r.requests[0]?.checkup?.suggestions).toEqual([
      { id: 'S-1', title: 'the config loader has no tests' },
    ]);
  });

  it('dispatches with an empty suggestion list rather than none when that read failed', async () => {
    // A failed read must not become "there is nothing outstanding": that is how a checkup concludes a project
    // is clean. It is dispatched anyway, because the checkup's own subject is the cards.
    const r = recorder({ boardCards: board() });
    r.client.suggestions = (async () => ({
      ok: false as const,
      reason: 'refused with 500',
      fatal: false,
    })) as unknown as typeof r.client.suggestions;
    await performAction(deps(r.client, { verify: verify(smokePass) }), FEATURE_CHECKUP, context);
    expect(r.requests).toHaveLength(1);
    expect(r.requests[0]?.checkup?.suggestions).toEqual([]);
  });

  // THE GATE-DOCUMENT REFUSAL IN FRONT OF THE SMOKE COMMAND TOO (decision 51). `foundation/TESTING.md` carries
  // `smoke:` and is in the same EXECUTED set as `foundation/CODE-QUALITY.md`; both run through `/bin/sh`
  // unsandboxed as the server's user. Guarded only on the gates, the hole stayed open one document over.
  it('runs no smoke command and dispatches nothing while a gate document is unread', async () => {
    let ran = 0;
    const r = recorder({ boardCards: board() });
    const result = await performAction(
      deps(r.client, {
        state: async () => ({ unreviewedGates: ['TESTING.md'] }),
        verify: {
          gates,
          smoke: async () => {
            ran += 1;
            return await smokePass();
          },
        } as unknown as ActDeps['verify'],
      }),
      FEATURE_CHECKUP,
      context,
    );
    expect(ran).toBe(0);
    expect(r.dispatched).toEqual([]);
    expect(r.moves).toEqual([]);
    expect(result.stop?.reason).toBe('stalled');
    expect(result.stop?.detail).toContain('will not run a gate command');
    expect(result.stop?.detail).toContain('foundation/TESTING.md');
  });

  it('runs a story checkup while a gate document is unread, because it spawns nothing', async () => {
    // The refusal is about EXECUTION, not about checkups: a story checkup has no command of its own, so
    // refusing it would cost the project for a risk that is not there.
    const r = recorder({ boardCards: board() });
    const result = await performAction(
      deps(r.client, { state: async () => ({ unreviewedGates: ['TESTING.md'] }) }),
      STORY_CHECKUP,
      context,
    );
    expect(r.dispatched).toEqual(['checkup-story']);
    expect(result.stop).toBeUndefined();
  });

  it('sends no checkup evidence with any other phase', async () => {
    const r = recorder({ boardBefore: [], boardCards: [CARD('P-001', 'product')] });
    await performAction(deps(r.client), BREAKDOWN(), context);
    expect(r.requests[0]?.checkup).toBeUndefined();
  });
});
