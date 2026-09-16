import { describe, expect, it } from 'vitest';
import { IDLE_STATE } from '../src/core/autopilot-state.js';
import type { TickAction } from '../src/core/tick.js';
import type { BoardView } from '../src/service/board-client.js';
import { BoardClient } from '../src/service/board-client.js';
import { type ActResult, type LoopDeps, runLoop } from '../src/service/loop.js';
import { writeAutopilotState } from '../src/store/autopilot-store.js';
import { defaultConfig } from '../src/store/project/config.js';
import { injectFetch, openTestProject } from './helpers.js';

// The loop's HTTP surface, against a REAL app with a REAL minted service credential — the same store the
// app verifies against, so a token this suite accepts is one the server would.
//
// `app.inject` rather than a listening socket: Fastify's injection runs the whole request lifecycle,
// including the auth preHandler, so the scope table is genuinely exercised. The client takes its `fetch`
// injected for exactly this.

async function connected(scope: 'service' | 'work' = 'service') {
  const project = await openTestProject();
  const credential = project.mint(scope, `run-${scope}`, 'E-001');
  const client = new BoardClient({
    apiBase: 'http://board.test',
    token: credential.token,
    fetch: injectFetch(project.app),
  });
  return { ...project, client, credential };
}

describe('what the loop can read', () => {
  it('reads the board, its config and whatever would not parse, in one call', async () => {
    const { client } = await connected();
    const board = await client.board();
    expect(board.ok).toBe(true);
    if (!board.ok) return;
    expect(board.value.config.name).toBe('T');
    expect(Object.keys(board.value.boards).sort()).toEqual(['engineering', 'features', 'product']);
    // Present and empty, never absent: the setup barrier is unknowable while any card will not parse, and an
    // absent list reads as "nothing wrong".
    expect(board.value.problems).toEqual([]);
  });

  it('reads the runs and the ledger the caps are compared against', async () => {
    const { client } = await connected();
    expect((await client.runs()).ok).toBe(true);
    const account = await client.accounting();
    expect(account.ok).toBe(true);
    if (account.ok) expect(typeof account.value.attemptCap).toBe('number');
  });

  it('sends its token on every request, reads included', async () => {
    // Not "the client has a token" — that the SERVER accepted it. A read the loop cannot make is a tick it
    // cannot take, and the reads were the rows missing from the scope table when this was first written.
    const { app, client } = await connected();
    const anonymous = new BoardClient({ apiBase: 'http://board.test', token: '', fetch: injectFetch(app) });
    expect((await client.runs()).ok).toBe(true);
    const refused = await anonymous.runs();
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.fatal).toBe(true);
  });
});

describe('what the loop is refused', () => {
  it('treats a revoked credential as fatal rather than something to retry', async () => {
    const { app, client, credential } = await connectedWithStore();
    expect((await client.runs()).ok).toBe(true);
    // Revoked the way a stop revokes it: through the emergency stop, so this is the real path rather than a
    // store poked directly.
    await app.inject({ method: 'POST', url: '/api/autopilot/kill', payload: {} });
    const after = await client.runs();
    expect(after.ok).toBe(false);
    // The distinction the whole result type exists for: a 401 is a decision the server has made about this
    // loop, and retrying it is spinning.
    expect(after.ok === false && after.fatal).toBe(true);
    expect(after.ok === false && after.reason).toContain('401');
    expect(credential.scope).toBe('service');
  });

  // AN EXPIRED AGENT SIGN-IN IS NOT WORTH ANOTHER TICK, and it used to be treated as one. `POST /api/runs`
  // answers 412 when the sandbox will not confine a run — the commonest cause by far being a credential
  // that has expired — and 412 was absent from the fatal list, so the loop logged a note and asked again.
  // Measured on a real project: 128 diary lines in 11 minutes, one refusal every five seconds, no cost and
  // no progress.
  //
  // THE STREAK GUARD COULD NOT HAVE CAUGHT IT. `consecutiveInfrastructureFailures` stops the loop after two
  // runs whose fault is infrastructure, and a refusal at 412 never becomes a run at all — there was no
  // record to count. That is why this belongs in the client's classification rather than in the tick.
  it('treats a sandbox refusal as fatal — it is the machine, and the next tick cannot fix it', async () => {
    const client = new BoardClient({
      apiBase: 'http://board.test',
      token: 'anything',
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'Agents are disabled: the Claude sign-in has expired.' }), {
            status: 412,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
    });
    const answer = await client.runs();
    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.fatal, 'a 412 is retryable, so the loop spins').toBe(true);
    // The server's own sentence travels with it, because that is what the diary shows a person.
    expect(answer.ok === false && answer.reason).toContain('sign-in has expired');
  });

  // THE OTHER SIDE OF THE LINE, so the change above cannot quietly become "stop on anything". A 409 is the
  // board disagreeing about a card — a card already moved, a column that filled up — and the next tick
  // derives its position afresh and may well succeed.
  it('still treats a board-state conflict as worth another tick', async () => {
    const client = new BoardClient({
      apiBase: 'http://board.test',
      token: 'anything',
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'That card is not where you think it is.' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
    });
    const answer = await client.runs();
    expect(answer.ok === false && answer.fatal).toBe(false);
  });

  it('treats a server it cannot reach as worth another tick', async () => {
    const client = new BoardClient({
      apiBase: 'http://board.test',
      token: 'anything',
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    const answer = await client.runs();
    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.fatal).toBe(false);
    expect(answer.ok === false && answer.reason).toContain('ECONNREFUSED');
  });

  it('carries the server’s own sentence, not just its status', async () => {
    // The refusal ends up in the diary, and a status code alone is a dead end for whoever reads it.
    const { app, root, client } = await connected();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'halted', reason: 'killed' });
    const refused = await client.dispatch({ board: 'engineering', card: 'E-001', skill: 'implement' });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.reason).toContain('halted');
    expect(app).toBeTruthy();
  });

  it('refuses to keep going when the project it was started for is closed', async () => {
    const { session, client } = await connected();
    await session.close();
    const board = await client.board();
    expect(board.ok).toBe(false);
    // Fatal: every credential check compares against the OPEN project, so nothing it does next can work.
    expect(board.ok === false && board.fatal).toBe(true);
  });
});

