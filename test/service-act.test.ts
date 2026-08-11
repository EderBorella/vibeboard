import { describe, expect, it } from 'vitest';
import { CRITIC_SKILL, DEFAULT_AUTOPILOT, type Route } from '../src/core/autopilot.js';
import type { RunRecord, RunStatus } from '../src/core/runs.js';
import type { BoardName, Card } from '../src/core/types.js';
import type { Verification } from '../src/core/verify.js';
import { type ActDeps, performAction } from '../src/service/act.js';
import type { DispatchRequest } from '../src/service/board-client.js';

// One dispatch, end to end, and this is where C1's verification finally has a caller.
//
// Everything is injected: no agent is spawned, no project's test suite is run, no git repository is touched.
// What is under test is the ORDER and the CONDITIONS — commit before dispatch, move only on a passing
// verdict, the verdict recorded on the run it judged, a critic counted as a dispatch of its own.

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

const ROUTE: Route = {
  board: 'engineering',
  column: 'backlog',
  skill: 'implement',
  verify: 'gates',
  next: 'review',
};

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

const PASSED: Verification = { mode: 'gates', passed: true, at: '2026-08-06T10:05:00Z' };
const FAILED: Verification = {
  mode: 'gates',
  passed: false,
  at: '2026-08-06T10:05:00Z',
  command: 'npm test',
  output: '1 failing',
  reason: 'npm test exited with 1',
};

