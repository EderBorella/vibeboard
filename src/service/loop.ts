import { sumSpend } from '../core/accounting.js';
import { DEFAULT_AUTOPILOT } from '../core/autopilot.js';
import type { AutopilotState } from '../core/autopilot-state.js';
import { boardColumnSlugs } from '../core/board.js';
import { type StopReason, stopSentence } from '../core/dispatch-gate.js';
import { decideTick, type TickAction } from '../core/tick.js';
import { BOARDS, type BoardName, type Card } from '../core/types.js';
import type { BoardClient, Failed } from './board-client.js';

// The loop, and it holds no decisions of its own. Every tick is: read the world, hand it to `decideTick`,
// carry the one action out, write down what happened. The reasoning is in `src/core/tick.ts`, which is pure
// — so this file is about SEQUENCING and nothing else, and the tests below it never need a process.
//
// Three rules it exists to enforce, each of which was a real failure somewhere:
//
// 1. THE STATE IS READ BEFORE EVERY TICK. A soft stop is a file written by another process, and a loop that
//    read the state once at startup would ignore it until it finished — which is the difference between a
//    stop control and a suggestion.
// 2. IT WRITES ONLY ITS OWN FIELDS (decision 20). The counters are the loop's; `state`, `reason` and
//    `detail` belong to the server, and the loop reports its ending through an ENDPOINT so the overlay and
//    the credential revocation happen where every other stop's do.
// 3. A REFUSAL IT CANNOT RECOVER FROM STOPS IT. A 401 means this loop's authority is gone; retrying is
//    spinning. Anything else is worth another tick, because a restarting server looks exactly like that.

