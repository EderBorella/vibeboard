import { describe, expect, it } from 'vitest';
import { CRITIC_SKILL, DEFAULT_AUTOPILOT, type Route } from '../src/core/autopilot.js';
import type { RunRecord, RunStatus } from '../src/core/runs.js';
import type { BoardName, Card } from '../src/core/types.js';
import type { Verification } from '../src/core/verify.js';
import { type ActDeps, performAction } from '../src/service/act.js';

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
  } = {},
) {
  const calls: string[] = [];
  const verdicts: Verification[] = [];
  const moves: { card: string; to: string }[] = [];
  const diary: { kind: string; text: string }[] = [];
  const dispatched: string[] = [];
  // The real sequence: `POST /runs` answers with the record it just created, and the same record — same id —
  // is what `GET /runs/:board/:card` shows once it has settled. An earlier version of this fixture invented a
  // fresh id per call, so nothing the loop dispatched could ever be found again and every test failed on a
  // timeout rather than on its subject.
  let dispatchIndex = 0;
  const live: RunRecord[] = [];
  const client = {
    dispatch: async (input: { board: BoardName; card: string; skill: string }) => {
      calls.push(`dispatch:${input.skill}`);
      dispatched.push(input.skill);
      if (opts.dispatch) return opts.dispatch;
      const template = opts.settle?.[Math.min(dispatchIndex, (opts.settle?.length ?? 1) - 1)] ?? record();
      dispatchIndex += 1;
      const started = { ...template, skill: input.skill };
      live.push(started);
      return { ok: true as const, value: { run: started } };
    },
    cardRuns: async () => ({ ok: true as const, value: { runs: live } }),
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
  return { client, calls, verdicts, moves, diary, dispatched };
}

function deps(client: ReturnType<typeof recorder>['client'], over: Partial<ActDeps> = {}): ActDeps {
  return {
    client: client as unknown as ActDeps['client'],
    root: '/tmp/project',
    branch: 'autopilot/2026-08-06',
    now: () => new Date('2026-08-06T10:05:00Z'),
    threshold: DEFAULT_AUTOPILOT.criticThreshold,
    commit: async () => ({ committed: true }),
    verify: {
      gates: async () => PASSED,
      smoke: async () => PASSED,
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
