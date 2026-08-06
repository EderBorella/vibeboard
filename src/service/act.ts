import { burnsAttempt } from '../core/accounting.js';
import { CRITIC_SKILL, type Route } from '../core/autopilot.js';
import type { StopReason } from '../core/dispatch-gate.js';
import type { RunRecord } from '../core/runs.js';
import type { TickAction } from '../core/tick.js';
import type { BoardName, Card } from '../core/types.js';
import { criticVerification, type Verification } from '../core/verify.js';
import { commitAll } from '../server/git-work.js';
import { verifyGates, verifySmoke } from '../server/verifier.js';
import type { BoardClient } from './board-client.js';
import type { ActResult, TickContext } from './loop.js';

// Carrying ONE action out. The decision was made by `decideTick`; this is the doing, and the order it does
// things in is the whole of it:
//
//   commit → dispatch → wait for the record to settle → verify → move or leave → record the verdict → diary
//
// Four rules, each of which is a decision rather than an implementation detail:
//
// 1. COMMIT FIRST (step 10). Committing before every dispatch is what makes an aborted, timed-out or plainly
//    wrong run one command from gone. A commit that FAILS stops the loop: the revert guarantee is the reason
//    this is safe to run unattended, and dispatching without it would be spending on a tree nobody can undo.
// 2. NOTHING MOVES ON SELF-ASSESSMENT (decision 3). The card moves when `verification.passed` is true and at
//    no other time. The run's own `outcome` — what the agent said about itself — is never read here.
// 3. THE CARD IS MOVED THROUGH THE ENDPOINT, and so is everything else this writes. The loop holds a
//    `service` credential and goes through the same validation as an agent (decision 10). Two exceptions,
//    both deliberate: the gate commands run in this process, because putting arbitrary command execution
//    behind an HTTP endpoint would be a far larger hole than the one it closes; and git runs here for the
//    same reason.
// 4. THE VERDICT IS WRITTEN TO THE RUN IT JUDGED (decision 18), so "why did this card advance?" is
//    answerable from disk long after the loop has gone.

