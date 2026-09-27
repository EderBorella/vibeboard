import type { RunRecord } from '../../core/runs.js';
import type { Answer } from '../board-client.js';
import type { ActDeps } from './index.js';

// HOW LONG THE LOOP WAITS FOR A DISPATCHED RUN TO END, and the clamping that makes the wait terminate on any
// input. Its own module because the two paths that dispatch — the ordinary one and the review — both wait, and
// the review's is reached from the orchestrator, so putting this beside the orchestrator would make the review
// import a value out of the file that imports it.

const SETTLE_TIMEOUT_MS = 3_600_000; // an hour: a run's own timeout is half that by default
const SETTLE_POLL_MS = 2_000;

// Ceilings, so no configured or injected number can turn the wait into an unbounded one. A Mini run's wait
// (`untilEnded`) is the one without them, and it ends on a refusal that cannot recover instead. A day is longer than
// any run this design contemplates, and 100,000 polls is well past what a sane interval needs — both exist to
// make the loop terminate on absurd input rather than to express a preference.
const MAX_SETTLE_TIMEOUT_MS = 86_400_000;
const MAX_SETTLE_POLLS = 100_000;

// A number, or the default, clamped. `Number.isFinite` refuses NaN and both infinities in one test — which is
// the whole point: those are the three values that turn arithmetic into a loop that never ends or never runs.
function usable(value: number | undefined, fallback: number, low: number, high: number): number {
  const n = value === undefined || !Number.isFinite(value) ? fallback : value;
  return Math.min(high, Math.max(low, n));
}

// Ask until it has finished. The record is the only place a run's ending is written, and it is written by the
// server — so this is polling by design rather than for want of an event: the loop is a separate process and
// has no channel of its own.
//
// WHERE to look is the caller's, because a run does not always live beside a card. A card's runs come from the
// card route; a project run — the bootstrap — has no card in its path and is found in the project's whole list.
// Passed as a thunk rather than as a board/card pair so the card-less case is not an absence to interpret.
export async function settle(
  deps: ActDeps,
  run: string,
  look: () => Promise<Answer<{ runs: RunRecord[] }>>,
  // A Mini run has no time limit (decision 101): the runner ends it — an error, the Stop button, a silence —
  // and the wait follows it there rather than giving up first.
  opts: { untilEnded?: boolean } = {},
): Promise<RunRecord | undefined> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const timeout = deps.settleTimeoutMs ?? SETTLE_TIMEOUT_MS;
  // A COUNT of attempts rather than an accumulating total, and the poll floored at 1ms. Written as
  // `waited += poll` it spun for ever the moment a caller passed a poll interval of zero — `waited` never
  // advanced — which a test did within minutes of this being written. A loop whose bound depends on its
  // arguments being sensible is not bounded.
  // BOTH AXES, because fixing one left the other: an earlier version floored the poll and computed
  // `timeout / poll`, which is `Infinity` attempts for `settleTimeoutMs: Infinity` and `NaN` — so zero
  // iterations, a dispatch nobody ever looked at — for a `NaN` poll. Every input is now clamped to a finite
  // range before it can reach the arithmetic, and the attempt count has a hard ceiling of its own.
  const poll = usable(deps.settlePollMs, SETTLE_POLL_MS, 1, SETTLE_TIMEOUT_MS);
  const patience = usable(timeout, SETTLE_TIMEOUT_MS, 0, MAX_SETTLE_TIMEOUT_MS);
  const attempts = opts.untilEnded
    ? Number.POSITIVE_INFINITY
    : Math.min(MAX_SETTLE_POLLS, Math.max(1, Math.floor(patience / poll) + 1));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const answer = await look();
    if (answer.ok) {
      const found = answer.value.runs.find((r) => r.run === run);
      // `queued` and `running` are the two that have not ended. Everything else is an ending, including the
      // ones nobody is answerable for.
      if (found && found.status !== 'queued' && found.status !== 'running') return found;
    } else if (opts.untilEnded && answer.fatal) {
      // The loop's authority is gone — a server that died without its shutdown path took the token with it — and
      // an uncapped wait would ask for ever.
      return undefined;
    }
    await sleep(poll);
  }
  return undefined;
}
