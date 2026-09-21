import { sumSpend } from '../core/accounting.js';
import { DEFAULT_AUTOPILOT } from '../core/autopilot.js';
import type { AutopilotState } from '../core/autopilot-state.js';
// The PURE definition, not the re-export from the board reader: the loop reaches board state over HTTP and
// nothing here should give it an edge into the layer that reads the filesystem.
import { boardColumnSlugs } from '../core/board/columns.js';
import { type StopReason, stopSentence } from '../core/dispatch-gate.js';
import { decideTick, type TickAction } from '../core/tick.js';
import { BOARDS, type BoardName, type Card } from '../core/types.js';
import type { DeclaredCommands } from '../store/project/foundation.js';
import type { BoardClient, Failed } from './board-client.js';
import type { SatisfiedWorld } from './satisfied.js';

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
  // Called once when the loop ends, to commit whatever the last dispatch left behind — commits happen BEFORE
  // each dispatch, so the final agent's edits are uncommitted by construction and the next session's
  // `ensureBranch` would refuse the dirty tree.
  commitTail?: (reason: string) => Promise<void>;
  // The auto-pilot state, read from the file: decision 20's carve-out. Not over HTTP, because
  // `GET /autopilot/state` is admin-only and the counters are the loop's own.
  readState: () => Promise<AutopilotState>;
  // Add to the loop's OWN counters, inside a read-modify-write. RELATIVE rather than absolute so a value the
  // server has just reset cannot be resurrected from a state this tick read before the reset.
  addToCounters: (dispatches: number) => Promise<void>;
  // What the foundation documents declare they run, read off disk like the state above and for the same reason:
  // the tick compares two of these strings (ruling 66) and there is no route that serves them to a `service`
  // credential. FRESH EVERY TICK, never captured — an agent rewrites both documents while the loop runs, and
  // the whole point of the comparison is to see what the project says NOW.
  commands: () => Promise<DeclaredCommands>;
  // WHICH BREAK-DOWN CANDIDATE'S CRITERION ALREADY PASSES (decision 85), off the same disk the commands
  // above come from and for the same reason: there is no route that runs a command for a `service`
  // credential, and the tick may not spawn anything. FRESH EVERY TICK like the commands — what it caches,
  // and what makes that safe, is `satisfied.ts`'s own business rather than this file's.
  satisfied: (world: SatisfiedWorld) => Promise<string[]>;
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
// 8: everything a model does counts, so a review and a checkup increment them exactly as work does.
export interface ActResult {
  // HOW MANY runs this action started, not whether it started one. NO ACTION DISPATCHES MORE THAN ONCE
  // TODAY — every dispatching branch in act.ts returns 1, so the accumulation below is reachable only with
  // a 1 — and the claim this replaces ("a review dispatches the work and then a judge") was true of the
  // critic route, which has retired.
  //
  // A number rather than a boolean so the counters stay ADDITIVE, which is decision 8: everything a model
  // does counts against every cap, so an action that ever starts two runs has to cost two iterations
  // instead of one. A boolean would make that a change to the loop rather than to the action.
  dispatches: number;
  // A reason to stop, when carrying the action out revealed one — a commit that failed, a board write that
  // was refused: things `decideTick` cannot see because they happened while the action was being carried out.
  //
  // IT USED TO SAY `act` NEVER DECIDES TO STOP ON ITS OWN, and decision 74 is the exception that makes that
  // false rather than merely strained. The review gate IS act deciding, and there is no next tick for
  // `decideTick` to see the world in. It is here and not there because `decideTick` is given a board, and a
  // board of freshly-derived features looks exactly like one derived last week — see the decision row for
  // what that costs as well as what it buys.
  stop?: { reason: StopReason; detail?: string };
  // A SEND-BACK THIS ACTION HAD NOWHERE TO RECORD, by card id (decision 82). A story's gates failed and the
  // card carries no run of any kind — no work run, because it arrived with every task under it already
  // settled and so was never implemented, and no review run, because the gates run before the judge is
  // dispatched. Nothing on disk says it happened, so the loop carries it to the next `decideTick`, which
  // routes the story to its fix on it.
  //
  // NOT a decision: `act` reports what it did and could not do, exactly as `dispatches` does. Which row the
  // machine is in is still the tick's answer.
  unrecordedSendBack?: string;
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
// A `wait` and a `stamp` both consume NO iteration and NO budget, so neither of the loop's two caps bounds
// them: an action that cannot land — a card the endpoint refuses to move, a column that does not exist —
// would otherwise repeat for ever at one tick per interval, for ever being the operative word. The caps
// count dispatches, so this counts everything else.
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
  // The send-backs `act` had nowhere to write down — see `unrecordedSendBacks` on `TickInput`. IN MEMORY AND
  // NOWHERE ELSE, deliberately: it is true of exactly one tick, because the fix it buys is itself a record
  // and every judgement after that lands on one. A loop restarted inside that window re-runs the gates once
  // and arrives at the same place, which is the cost of not inventing a state file for a fact with a
  // one-tick life (decision 39's rule about not storing the position, one size down).
  unrecorded: Set<string>;
}