export interface ActDeps {
  client: BoardClient;
  // The project root, for the two things that are not HTTP: git, and the gate commands.
  root: string;
  // The branch this session is working on, from `ensureBranch` at start-up. Passed to every commit so a
  // caller that ignored an `ensureBranch` refusal cannot commit a person's work under an agent's message.
  branch: string;
  now: () => Date;
  // What a critic's score must reach, from `autopilot.criticThreshold`. Passed in rather than re-read here:
  // the loop already holds the config it decided with, and reading it twice would let the bar a card was
  // judged against differ from the bar the tick compared.
  threshold: number;
  log?: (message: string) => void;
  // Seams, so every branch below is reachable without spawning an agent or running a project's test suite.
  verify?: {
    gates: typeof verifyGates;
    smoke: typeof verifySmoke;
  };
  commit?: typeof commitAll;
  // How long to keep asking whether a dispatched run has finished, and how often.
  settleTimeoutMs?: number;
  settlePollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const SETTLE_TIMEOUT_MS = 3_600_000; // an hour: a run's own timeout is half that by default
const SETTLE_POLL_MS = 2_000;

export async function performAction(
  deps: ActDeps,
  action: TickAction,
  context: TickContext,
): Promise<ActResult> {
  switch (action.kind) {
    case 'rollup':
      return await rollUp(deps, action.advance);
    case 'block':
      return await block(deps, action.card, action.to);
    case 'dispatch':
      return await dispatch(deps, action.card, action.route, context);
    // A `wait` is the one action with nothing to do: the loop sleeps and looks again.
    default:
      return { dispatches: 0 };
  }
}

// Parents completing from their children. No dispatch and no cost — each child was verified on its way to
// terminal, so there is nothing here to judge.
async function rollUp(deps: ActDeps, advance: { card: Card; to: string }[]): Promise<ActResult> {
  for (const { card, to } of advance) {
    const moved = await deps.client.move(card.board, card.id, to);
    if (!moved.ok) return refused(deps, `could not roll ${card.id} up to ${to}`, moved.reason, moved.fatal);
    await deps.client.log(
      'lifecycle',
      `${card.id} advanced to ${to}: every card under it is finished, so it completed without a run of its own.`,
    );
  }
  return { dispatches: 0 };
}

// An engineering card that has used every attempt. It stops being work and starts being something a person
// has to look at, which is what the blocked column is for.
async function block(deps: ActDeps, card: Card, to: string): Promise<ActResult> {
  const moved = await deps.client.move(card.board, card.id, to);
  if (!moved.ok) return refused(deps, `could not move ${card.id} to ${to}`, moved.reason, moved.fatal);
  await deps.client.log(
    'lifecycle',
    `${card.id} moved to ${to}: it has used every attempt allowed, so auto-pilot has stopped trying and left it for you.`,
  );
  return { dispatches: 0 };
}

async function dispatch(deps: ActDeps, card: Card, route: Route, context: TickContext): Promise<ActResult> {
  // RULE 1. Before anything is spent. A clean tree is ordinary and carries on; a FAILURE stops the loop,
  // because from here on nothing it does could be reverted in one command.
  const commit = (deps.commit ?? commitAll)(deps.root, commitMessage(card, route, context), {
    branch: deps.branch,
  });
  const committed = await commit;
  if (committed.reason !== undefined) {
    return stop(deps, 'stalled', `Auto-pilot stopped before dispatching ${card.id}: ${committed.reason}`);
  }

  const started = await deps.client.dispatch({ board: card.board, card: card.id, skill: route.skill });
  if (!started.ok) {
    return refused(deps, `could not dispatch ${route.skill} for ${card.id}`, started.reason, started.fatal);
  }

  const settled = await settle(deps, card.board, card.id, started.value.run.run);
  if (!settled) {
    return stop(
      deps,
      'stalled',
      `${card.id}'s ${route.skill} run did not finish within the time auto-pilot waits for one, so nothing can be said about it.`,
    );
  }

  // An ending nobody is answerable for: the user cancelled it, or a restart left it stale. No attempt is
  // burned (accounting.ts), the card does not move, and there is nothing to verify — the work never happened.
  if (!burnsAttempt(settled.status)) {
    await deps.client.log(
      'run',
      `${card.id}: ${route.skill} ended as ${settled.status}, so no attempt was used and the card has not moved.`,
    );
    return { dispatches: 1 };
  }

  const { verification, dispatches } = await verify(deps, card, route);
  // RULE 4: onto the run it judged, before the card moves. A card that advanced with no verdict recorded
  // beside it is a card nobody can explain afterwards.
  const recorded = await deps.client.verdict(card.board, card.id, settled.run, verification);
  if (!recorded.ok) {
    return refused(deps, `could not record the verdict on ${settled.run}`, recorded.reason, recorded.fatal);
  }

  // RULE 2. `verification.passed`, and nothing else — never `settled.outcome`, which is what the agent said
  // about its own work.
  if (verification.passed) {
    const moved = await deps.client.move(card.board, card.id, route.next);
    if (!moved.ok) {
      return refused(deps, `could not advance ${card.id} to ${route.next}`, moved.reason, moved.fatal);
    }
  }
  await deps.client.log('run', diaryLine(card, route, verification, context));
  return { dispatches: 1 + dispatches };
}

// How a run's work is judged. `gates` and `smoke` run commands declared in `foundation/`, in this process.
// `critic` dispatches a fresh agent whose only job is to score the work — which costs an iteration of its own
// (decision 8), reported back so the loop counts it.
async function verify(
  deps: ActDeps,
  card: Card,
  route: Route,
): Promise<{ verification: Verification; dispatches: number }> {
  const at = deps.now().toISOString();
  const verifier = deps.verify ?? { gates: verifyGates, smoke: verifySmoke };
  if (route.verify === 'gates') return { verification: await verifier.gates(deps.root, at), dispatches: 0 };
  if (route.verify === 'smoke') return { verification: await verifier.smoke(deps.root, at), dispatches: 0 };
  return await critique(deps, card, at);
}

// A judging run on the same card. Its own record carries `skill: 'critic'`, which is what keeps it out of the
// tally for the skill doing the work — `attemptsUsed` filters by skill, so without that a card would reach
// its cap twice as fast.
async function critique(
  deps: ActDeps,
  card: Card,
  at: string,
): Promise<{ verification: Verification; dispatches: number }> {
  const started = await deps.client.dispatch({ board: card.board, card: card.id, skill: CRITIC_SKILL });
  if (!started.ok) {
    // Fail closed: a critic that could not be dispatched has not judged anything, and absence is never a pass.
    return {
      verification: criticVerification(at, { threshold: 0, by: CRITIC_SKILL, reason: started.reason }),
      dispatches: 0,
    };
  }
  const settled = await settle(deps, card.board, card.id, started.value.run.run);
  if (!settled) {
    return {
      verification: criticVerification(at, {
        threshold: 0,
        by: CRITIC_SKILL,
        reason: 'the critic run did not finish within the time auto-pilot waits for one',
      }),
      dispatches: 1,
    };
  }
  // The critic's own record holds what it said; the judged run holds what came of it (decision 18). An ABSENT
  // score is not a zero — `criticVerification` refuses it rather than reading it as a judgement of worthless.
  return {
    verification: criticVerification(at, {
      threshold: deps.threshold,
      by: CRITIC_SKILL,
      ...(settled.score === undefined ? {} : { score: settled.score }),
      ...(settled.overshoot === undefined ? {} : { overshoot: settled.overshoot }),
    }),
    dispatches: 1,
  };
}

// Ask until it has finished. The record is the only place a run's ending is written, and it is written by the
// server — so this is polling by design rather than for want of an event: the loop is a separate process and
// has no channel of its own.
async function settle(
  deps: ActDeps,
  board: BoardName,
  card: string,
  run: string,
): Promise<RunRecord | undefined> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const timeout = deps.settleTimeoutMs ?? SETTLE_TIMEOUT_MS;
  // A COUNT of attempts rather than an accumulating total, and the poll floored at 1ms. Written as
  // `waited += poll` it spun for ever the moment a caller passed a poll interval of zero — `waited` never
  // advanced — which a test did within minutes of this being written. A loop whose bound depends on its
  // arguments being sensible is not bounded.
  const poll = Math.max(1, deps.settlePollMs ?? SETTLE_POLL_MS);
  const attempts = Math.max(1, Math.floor(Math.max(0, timeout) / poll) + 1);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const answer = await deps.client.cardRuns(board, card);
    if (answer.ok) {
      const found = answer.value.runs.find((r) => r.run === run);
      // `queued` and `running` are the two that have not ended. Everything else is an ending, including the
      // ones nobody is answerable for.
      if (found && found.status !== 'queued' && found.status !== 'running') return found;
    }
    await sleep(poll);
  }
  return undefined;
}

