import { phase } from '../../core/phases.js';
import { setupSubtreeIds } from '../../core/setup-feature.js';
import { BOARDS, type Card } from '../../core/types.js';
import type { Verification } from '../../core/verify.js';
import { verifyGates } from '../../server/verifier.js';
import type { ActResult, TickContext } from '../loop.js';
import { stamp } from '../stamp.js';
import { refuseWhileGateDocumentUnread } from './checkup.js';
import type { ActDeps } from './index.js';
import { refused, stop } from './refusals.js';
import { gatesLine, inconclusiveLine, reviewLine } from './sentences.js';
import { settle } from './settle.js';

// WHETHER THIS CARD IS IN THE SETUP SUBTREE, asked of the board the loop can already read. It is the loop's
// question and not the card's: told by the card, an absent gate set would be something a card could claim.
//
// A board it could not read is treated as OUTSIDE the subtree, which is the fail-closed direction — being
// wrong the other way excuses an absent gate set for a card nobody chose (decision 51).
export async function inSetup(deps: ActDeps, card: Card): Promise<boolean> {
  const board = await deps.client.board();
  if (!board.ok) return false;
  const cards = BOARDS.flatMap((b) => board.value.boards[b] ?? []);
  return setupSubtreeIds(cards).has(card.id);
}

// A gates verdict carrying NO command is one where no command was RUN: the set was absent, empty or would not
// parse (core/verify.ts). That is the only shape the setup exception recognises — a test runner that is
// installed and red carries its own command and is an ordinary send-back.
const nothingRan = (gates: Verification): boolean => gates.command === undefined;

// THE REVIEW PHASE, in two steps and in that order (decision 51).
//
// 1. THE LOOP RUNS THE GATES, in this process, and they fail closed: a missing or empty gate set fails, and a
//    gate that cannot run is a failure rather than a skip. A failure is a send-back carrying the command's own
//    output, with no model dispatched and no tokens spent. A gate is a command with an exit code — the most
//    deterministic thing in this design — and handing it to an agent would make a settled fact a judgement.
// 2. ONLY IF THEY PASS, a `review` run judges what they cannot express: does this do what the card asked. A
//    gate proves the suite passes; it cannot prove the suite tests the criterion the card states.
//
// AND THE SECURITY GATE THAT MOVES WITH THE EXECUTION. Until now the only thing between an agent-rewritten
// `foundation/CODE-QUALITY.md` and its commands running unsandboxed as this user was the refusal on
// `POST /api/runs`, which worked precisely because gate commands ran AFTER a dispatch the endpoint could
// refuse. Running them first takes that refusal out from in front of them, so the loop refuses to run any gate
// command at all while a gate document is unread, and stops saying so.
export async function reviewTask(
  deps: ActDeps,
  card: Card,
  workRun: string | undefined,
  opts: { setupSubtree?: boolean },
  context: TickContext,
): Promise<ActResult> {
  const p = phase('task-review');
  if (workRun === undefined) {
    // Unreachable through the loop — `decideTick` produces no review action without a run to judge — but a
    // verdict has to land on a run, and inventing one would be worse than stopping.
    return stop(
      deps,
      'stalled',
      `${card.id} is in review with no run to judge, so there is nothing auto-pilot can say about it.`,
    );
  }
  const unread = await refuseWhileGateDocumentUnread(deps);
  if (unread) return unread;
  const gates = await (deps.verify?.gates ?? verifyGates)(deps.root, deps.now().toISOString());
  // THE ONE NARROW EXCEPTION, narrow in two ways: only in the setup subtree, and only for a gate set that was
  // never run. Installing the toolchain and the test runner is what a setup card is FOR, so it has no gates to
  // pass — and the reviewer is told to judge by reading instead.
  if (!gates.passed && !(opts.setupSubtree === true && nothingRan(gates))) {
    return await recordVerdict(deps, card, workRun, gates, p.exitFail, {
      why: 'its gates failed, so it goes back to be fixed.',
      line: gatesLine(card, gates),
      dispatches: 0,
      // NO ITERATION: nothing was dispatched, so the count this line is filed under is the one already spent.
      iteration: context.iteration,
    });
  }
  return await judge(deps, card, workRun, opts.setupSubtree === true, context);
}