// A recording client. Every call the loop can make, in the order it made them, so a test can assert that a
// commit happened BEFORE a dispatch rather than merely that both happened.
function recorder(
  opts: {
    settle?: RunRecord[];
    dispatch?: { ok: false; reason: string; fatal: boolean };
    move?: { ok: false; reason: string; fatal: boolean };
    verdict?: { ok: false; reason: string; fatal: boolean };
    // What the board holds when it is read back — the bootstrap's only evidence that it worked, since cards
    // are created through the API and a run that made a dozen of them changes no files.
    boardCards?: Card[];
    board?: { ok: false; reason: string; fatal: boolean };
  } = {},
) {
  const calls: string[] = [];
  const verdicts: Verification[] = [];
  const moves: { card: string; to: string }[] = [];
  const diary: { kind: string; text: string }[] = [];
  const dispatched: string[] = [];
  // The requests themselves, not only the skill names: `previous` — which run a critic is judging — is
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
      // ONE TEMPLATE PER DISPATCH, asserted rather than clamped. `Math.min` here meant that with fewer
      // templates than dispatches both records shared a run id, `settle`'s `find` returned the first, and a
      // critic's verdict was computed from the WORK run's score — a fixture quietly answering a different
      // question than the test asked.
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
    cardRuns: async () => ({ ok: true as const, value: { runs: live } }),
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
      const boards = { features: [], product: [], engineering: [] } as Record<BoardName, Card[]>;
      for (const card of opts.boardCards ?? []) boards[card.board].push(card);
      return {
        ok: true as const,
        value: { config: { boards: {} } as never, boards, problems: [] },
      };
    },
    move: async (_board: BoardName, card: string, to: string) => {
      calls.push(`move:${card}->${to}`);
      moves.push({ card, to });
      return opts.move ?? { ok: true as const, value: {} };
    },
    verdict: async (_b: BoardName, _c: string, run: string, verification: Verification) => {
      calls.push(`verdict:${run}`);
      verdicts.push(verification);
      return opts.verdict ?? { ok: true as const, value: {} };
    },
    log: async (kind: string, text: string) => {
      calls.push(`log:${kind}`);
      diary.push({ kind, text });
      return { ok: true as const, value: {} };
    },
  };
  return { client, calls, verdicts, moves, diary, dispatched, requests };
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
    threshold: DEFAULT_AUTOPILOT.criticThreshold,
    // Records what it was asked to commit. Ignoring the arguments meant `deps.root` and `deps.branch` could
    // both be wrong and the whole suite still passed — so the promise that a commit cannot land on someone
    // else's branch under an agent's message was held by nothing.
    commit: async (root: string, message: string, opts?: { branch?: string }) => {
      commits.push({ root, message, branch: opts?.branch });
      return { committed: true };
    },
    // DISTINCT, because they were the same function and so `route.verify` was never actually read: calling
    // `smoke` for a `gates` route changed no test.
    verify: {
      gates: async () => PASSED,
      smoke: async () => ({ ...PASSED, mode: 'smoke' as const }),
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
  it('commits before it dispatches, and in that order', async () => {
    // Step 10 is what makes an aborted run one command from gone, so the ORDER is the behaviour: a commit
    // afterwards would capture the agent's work rather than the tree it started from.
    const order: string[] = [];
    const r = recorder({ settle: [record()] });
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
      { kind: 'dispatch', card: CARD(), route: ROUTE },
      context,
    );
    expect(order).toEqual(['commit', 'dispatch']);
  });

  it('uses the verifier the route names', async () => {
    // `gates` and `smoke` were the same fake, so `route.verify` was never read: a smoke route verified by the
    // gate runner, or the other way round, changed nothing. The mode lands on the verdict, so it is visible.
    const r = recorder({ settle: [record()] });
    await performAction(
      deps(r.client),
      { kind: 'dispatch', card: CARD(), route: { ...ROUTE, verify: 'smoke' } },
      context,
    );
    expect(r.verdicts[0].mode).toBe('smoke');
  });

  it('commits the run’s own tree, on the run’s own branch', async () => {
    // The commit fake used to ignore its arguments, so `deps.root` and `deps.branch` could both be wrong and
    // the whole suite still passed — the promise that a commit cannot land on someone else's branch under an
    // agent's message was held by nothing.
    commits.length = 0;
    const r = recorder({ settle: [record()] });
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: ROUTE }, context);
    expect(commits).toEqual([
      {
        root: '/tmp/project',
        branch: 'autopilot/2026-08-06',
        // Whole, not by substring: this is the line a person reads in a log months later.
        message: 'autopilot: before E-001 implement (iteration 4)',
      },
    ]);
  });

  it('advances the card on a passing verdict, through the endpoint', async () => {
    const r = recorder({ settle: [record()] });
    const result = await performAction(
      deps(r.client),
      { kind: 'dispatch', card: CARD(), route: ROUTE },
      context,
    );
    expect(result.dispatches).toBe(1);
    expect(r.moves).toEqual([{ card: 'E-001', to: 'review' }]);
  });

  // THE GATE. Decision 3: nothing advances on self-assessment, and this is the assertion that holds it.
  it('leaves the card exactly where it is on a failing verdict', async () => {
    const r = recorder({ settle: [record()] });
    await performAction(
      deps(r.client, { verify: { gates: async () => FAILED, smoke: async () => FAILED } }),
      { kind: 'dispatch', card: CARD(), route: ROUTE },
      context,
    );
    expect(r.moves).toEqual([]);
  });

  // The other half of the same rule, and the one that makes the test above mean something: the run SAID it
  // succeeded, and the card still does not move, because the verdict is what decides.
  it('ignores what the agent said about its own work', async () => {
    const r = recorder({ settle: [record({ status: 'success', outcome: 'success' })] });
    await performAction(
      deps(r.client, { verify: { gates: async () => FAILED, smoke: async () => FAILED } }),
      { kind: 'dispatch', card: CARD(), route: ROUTE },
      context,
    );
    expect(r.moves).toEqual([]);
  });

  it('records the verdict on the run it judged, before the card moves', async () => {
    // Decision 18. "Why did this card advance?" has to be answerable from disk, and the answer belongs beside
    // the run rather than in a log — so the verdict is written first, and the move follows it.
    const judged = record();
    const r = recorder({ settle: [judged] });
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: ROUTE }, context);
    expect(r.calls).toEqual(['dispatch:implement', `verdict:${judged.run}`, 'move:E-001->review', 'log:run']);
    expect(r.verdicts[0]).toEqual(PASSED);
  });

  it('writes a diary line after every dispatch, whichever way it went', async () => {
    for (const verification of [PASSED, FAILED]) {
      const r = recorder({ settle: [record()] });
      await performAction(
        deps(r.client, { verify: { gates: async () => verification, smoke: async () => verification } }),
        { kind: 'dispatch', card: CARD(), route: ROUTE },
        context,
      );
      const line = r.diary.find((d) => d.kind === 'run');
      expect(line?.text).toContain('E-001');
      expect(line?.text).toContain(verification.passed ? 'advanced to review' : 'stayed where it is');
    }
  });

  it('burns nothing and moves nothing when the run was cancelled', async () => {
    // `cancelled` and `interrupted` are the two endings nobody is answerable for: the user stopped it, or a
    // restart left it stale. There is nothing to verify because the work never happened.
    for (const status of ['cancelled', 'interrupted'] as const) {
      const r = recorder({ settle: [record({ status })] });
      const result = await performAction(
        deps(r.client),
        { kind: 'dispatch', card: CARD(), route: ROUTE },
        context,
      );
      expect(r.moves, status).toEqual([]);
      expect(r.verdicts, status).toEqual([]);
      // Still one dispatch: a model ran, and decision 8 counts everything a model does.
      expect(result.dispatches, status).toBe(1);
    }
  });

  // A dispatch that HAPPENED and then failed to record its verdict or move its card was reported as no dispatch
  // at all: neither cap was told about a real agent run, the tick counted as idle, and the next tick re-picked
  // the same card and dispatched over work that had already passed — three times over, until the attempt cap
  // caught it. Decision 8 says everything a model does counts, even when what came after it broke.
  it('still counts the dispatch when the verdict cannot be recorded', async () => {
    const r = recorder({
      settle: [record()],
      verdict: { ok: false, reason: 'refused with 500', fatal: false },
    });
    const result = await performAction(
      deps(r.client),
      { kind: 'dispatch', card: CARD(), route: ROUTE },
      context,
    );
    expect(r.dispatched).toEqual(['implement']);
    expect(result.dispatches).toBe(1);
    // AND IT STOPS THERE, which the count alone cannot show — a review found the whole refusal block deletable
    // with this test green. Rule 4 is that the verdict is recorded BEFORE the card moves, so a card that moved
    // without one is a card nobody can explain: no move, and the diary says what was refused instead of
    // narrating a run that was never accounted for.
    expect(r.moves).toEqual([]);
    // Not the run id, which the shared fixture counter makes order-dependent: the SHAPE, which is what says
    // nothing else happened between the verdict and the report of its refusal.
    expect(r.calls).toHaveLength(3);
    expect(r.calls[0]).toBe('dispatch:implement');
    expect(r.calls[1]).toMatch(/^verdict:/);
    expect(r.calls[2]).toBe('log:note');
    expect(r.diary[0].text).toMatch(/could not record the verdict/i);
  });

  it('still counts the dispatch when the card cannot be moved', async () => {
    const r = recorder({ settle: [record()], move: { ok: false, reason: 'refused with 409', fatal: false } });
    const result = await performAction(
      deps(r.client),
      { kind: 'dispatch', card: CARD(), route: ROUTE },
      context,
    );
    expect(result.dispatches).toBe(1);
  });

  it('appends what the agent said about its own work', async () => {
    // Loop step 12 says to append the run's summary, and decision 10 justifies denying agents diary access on
    // the grounds that auto-pilot appends it for them — so without this the narrative had no agent voice at all.
    const r = recorder({
      settle: [record({ summary: 'added the middleware; the token store is still a stub' })],
    });
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: ROUTE }, context);
    expect(r.diary.find((d) => d.kind === 'run')?.text).toContain('the token store is still a stub');
  });

  it('stops the loop when the commit fails, rather than dispatching into a tree it cannot undo', async () => {
    const r = recorder({ settle: [record()] });
    const result = await performAction(
      deps(r.client, {
        commit: async () => ({ committed: false, reason: 'the tree has changes git will not record' }),
      }),
      { kind: 'dispatch', card: CARD(), route: ROUTE },
      context,
    );
    expect(result.stop?.reason).toBe('stalled');
    expect(result.stop?.detail).toContain('will not record');
    // And nothing was dispatched, so there is nothing to revert.
    expect(r.dispatched).toEqual([]);
  });

  it('carries on when there was simply nothing to commit', async () => {
    // A clean tree is ordinary — the previous tick committed everything — and must not be read as a failure.
    const r = recorder({ settle: [record()] });
    const result = await performAction(
      deps(r.client, { commit: async () => ({ committed: false }) }),
      { kind: 'dispatch', card: CARD(), route: ROUTE },
      context,
    );
    expect(result.stop).toBeUndefined();
    expect(r.dispatched).toEqual(['implement']);
  });
});