export async function runLoop(deps: LoopDeps): Promise<LoopEnded> {
  const progress: Progress = { iterations: 0, idle: 0, unrecorded: new Set() };

  for (;;) {
    // RULE 1. Every tick, before anything else: another process may have written a stop since the last one.
    const state = await deps.readState();
    if (state.state !== 'running') {
      // Not reported back — the server wrote this state, so telling it would be telling it what it said.
      return { reason: state.reason ?? 'stopped', detail: state.detail, iterations: progress.iterations };
    }

    const world = await gather(deps, progress.unrecorded);
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
  // UNCONDITIONALLY, before the branch below reads `dispatches`: what act could not write down is true
  // whatever the action spent, and hanging it off either branch would tie it to a number it has nothing to
  // do with.
  if (result.unrecordedSendBack !== undefined) progress.unrecorded.add(result.unrecordedSendBack);
  if (result.dispatches > 0) {
    progress.iterations += result.dispatches;
    progress.idle = 0;
    // RULE 2: the loop's own fields, and only those. Read-modify-write, so the server's concurrent write of
    // `state` is preserved rather than clobbered.
    // RELATIVE, not computed from the state read at the top of this tick. Written as absolutes, a Restart
    // landing mid-dispatch was undone: the reset wrote `iteration: 0`, then this merged `250 + 1` over it from
    // a value read before the reset, and the project came back `idle` with 251 — instantly capped on something
    // the user had just cleared. It also closes the documented lost-increment window in the other direction.
    await deps.addToCounters(result.dispatches);
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
    // EVERY non-dispatching tick, not only a `wait`. A `stamp` whose move is refused non-fatally came
    // straight back round, so the backstop below was reached in seconds rather than the interval it implies —
    // and each pass wrote another `note`, flooding the diary the checkup has to read.
    await deps.wait(IDLE_WAIT_MS);
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
  // Carried in rather than read here, because it is the only thing the tick is told that came from the loop
  // itself rather than from the world — see `Progress.unrecorded`.
  unrecorded: ReadonlySet<string>,
): Promise<{ input: Omit<Parameters<typeof decideTick>[0], 'state'> } | { failed: Failed }> {
  const board = await deps.client.board();
  if (!board.ok) return { failed: board };
  const runs = await deps.client.runs();
  if (!runs.ok) return { failed: runs };

  const cards: Card[] = BOARDS.flatMap((name) => board.value.boards[name] ?? []);
  const columns = {} as Record<BoardName, string[]>;
  for (const name of BOARDS) columns[name] = boardColumnSlugs(board.value.config, name);
  const ap = board.value.config.autopilot ?? DEFAULT_AUTOPILOT;
  // Read in the same gather as the board, so the commands the tick compares are the ones declared while
  // this board was true.
  const commands = await deps.commands();
  // Hoisted out of the input below because the criterion check reads it too: a run in flight means the tick
  // is about to wait, and measuring a criterion against a tree an agent is editing is both wasted and wrong
  // (see `satisfied.ts`). One list, so the two cannot be told different things about one board.
  const inFlight = runs.value.runs
    .filter((r) => r.status === 'queued' || r.status === 'running')
    .map((r) => ({ ...(r.card === undefined ? {} : { card: r.card }), skill: r.skill }));

  return {
    input: {
      ap,
      cards,
      columns,
      runs: runs.value.runs,
      // Summed from the same records the caps are compared against, rather than fetched separately: two
      // reads of one fact would let the budget be judged against a board that had moved on.
      spend: sumSpend(runs.value.runs),
      // Identities, not a count. `attemptsUsed` deliberately does not count an unfinished run, so the card
      // being worked stays eligible — and above a concurrency of one the pick would otherwise hand out the
      // same card twice.
      inFlight,
      problems: board.value.problems,
      commands,
      unrecordedSendBacks: [...unrecorded],
      // AFTER the board and the commands and from both, because that is what it is about: the story this
      // board says the machine is in the middle of, and the gates this project says it runs. A command is
      // spawned only where those two meet on a break-down candidate.
      satisfied: await deps.satisfied({
        cards,
        commands,
        inFlight,
        ...(ap.focus === undefined ? {} : { focus: ap.focus }),
      }),
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
  // What the last dispatch left, before anything else: a tree left dirty is a project whose next session is
  // refused, and by then nobody remembers why.
  await deps.commitTail?.(reason);
  // EVERY STOP IN THE DIARY, with its reason. The spec's diary section lists `lifecycle` as "pre-flight,
  // approval, every stop with its reason", and nothing was writing any of them — so the checkup, whose primary
  // input this is, could not see that the previous session had ended at all, let alone why.
  await deps.client.log('lifecycle', `Auto-pilot stopped: ${stopSentence(reason, detail)}`, {
    outcome: reason,
    iteration: iterations,
  });
  const said = await deps.client.stopped(reason, detail);
  if (!said.ok) deps.log?.(`could not record the stop: ${said.reason}`);
  deps.log?.(stopSentence(reason, detail));
  return { reason, ...(detail === undefined ? {} : { detail }), iterations };
}