function commitMessage(card: Card, route: Route, context: TickContext): string {
  return `autopilot: before ${card.id} ${route.skill} (iteration ${context.iteration + 1})`;
}

// What a person reads afterwards. The verdict and its evidence, in one line, because the diary is the record
// of what happened rather than a log of what was attempted.
function diaryLine(card: Card, route: Route, verification: Verification, context: TickContext): string {
  const outcome = verification.passed ? `advanced to ${route.next}` : 'stayed where it is';
  const because = verification.reason ? ` ${verification.reason}` : '';
  return `Iteration ${context.iteration + 1}: ${card.id} ran ${route.skill}, ${route.verify} ${verification.passed ? 'passed' : 'failed'}, so it ${outcome}.${because}`;
}

// A refusal from the board. Reported to the diary where it can be, and fatal refusals end the loop: a loop
// that cannot move a card cannot make progress, and one whose credential is gone cannot do anything at all.
async function refused(deps: ActDeps, what: string, reason: string, fatal: boolean): Promise<ActResult> {
  deps.log?.(`${what}: ${reason}`);
  if (fatal) return { dispatches: 0, stop: { reason: 'stalled', detail: `${what}: ${reason}` } };
  await deps.client.log('note', `Auto-pilot ${what}: ${reason}`);
  return { dispatches: 0 };
}

async function stop(deps: ActDeps, reason: StopReason, detail: string): Promise<ActResult> {
  deps.log?.(detail);
  await deps.client.log('note', detail);
  return { dispatches: 0, stop: { reason, detail } };
}