// The bound, on both axes. An unbounded `settle` is not a slow test — it is a loop that never returns, and in
// this suite that HANGS rather than fails, because vitest's own timeout is a `setTimeout` the spin starves.
describe('waiting for a run to settle', () => {
  const never = (polls: { n: number }) =>
    ({
      dispatch: async () => ({ ok: true as const, value: { run: record() } }),
      cardRuns: async () => {
        polls.n += 1;
        return { ok: true as const, value: { runs: [] } };
      },
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
      { kind: 'dispatch', card: CARD(), route: ROUTE },
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
    // The polling half was unreached: the fixture always answered already-settled, so accepting a `running`
    // record as finished changed no test — and a verdict would then be computed over work still in progress.
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
      { kind: 'dispatch', card: CARD(), route: ROUTE },
      context,
    );
    expect(look).toBe(3);
    expect(result.stop).toBeUndefined();
    expect(result.dispatches).toBe(1);
  });
});

// THE FIRST HAND-RUN'S FINDING, generalised past the critic. A run that produced nothing must not be
// verified, because every verifier would then answer about a tree the run never touched — and `gates` is the
// dangerous one: its commands were passing before the dispatch and are passing now, so the card advances
// having implemented nothing, with no model anywhere in the loop to notice.
//
// The injected `gates` in `deps` returns PASSED, which is exactly the fixture this needs: if the verifier is
// consulted at all, the card moves.
describe('a run that produced nothing', () => {
  const EMPTY = { status: 'failed' as RunStatus, filesChanged: 0, report: '' };

  it('does not run the route’s verifier, and does not advance the card', async () => {
    let gatesRan = 0;
    const r = recorder({ settle: [record(EMPTY)] });
    const result = await performAction(
      deps(r.client, {
        verify: {
          gates: async () => {
            gatesRan += 1;
            return PASSED;
          },
          smoke: async () => PASSED,
        },
      }),
      { kind: 'dispatch', card: CARD(), route: ROUTE },
      context,
    );
    expect(gatesRan).toBe(0);
    expect(r.moves).toEqual([]);
    expect(result.dispatches).toBe(1);
  });

  it('records a verdict that says the check did not run', async () => {
    const r = recorder({ settle: [record(EMPTY)] });
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: ROUTE }, context);
    expect(r.verdicts[0]).toMatchObject({ mode: 'gates', passed: false });
    // "nothing this server can see" rather than "nothing": a run killed by the clock may really have created
    // cards, and its report is deliberately not folded — so what is absent is the evidence, not necessarily the
    // work. The verdict fails either way; the sentence must not overclaim.
    expect(r.verdicts[0].reason).toMatch(/left nothing this server can see/i);
    expect(r.verdicts[0].reason).toMatch(/check was not run/i);
    // No command and no output: naming one would claim a gate ran and failed.
    expect(r.verdicts[0].command).toBeUndefined();
    expect(r.verdicts[0].output).toBeUndefined();
  });

  // A judge is a dispatch (decision 8), so on a flaky backend this was half the budget spent judging nothing.
  it('dispatches no critic for it', async () => {
    const r = recorder({ settle: [record(EMPTY)] });
    const result = await performAction(
      deps(r.client),
      { kind: 'dispatch', card: CARD(), route: { ...ROUTE, verify: 'critic' } },
      context,
    );
    expect(r.dispatched).toEqual(['implement']);
    expect(result.dispatches).toBe(1);
  });

  it('stops at a refused verdict rather than moving the card anyway', async () => {
    // The twin of the main path's refusal, and equally unheld until a review looked: the block can be deleted
    // and only the absence of a move gives it away.
    const r = recorder({
      settle: [record(EMPTY)],
      verdict: { ok: false, reason: 'refused with 500', fatal: false },
    });
    const result = await performAction(
      deps(r.client),
      { kind: 'dispatch', card: CARD(), route: ROUTE },
      context,
    );
    expect(result.dispatches).toBe(1);
    expect(r.moves).toEqual([]);
    expect(r.diary[0].text).toMatch(/could not record the verdict/i);
  });

  it('says in the diary that the check did not run, rather than that it failed', async () => {
    const r = recorder({ settle: [record(EMPTY)] });
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: ROUTE }, context);
    expect(r.diary[0].text).toContain('gates did not run');
    expect(r.diary[0].text).not.toContain('gates failed');
  });

  // THE FAIL-CLOSED DIRECTION, three ways. Being wrong here costs one wasted verification; being wrong the
  // other way advances a card over an empty run, so every clause must hold before the check is skipped.
  it('verifies a failed run that changed files, because it may have done real work', async () => {
    const r = recorder({ settle: [record({ status: 'failed', filesChanged: 3, report: '' })] });
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: ROUTE }, context);
    expect(r.moves).toEqual([{ card: 'E-001', to: 'review' }]);
  });

  // PREMISE CORRECTED by a review (2026-08-06). This used to build `created: ['F-002']` on a record with no
  // `outcome`, which the runner cannot produce: `withReport` is the only writer of either field, so a run that
  // reported cards always has an outcome too. The intent it was reaching for is real and is kept — a run whose
  // product is CARDS rather than files must still be verified, because `derive-features` writes through the API
  // and legitimately changes nothing on disk — so it is now asserted on the shape production actually writes:
  // a report claiming success, `created` ids, zero files, and a `failed` status stamped by the clock afterwards.
  it('verifies a run whose product was cards rather than files', async () => {
    const r = recorder({
      settle: [
        record({
          status: 'failed',
          outcome: 'success',
          filesChanged: 0,
          created: ['F-002'],
          report: '## Did it',
        }),
      ],
    });
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: ROUTE }, context);
    expect(r.moves).toEqual([{ card: 'E-001', to: 'review' }]);
  });

  it('verifies when the file count could not be taken at all', async () => {
    // Absent is not zero. A measurement that failed is not evidence that nothing changed.
    const r = recorder({ settle: [record({ status: 'failed', report: '' })] });
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: ROUTE }, context);
    expect(r.moves).toEqual([{ card: 'E-001', to: 'review' }]);
  });
});