// The model half, reached only once the deterministic half has passed.
async function judge(
  deps: ActDeps,
  card: Card,
  workRun: string,
  setupSubtree: boolean,
  context: TickContext,
): Promise<ActResult> {
  const p = phase('task-review');
  const skill = p.skill;
  if (skill === undefined) return { dispatches: 0 };
  const started = await deps.client.dispatch({
    board: card.board,
    card: card.id,
    skill,
    previous: workRun,
    // `gatesPassed` is true for the excused case too: the gate STEP passed, and which of the two happened is
    // what `setupSubtree` says. The prompt renders the setup wording in preference, so it never claims a
    // suite is green when there was none to run.
    review: { gatesPassed: true, setupSubtree },
  });
  if (!started.ok) {
    return await refused(deps, `could not dispatch ${card.id}'s review`, started.reason, started.fatal);
  }
  const settled = await settle(deps, started.value.run.run, () => deps.client.cardRuns(card.board, card.id));
  if (!settled) {
    return stop(
      deps,
      'stalled',
      `${card.id}'s review did not finish within the time auto-pilot waits for one, so nothing can be said about it and it has been left in review.`,
    );
  }
  // AN INCONCLUSIVE REVIEW: it ended and decided nothing. No verdict to write and no move to make — "no
  // answer" is not an answer (decision 40), and `decideTick` counts these and is the one place that gives up.
  if (settled.verdict === undefined) {
    await deps.client.log('run', inconclusiveLine(card, settled, context), {
      iteration: context.iteration + 1,
      card: card.id,
      board: card.board,
      skill,
      outcome: settled.status,
    });
    return { dispatches: 1 };
  }
  const passed = settled.verdict === 'done';
  const verification: Verification = {
    mode: 'review',
    passed,
    at: deps.now().toISOString(),
    // The run that did the judging, so its reasoning is one lookup away rather than a correlation by
    // timestamp — and its summary, so a `fix` is handed the finding rather than told to go and look.
    by: settled.run,
    ...(settled.summary ? { reason: settled.summary } : {}),
  };
  return await recordVerdict(deps, card, workRun, verification, passed ? p.exitPass : p.exitFail, {
    why: passed ? 'its review passed it.' : 'its review sent it back with findings.',
    line: reviewLine(card, settled, passed, context),
    dispatches: 1,
    iteration: context.iteration + 1,
  });
}

// A VERDICT WRITTEN ONTO THE RUN IT JUDGES, and then the move that verdict decides. One function for both
// kinds — a gate's and a reviewer's — because the ORDER is the behaviour and must not be written twice: the
// verdict is recorded first, so a card that moved is always a card whose reason is on disk.
async function recordVerdict(
  deps: ActDeps,
  card: Card,
  workRun: string,
  verification: Verification,
  to: string | undefined,
  what: { why: string; line: string; dispatches: number; iteration: number },
): Promise<ActResult> {
  const recorded = await deps.client.verdict(card.board, card.id, workRun, verification);
  if (!recorded.ok) {
    return refused(
      deps,
      `could not record the verdict on ${workRun}`,
      recorded.reason,
      recorded.fatal,
      what.dispatches,
    );
  }
  if (to !== undefined) {
    const stamped = await stamp(deps, card, to, what.why);
    if (!stamped.ok) {
      return refused(
        deps,
        `could not move ${card.id} to ${to}`,
        stamped.reason,
        stamped.fatal,
        what.dispatches,
      );
    }
  }
  await deps.client.log('run', what.line, {
    iteration: what.iteration,
    card: card.id,
    board: card.board,
    skill: phase('task-review').skill,
  });
  return { dispatches: what.dispatches };
}