// What the loop needs from the world, injected rather than imported so every branch below is reachable in a
// test without a filesystem, a clock or a process.
export interface LoopDeps {
  client: BoardClient;
  // The auto-pilot state, read from the file: decision 20's carve-out. Not over HTTP, because
  // `GET /autopilot/state` is admin-only and the counters are the loop's own.
  readState: () => Promise<AutopilotState>;
  // Read-modify-write over the loop's OWN fields. Given the current state, returns the fields to change.
  writeCounters: (change: Partial<AutopilotState>) => Promise<void>;
  // Carrying out one action. Task 8's `act.ts`; injected so this file's sequencing is testable on its own,
  // and so the loop cannot quietly grow a second place where work happens.
  act: (action: TickAction, context: TickContext) => Promise<ActResult>;
  // How long to wait when there is nothing to do but look again. Injected so tests do not sleep.
  wait: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export interface TickContext {
  iteration: number;
  columns: Record<BoardName, string[]>;
}

// What an action did, as far as the loop needs to know. `dispatched` is what moves the counters — decision
// 8: everything a model does counts, so a critic and a checkup increment them exactly as work does.
export interface ActResult {
  // HOW MANY runs this action started, not whether it started one. A `critic` route dispatches the work and
  // then a judge, and decision 8 says everything a model does counts against every cap — so a boolean here
  // would have let every critic-verified card cost one iteration instead of two.
  dispatches: number;
  // A reason to stop, when carrying the action out revealed one. `act` never decides to stop on its own —
  // it reports, and the next tick's `decideTick` sees the world the action left behind.
  stop?: { reason: StopReason; detail?: string };
}

// Why the loop ended. Returned rather than thrown so the caller — a process whose exit code nobody reads —
// can log it, and so the tests can assert it.
export interface LoopEnded {
  reason: StopReason;
  detail?: string;
  iterations: number;
}

// A hard bound on how many times a tick may do nothing before the loop calls it stuck.
//
// A `wait`, a `rollup` and a `block` all consume NO iteration and NO budget, so neither of the loop's two
// caps bounds them: an action that cannot land — a card the endpoint refuses to move, a blocked column that
// does not exist — would otherwise repeat for ever at one tick per interval, for ever being the operative
// word. The caps count dispatches, so this counts everything else.
const MAX_IDLE_TICKS = 240;

// How long to wait after a tick that dispatched nothing. Long enough not to spin on a board that is waiting
// for an agent, short enough that a soft stop is noticed promptly.
const IDLE_WAIT_MS = 5_000;

// How far the loop has got, carried between ticks. A record rather than two closure variables so the helpers
// below can advance it without each returning a tuple nobody reads.
interface Progress {
  iterations: number;
  // Consecutive ticks that dispatched nothing — see MAX_IDLE_TICKS.
  idle: number;
}

export async function runLoop(deps: LoopDeps): Promise<LoopEnded> {
  const progress: Progress = { iterations: 0, idle: 0 };

  for (;;) {
    // RULE 1. Every tick, before anything else: another process may have written a stop since the last one.
    const state = await deps.readState();
    if (state.state !== 'running') {
      // Not reported back — the server wrote this state, so telling it would be telling it what it said.
      return { reason: state.reason ?? 'stopped', detail: state.detail, iterations: progress.iterations };
    }

    const world = await gather(deps);
    if ('failed' in world) {
      const ended = await afterFailedRead(deps, world.failed, progress);
      if (ended) return ended;
      continue;
    }

    const action = decideTick({ ...world.input, state });
    if (action.kind === 'stop') {
      return await finish(deps, action.reason, action.detail, progress.iterations);
    }

    const ended = await carryOut(deps, action, state, world.input.columns, progress);
    if (ended) return ended;
  }
}

// A board that could not be read. Fatal means the loop's authority is gone and retrying is spinning;
// anything else looks exactly like a server restarting, which is worth another look.
async function afterFailedRead(
  deps: LoopDeps,
  failed: Failed,
  progress: Progress,
): Promise<LoopEnded | undefined> {
  if (failed.fatal) return await finish(deps, 'stalled', failed.reason, progress.iterations);
  deps.log?.(`could not read the board: ${failed.reason}`);
  await deps.wait(IDLE_WAIT_MS);
  progress.idle += 1;
  if (progress.idle < MAX_IDLE_TICKS) return undefined;
  return await finish(
    deps,
    'stalled',
    `The board could not be read ${progress.idle} times in a row. Last reason: ${failed.reason}`,
    progress.iterations,
  );
}

// One action, and what it costs. Answers with a `LoopEnded` when the run is over and `undefined` when it goes
// round again.
async function carryOut(
  deps: LoopDeps,
  action: TickAction,
  state: AutopilotState,
  columns: Record<BoardName, string[]>,
  progress: Progress,
): Promise<LoopEnded | undefined> {
  const result = await deps.act(action, { iteration: state.iteration, columns });
  if (result.dispatches > 0) {
    progress.iterations += result.dispatches;
    progress.idle = 0;
    // RULE 2: the loop's own fields, and only those. Read-modify-write, so the server's concurrent write of
    // `state` is preserved rather than clobbered.
    await deps.writeCounters({
      iteration: state.iteration + result.dispatches,
      dispatchesSinceCheckup: state.dispatchesSinceCheckup + result.dispatches,
    });
  } else {
    progress.idle += 1;
    if (progress.idle >= MAX_IDLE_TICKS) {
      return await finish(
        deps,
        'stalled',
        `Auto-pilot took ${progress.idle} ticks in a row without dispatching anything, so it is going round in circles rather than making progress. The last thing it tried was a ${action.kind}.`,
        progress.iterations,
      );
    }
    if (action.kind === 'wait') await deps.wait(IDLE_WAIT_MS);
  }
  if (result.stop) {
    return await finish(deps, result.stop.reason, result.stop.detail, progress.iterations);
  }
  return undefined;
}

// One consistent read of everything `decideTick` compares. Assembled here rather than inside the tick so the
// tick stays pure — and gathered in ONE place so a future caller cannot forget the `problems` list, which is
// what the setup barrier's honesty depends on.
async function gather(
  deps: LoopDeps,
): Promise<{ input: Omit<Parameters<typeof decideTick>[0], 'state'> } | { failed: Failed }> {
  const board = await deps.client.board();
  if (!board.ok) return { failed: board };
  const runs = await deps.client.runs();
  if (!runs.ok) return { failed: runs };

  const cards: Card[] = BOARDS.flatMap((name) => board.value.boards[name] ?? []);
  const columns = {} as Record<BoardName, string[]>;
  for (const name of BOARDS) columns[name] = boardColumnSlugs(board.value.config, name);

  return {
    input: {
      ap: board.value.config.autopilot ?? DEFAULT_AUTOPILOT,
      cards,
      columns,
      runs: runs.value.runs,
      // Summed from the same records the caps are compared against, rather than fetched separately: two
      // reads of one fact would let the budget be judged against a board that had moved on.
      spend: sumSpend(runs.value.runs),
      // Identities, not a count. `attemptsUsed` deliberately does not count an unfinished run, so the card
      // being worked stays eligible — and above a concurrency of one the pick would otherwise hand out the
      // same card twice.
      inFlight: runs.value.runs
        .filter((r) => r.status === 'queued' || r.status === 'running')
        .map((r) => ({ ...(r.card === undefined ? {} : { card: r.card }), skill: r.skill })),
      problems: board.value.problems,
    },
  };
}

// Report the ending through the server, then answer with it. The report is allowed to fail — a loop whose
// server has gone cannot tell it anything — and the loop still ends, because the alternative is a process
// that will not die because it cannot deliver its own last words.
async function finish(
  deps: LoopDeps,
  reason: StopReason,
  detail: string | undefined,
  iterations: number,
): Promise<LoopEnded> {
  const said = await deps.client.stopped(reason, detail);
  if (!said.ok) deps.log?.(`could not record the stop: ${said.reason}`);
  deps.log?.(stopSentence(reason, detail));
  return { reason, ...(detail === undefined ? {} : { detail }), iterations };
}