describe('a critic route', () => {
  const CRITIC_ROUTE: Route = { ...ROUTE, verify: 'critic' };

  it('dispatches a judge of its own, and counts it', async () => {
    // Decision 8: the judge is a model doing work, so it costs an iteration. Reported as two dispatches, which
    // is what stops a critic-verified board from spending twice what its cap allows.
    const r = recorder({ settle: [record(), record({ skill: CRITIC_SKILL, score: 0.9 })] });
    const result = await performAction(
      deps(r.client),
      { kind: 'dispatch', card: CARD(), route: CRITIC_ROUTE },
      context,
    );
    expect(r.dispatched).toEqual(['implement', CRITIC_SKILL]);
    expect(result.dispatches).toBe(2);
  });

  it('dispatches the critic under its own skill, so the cap is not spent twice', async () => {
    // `attemptsUsed` filters by skill, so a critic recorded as `implement` would make a card reach its attempt
    // cap in half the tries — and the cap is what stops a card being retried for ever.
    const r = recorder({ settle: [record(), record({ skill: CRITIC_SKILL, score: 0.9 })] });
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: CRITIC_ROUTE }, context);
    expect(r.dispatched[1]).toBe(CRITIC_SKILL);
  });

  it('records WHICH run judged the card, not merely that a critic did', async () => {
    // `by` is documented as the critic run's id, "so its reasoning is one lookup away rather than a correlation
    // by timestamp" — and every producer was passing the string `critic`, which makes the question unanswerable
    // from the record the verdict is written on. Residual risk 1's plan to judge the critic reads these.
    const judge = record({ skill: CRITIC_SKILL, score: 0.9 });
    const r = recorder({ settle: [record(), judge] });
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: CRITIC_ROUTE }, context);
    expect(r.verdicts[0].by).toBe(judge.run);
  });

  // THE FIRST HAND-RUN (2026-08-06). The critic scored 0 and wrote "No feature cards were created from the
  // README, so the card's acceptance criterion is unmet." The diary said the critic "reported no reason" —
  // because this producer passed the score and dropped the sentence, and `criticVerification`'s fallback
  // fires only when it gets no words. The evidence was computed and thrown away.
  // The other half of the same hand-run finding: the prompt has a slot for the run under judgement
  // (run-prompt.ts), and it is worth nothing unless the dispatch fills it. Asserted on the REQUEST, because
  // that is the only place this module can be held to it.
  it('tells the critic which run it is judging', async () => {
    const judged = record();
    const r = recorder({ settle: [judged, record({ skill: CRITIC_SKILL, score: 0.9 })] });
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: CRITIC_ROUTE }, context);
    expect(r.requests[1]).toMatchObject({ skill: CRITIC_SKILL, previous: judged.run });
  });

  it('carries the critic’s own sentence onto the verdict', async () => {
    const judge = record({ skill: CRITIC_SKILL, score: 0, summary: 'No feature cards were created.' });
    const r = recorder({ settle: [record(), judge] });
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: CRITIC_ROUTE }, context);
    expect(r.verdicts[0].passed).toBe(false);
    expect(r.verdicts[0].reason).toBe('No feature cards were created.');
  });

  it('records the real threshold even when the critic never ran', async () => {
    // The bar is EVIDENCE: it says what this card was measured against. A 0 claimed the work was judged against
    // a bar this project's own validator refuses — the one value that would have passed anything.
    const r = recorder({ settle: [record()] });
    let call = 0;
    const original = r.client.dispatch;
    r.client.dispatch = async (input) => {
      call += 1;
      if (call === 2) return { ok: false as const, reason: 'refused with 409', fatal: false };
      return original(input);
    };
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: CRITIC_ROUTE }, context);
    expect(r.verdicts[0].threshold).toBe(0.6);
    expect(r.verdicts[0].passed).toBe(false);
  });

  it('turns the score into the verdict, against the project’s threshold', async () => {
    const r = recorder({ settle: [record(), record({ skill: CRITIC_SKILL, score: 0.9 })] });
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: CRITIC_ROUTE }, context);
    expect(r.verdicts[0]).toMatchObject({ mode: 'critic', passed: true, score: 0.9, threshold: 0.6 });
    expect(r.moves).toEqual([{ card: 'E-001', to: 'review' }]);
  });

  it('fails the card when the score is below the bar', async () => {
    const r = recorder({ settle: [record(), record({ skill: CRITIC_SKILL, score: 0.4 })] });
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: CRITIC_ROUTE }, context);
    expect(r.verdicts[0]).toMatchObject({ passed: false, score: 0.4 });
    expect(r.moves).toEqual([]);
  });

  // Absence is not a zero, and neither is it a pass. A critic that answered nothing has judged nothing.
  it('fails closed when the critic returned no score at all', async () => {
    const r = recorder({ settle: [record(), record({ skill: CRITIC_SKILL })] });
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: CRITIC_ROUTE }, context);
    expect(r.verdicts[0]).toMatchObject({ mode: 'critic', passed: false });
    expect(r.verdicts[0].score).toBeUndefined();
    expect(r.moves).toEqual([]);
  });

  it('fails closed when the critic could not be dispatched at all', async () => {
    const r = recorder({ settle: [record()], dispatch: undefined });
    let call = 0;
    const original = r.client.dispatch;
    r.client.dispatch = async (input) => {
      call += 1;
      if (call === 2) return { ok: false as const, reason: 'refused with 409: no runner', fatal: false };
      return original(input);
    };
    await performAction(deps(r.client), { kind: 'dispatch', card: CARD(), route: CRITIC_ROUTE }, context);
    expect(r.verdicts[0]).toMatchObject({ passed: false });
    expect(r.moves).toEqual([]);
  });
});