describe('how the loop reports its own ending', () => {
  it('records a terminal reason through the server, so the state and the overlay agree', async () => {
    const { app, root, client } = await connected();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    expect((await client.stopped('complete')).ok).toBe(true);
    const state = (await app.inject({ method: 'GET', url: '/api/autopilot/state' })).json().state;
    expect(state.state).toBe('stopped');
    expect(state.reason).toBe('complete');
    // The sentence, composed by the server rather than sent by the loop: one statement of what each reason
    // means, wherever it is rendered.
    expect(state.detail).toContain('nothing is eligible and nothing is unfinished');
  });

  it('cannot claim a reason that belongs to a person', async () => {
    // `killed` is the emergency stop's and `stopped` is the button's. A loop reporting either would put
    // someone else's words in the overlay — and `killed` in particular would show a halt nobody ordered.
    const { root, client } = await connected();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    for (const reason of ['killed', 'stopped']) {
      const answer = await client.stopped(reason);
      expect(answer.ok, reason).toBe(false);
      expect(answer.ok === false && answer.reason).toContain('not a reason the loop may report');
    }
  });

  it('cannot invent a reason at all', async () => {
    const { root, client } = await connected();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    const answer = await client.stopped('vibes');
    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.reason).toContain('reason must be one of');
  });

  it('cannot overwrite a halt', async () => {
    // An emergency stop is not something a loop may talk its way out of, and a loop mid-tick when the halt
    // lands will try: it has already decided it is `complete`.
    const { root, client } = await connected();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'halted', reason: 'killed' });
    const answer = await client.stopped('complete');
    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.reason).toContain('halted');
  });

  it('is not a control a work agent can reach', async () => {
    // The other three stops are admin-only. A work agent that could stop auto-pilot could stop the thing
    // supervising it.
    const { root, client } = await connected('work');
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running' });
    const answer = await client.stopped('complete');
    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.reason).toContain('403');
  });
});

// Revoking a credential mid-flight is the one thing `mint` cannot express, so this reaches the store the
// helper built. Kept local rather than widening `TestProject` again: exactly one test needs it, and a field
// nothing else destructures was already removed once for being dead surface.
async function connectedWithStore() {
  const project = await openTestProject();
  const credential = project.mint('service', 'run-svc');
  const client = new BoardClient({
    apiBase: 'http://board.test',
    token: credential.token,
    fetch: injectFetch(project.app),
  });
  return { ...project, client, credential };
}