describe('the two actions that dispatch nothing', () => {
  it('rolls a parent up through the endpoint and says so in the diary', async () => {
    const r = recorder();
    const result = await performAction(
      deps(r.client),
      { kind: 'rollup', advance: [{ card: CARD('P-001', 'product'), to: 'done' }] },
      context,
    );
    expect(result.dispatches).toBe(0);
    expect(r.moves).toEqual([{ card: 'P-001', to: 'done' }]);
    expect(r.diary[0]?.kind).toBe('lifecycle');
  });

  it('blocks an exhausted card and says why', async () => {
    const r = recorder();
    const result = await performAction(
      deps(r.client),
      { kind: 'block', card: CARD(), to: 'blocked' },
      context,
    );
    expect(result.dispatches).toBe(0);
    expect(r.moves).toEqual([{ card: 'E-001', to: 'blocked' }]);
    expect(r.diary[0]?.text).toContain('every attempt');
  });

  it('does nothing at all for a wait', async () => {
    const r = recorder();
    expect(await performAction(deps(r.client), { kind: 'wait' }, context)).toEqual({ dispatches: 0 });
    expect(r.calls).toEqual([]);
  });

  it('stops the loop when a refusal is one it cannot recover from', async () => {
    const r = recorder({ move: { ok: false, reason: 'refused with 401', fatal: true } });
    const result = await performAction(
      deps(r.client),
      { kind: 'block', card: CARD(), to: 'blocked' },
      context,
    );
    expect(result.stop?.reason).toBe('stalled');
  });

  it('carries on past a refusal that might not happen again', async () => {
    const r = recorder({ move: { ok: false, reason: 'refused with 409: card is locked', fatal: false } });
    const result = await performAction(
      deps(r.client),
      { kind: 'block', card: CARD(), to: 'blocked' },
      context,
    );
    expect(result.stop).toBeUndefined();
    // And it says so where a person will see it, rather than only in a log nobody reads.
    expect(r.diary.some((d) => d.kind === 'note')).toBe(true);
  });
});

// THE BOOTSTRAP: the one action that dispatches a run about the PROJECT rather than about a card. It is how a
// board with a README and no cards gets its first ones — see `bootstrapSkill` in core/autopilot.ts for the
// contradiction it resolves.
describe('deriving an empty board', () => {
  const BOOTSTRAP = { kind: 'bootstrap' as const, skill: 'derive-features', detail: 'deriving' };

  it('dispatches with no card at all, and says so rather than naming one', async () => {
    // The whole point: `card` and `board` absent, `project` true. A request that named a card would be the
    // trigger-card workaround this replaces, and the run record would land beside a card that does not exist.
    const r = recorder({ settle: [record({ card: undefined, board: undefined })] });
    const result = await performAction(deps(r.client), BOOTSTRAP, context);
    expect(result.dispatches).toBe(1);
    expect(r.requests).toEqual([{ project: true, skill: 'derive-features' }]);
  });

  it('commits before it dispatches, exactly as a card dispatch does', async () => {
    // Rule 1 is not about cards: from the moment the agent starts writing, a commit first is what makes any of
    // it one command from gone.
    const order: string[] = [];
    const r = recorder({ settle: [record({ card: undefined, board: undefined })] });
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
    const r = recorder({ settle: [record({ card: undefined, board: undefined })] });
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
    const r = recorder({ settle: [record({ card: undefined, board: undefined })] });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.calls).toContain('runs');
    expect(r.calls.some((c) => c.startsWith('cardRuns'))).toBe(false);
  });

  it('records no verdict, because there is no card to write one beside', async () => {
    const r = recorder({ settle: [record({ card: undefined, board: undefined })] });
    await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.verdicts).toEqual([]);
    expect(r.moves).toEqual([]);
  });

  it('reports what the board holds afterwards, which is the only evidence there is', async () => {
    // NOT the run's own outcome (rule 2), and not files changed: cards are created through the API, so a
    // bootstrap that worked perfectly changes nothing on disk.
    const r = recorder({
      settle: [record({ card: undefined, board: undefined, summary: 'Derived four features' })],
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
    const r = recorder({ settle: [record({ card: undefined, board: undefined, status: 'attention' })] });
    const result = await performAction(deps(r.client), BOOTSTRAP, context);
    expect(r.diary.find((d) => d.kind === 'run')?.text).toContain('the board is still empty');
    expect(result.stop).toBeUndefined();
    expect(result.dispatches).toBe(1);
  });

  it('does not claim the board is empty when it could not be read', async () => {
    // "Created no cards" is a verdict; a failed read is not evidence for it.
    const r = recorder({
      settle: [record({ card: undefined, board: undefined })],
      board: { ok: false, reason: 'could not reach the board', fatal: false },
    });
    await performAction(deps(r.client), BOOTSTRAP, context);
    const line = r.diary.find((d) => d.kind === 'run')?.text ?? '';
    expect(line).toContain('unknown');
    expect(line).not.toContain('still empty');
  });

  it('stops when the derivation never finishes', async () => {
    const r = recorder({ settle: [record({ card: undefined, board: undefined, status: 'running' })] });
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