describe('the loop’s sequencing', () => {
  // Everything injected: no process, no clock, no filesystem. What is under test is the ORDER of things and
  // which fields get written — the decisions all live in `decideTick`, which is pure and tested separately.
  // A board that genuinely yields a `dispatch`, because the loop calls the REAL `decideTick` — it holds no
  // decisions of its own, so a fixture thin enough to decide nothing would make every sequencing test below
  // pass on a `no-op` stop instead of on the thing it names.
  // AN EMPTY BOARD, deliberately: these tests are about SEQUENCING, so all the board has to be is one
  // `decideTick` answers with an action rather than a stop — and the empty board is the smallest such, since
  // it is the bootstrap's own trigger. A board mid-lifecycle would make every test here depend on which phase
  // the tick picked, which is `test/tick.test.ts`'s subject and not this file's.
  const board = (): BoardView => ({
    config: defaultConfig('T'),
    boards: { features: [], product: [], engineering: [] },
    problems: [],
  });

  function harness(
    over: Partial<LoopDeps> & { states?: import('../src/core/autopilot-state.js').AutopilotState[] } = {},
  ) {
    const acted: TickAction[] = [];
    const added: number[] = [];
    const reads: number[] = [];
    const states = over.states ?? [];
    let read = 0;
    const deps: LoopDeps = {
      client: {
        board: async () => ({ ok: true, value: board() }),
        runs: async () => ({ ok: true, value: { runs: [] } }),
        stopped: async () => ({ ok: true, value: {} }),
        log: async () => ({ ok: true, value: {} }),
      } as unknown as LoopDeps['client'],
      readState: async () => {
        reads.push(read);
        const state = states[read] ?? states.at(-1) ?? IDLE_STATE;
        read += 1;
        return state;
      },
      addToCounters: async (dispatches) => {
        added.push(dispatches);
      },
      // Nothing declared. Every test in this file is about SEQUENCING — which tick read the state, what was
      // dispatched — and reaches no ending that compares a smoke command to a gate.
      commands: async () => ({ gates: [] }),
      act: async (action): Promise<ActResult> => {
        acted.push(action);
        return { dispatches: action.kind === 'dispatch' ? 1 : 0 };
      },
      // A REAL MACROTASK, not `async () => undefined`. A microtask-only wait starves the timer queue, so a
      // loop that lost its bound span 30 million times in four seconds while vitest's own timeout — itself a
      // `setTimeout` — could never fire: the suite hung instead of failing, orphaned a worker at 90% CPU and
      // leaked the run's temp root. `expect(tried).toBeLessThan(1000)` below cannot execute at all if the
      // bound goes, which makes it a gate that only works while the code is already correct.
      wait: () => new Promise((resolve) => setTimeout(resolve, 0)),
      ...over,
    };
    return { deps, acted, added, reads };
  }

  const running = { ...IDLE_STATE, state: 'running' as const };

  it('stops when the state says so, without asking the server anything', async () => {
    // The soft stop, seen between ticks. Nothing is dispatched and nothing is reported: the server wrote
    // this state, so telling it would be telling it what it said.
    const stopped = { ...IDLE_STATE, state: 'stopped' as const, reason: 'stopped' as const };
    const { deps, acted } = harness({ states: [stopped] });
    const ended = await runLoop(deps);
    expect(ended.reason).toBe('stopped');
    expect(acted).toEqual([]);
  });

  it('honours a stop written between two ticks', async () => {
    // THE CARRIED QUESTION, answered: the state is read before every tick, so a stop written while the loop
    // was working takes effect on the next one rather than at the end of the run. A loop that read the state
    // once at startup would ignore it — which is the difference between a control and a suggestion.
    const halted = { ...IDLE_STATE, state: 'halted' as const, reason: 'killed' as const };
    const { deps, acted, reads } = harness({
      states: [running, halted],
      act: async (): Promise<ActResult> => ({ dispatches: 1 }),
    });
    const ended = await runLoop(deps);
    expect(ended.reason).toBe('killed');
    expect(reads.length).toBe(2);
    expect(acted).toEqual([]);
  });

  it('adds to its own counters relatively, never writing an absolute it computed earlier', async () => {
    const { deps, added } = harness({
      states: [
        { ...running, iteration: 4 },
        { ...IDLE_STATE, state: 'stopped' },
      ],
      act: async (): Promise<ActResult> => ({ dispatches: 1 }),
    });
    await runLoop(deps);
    // RELATIVE, and that is the whole assertion. Computed as absolutes from the state read at the top of the
    // tick, a Restart landing mid-dispatch was undone: the reset wrote 0, this merged 4+1 over it, and the
    // project came back `idle` with 5 — instantly capped on something the user had just cleared. Decision 20's
    // split still holds: the loop touches the counter and nothing else.
    expect(added).toEqual([1]);
  });

  it('counts a tick that dispatched twice as two, so the counters stay additive', async () => {
    // Decision 8: everything a model does counts against every cap, and the cap is the thing standing between
    // an unattended loop and an unbounded bill — so an action that starts two runs must cost two iterations
    // rather than one. NO ACTION DOES THAT TODAY: every dispatching branch in act.ts returns 1, and the case
    // this used to name (a review dispatching the work and then a judge) went with the critic. It is the
    // contract for the number rather than a live path, which is exactly why it needs a test of its own.
    const { deps, added } = harness({
      states: [
        { ...running, iteration: 10 },
        { ...IDLE_STATE, state: 'stopped' },
      ],
      act: async (): Promise<ActResult> => ({ dispatches: 2 }),
    });
    const ended = await runLoop(deps);
    expect(added).toEqual([2]);
    expect(ended.iterations).toBe(2);
  });

  it('counts every dispatch against the caps, whatever it dispatched', async () => {
    // Decision 8: a critic and a checkup cost the same as work. `act` reports `dispatched`, and the loop does
    // not ask what kind of run it was.
    const { deps, added } = harness({
      states: [running, running, { ...IDLE_STATE, state: 'stopped' }],
      act: async (): Promise<ActResult> => ({ dispatches: 1 }),
    });
    await runLoop(deps);
    expect(added).toEqual([1, 1]);
  });

  it('stops when acting on a tick reveals a reason to', async () => {
    const { deps } = harness({
      states: [running],
      act: async (): Promise<ActResult> => ({
        dispatches: 1,
        stop: { reason: 'exhausted', detail: 'the budget went while this run was in flight' },
      }),
    });
    const ended = await runLoop(deps);
    expect(ended.reason).toBe('exhausted');
    expect(ended.iterations).toBe(1);
  });

  it('gives up on a refusal it cannot recover from, and retries one it can', async () => {
    const fatal = harness({
      states: [running],
      client: {
        board: async () => ({ ok: false, reason: 'refused with 401', fatal: true }),
        stopped: async () => ({ ok: true, value: {} }),
        log: async () => ({ ok: true, value: {} }),
      } as unknown as LoopDeps['client'],
    });
    expect((await runLoop(fatal.deps)).reason).toBe('stalled');

    // Transient: it looks again, and the second look works.
    let attempt = 0;
    const flaky = harness({
      states: [running, running, { ...IDLE_STATE, state: 'stopped' }],
      client: {
        board: async () => {
          attempt += 1;
          return attempt === 1
            ? { ok: false, reason: 'could not reach the board', fatal: false }
            : { ok: true, value: board() };
        },
        runs: async () => ({ ok: true, value: { runs: [] } }),
        stopped: async () => ({ ok: true, value: {} }),
        log: async () => ({ ok: true, value: {} }),
      } as unknown as LoopDeps['client'],
    });
    const ended = await runLoop(flaky.deps);
    expect(attempt).toBeGreaterThan(1);
    expect(ended.reason).toBe('stopped');
  });

  it('ends even when it cannot deliver its own last words', async () => {
    // A loop whose server has gone cannot report anything, and a process that will not die because it could
    // not say goodbye is worse than one that dies quietly.
    const said: string[] = [];
    const { deps } = harness({
      states: [{ ...IDLE_STATE, state: 'running' }],
      client: {
        board: async () => ({ ok: false, reason: 'refused with 401', fatal: true }),
        stopped: async () => ({ ok: false, reason: 'could not reach the board', fatal: false }),
        log: async () => ({ ok: false, reason: 'could not reach the board', fatal: false }),
      } as unknown as LoopDeps['client'],
      log: (message) => said.push(message),
    });
    const ended = await runLoop(deps);
    expect(ended.reason).toBe('stalled');
    expect(said.some((line) => line.includes('could not record the stop'))).toBe(true);
  });

  it('stops rather than going round in circles for ever', async () => {
    // A `wait` and a `stamp` — which is what a block is — consume no iteration and no budget, so NEITHER cap
    // bounds them: an action that cannot land would repeat at one tick per interval indefinitely. This is the
    // only thing that bounds it.
    // Counted here rather than through the harness's recorder, because this test replaces `act` — the
    // harness's list would stay empty and the assertion would pass on nothing.
    let tried = 0;
    const { deps } = harness({
      states: [running],
      act: async (): Promise<ActResult> => {
        tried += 1;
        return { dispatches: 0 };
      },
    });
    const ended = await runLoop(deps);
    expect(ended.reason).toBe('stalled');
    expect(ended.detail).toContain('without dispatching anything');
    expect(tried).toBeGreaterThan(1);
    // Bounded, not unbounded: the point is that it ends at all.
    expect(tried).toBeLessThan(1000);
  });
});
