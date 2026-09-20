import { phase } from '../../core/phases.js';
import { setupSubtreeIds } from '../../core/setup-feature.js';
import { BOARDS, type Card } from '../../core/types.js';
import type { Verification } from '../../core/verify.js';
import { verifyGates } from '../../exec/verify.js';
import type { ActResult, TickContext } from '../loop.js';
import { stamp } from '../stamp.js';
import { CHECKUP_PHASES, checkupEvidence, refuseWhileGateDocumentUnread } from './checkup.js';
import type { ActDeps, Dispatch } from './index.js';
import { refused, stop } from './refusals.js';
import { failedRunLine, gatesLine, inconclusiveLine, reviewLine } from './sentences.js';
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

// THE STORY'S JUDGEMENT, in two steps and in that order (decision 51, moved up to the story by decision 80).
//
// 1. THE LOOP RUNS THE GATES, in this process, and they fail closed: a missing or empty gate set fails, and a
//    gate that cannot run is a failure rather than a skip. A failure is a send-back carrying the command's own
//    output, with no model dispatched and no tokens spent. A gate is a command with an exit code — the most
//    deterministic thing in this design — and handing it to an agent would make a settled fact a judgement.
// 2. ONLY IF THEY PASS, a `review-story` run judges what they cannot express: do the tasks under this story
//    compose into the story it describes. A gate proves the suite passes; it cannot prove the suite tests the
//    criterion the card states, and nothing mechanical can see that task 3 undid task 1.
//
// ONCE PER STORY, WHICH IS WHY IT IS DETERMINISTIC AT ALL. Measured over 219 dispatches: 41 of 77 task reviews
// re-ran the gates unprompted and 36 did not, so what a gate meant depended on which agent you drew. Running
// them here, at the boundary, is what removes that.
//
// AND THE SECURITY GATE THAT MOVES WITH THE EXECUTION. Until decision 51 the only thing between an
// agent-rewritten `foundation/CODE-QUALITY.md` and its commands running unsandboxed as this user was the
// refusal on `POST /api/runs`, which worked precisely because gate commands ran AFTER a dispatch the endpoint
// could refuse. Running them first takes that refusal out from in front of them, so the loop refuses to run
// any gate command at all while a gate document is unread, and stops saying so.
export async function reviewStory(
  deps: ActDeps,
  action: Dispatch,
  card: Card,
  opts: { setupSubtree?: boolean },
  context: TickContext,
): Promise<ActResult> {
  const p = phase('story-review');
  const unread = await refuseWhileGateDocumentUnread(deps);
  if (unread) return unread;
  const gates = await (deps.verify?.gates ?? verifyGates)(deps.root, deps.now().toISOString());
  // THE ONE NARROW EXCEPTION, narrow in two ways: only in the setup subtree, and only for a gate set that was
  // never run. Installing the toolchain and the test runner is what a setup card is FOR, so it has no gates to
  // pass — and the judge is told to judge by reading instead.
  if (!gates.passed && !(opts.setupSubtree === true && nothingRan(gates))) {
    return await recordVerdict(deps, card, action.previous, gates, p.exitFail, {
      why: 'its gates failed, so it goes back to be fixed.',
      line: gatesLine(card, gates),
      dispatches: 0,
      // NO ITERATION: nothing was dispatched, so the count this line is filed under is the one already spent.
      iteration: context.iteration,
    });
  }
  return await judge(deps, action, card, opts.setupSubtree === true, context);
}

// The model half, reached only once the deterministic half has passed.
//
// NO `previous` ON THE DISPATCH, and that is the difference from the task review it replaces. `previous`
// renders the "you are judging ONE run" contract, which is exactly the frame this decision removes: the
// subject is the STORY and everything settled beneath it, not one agent's turn. The run the verdict is
// WRITTEN onto is a separate question, and it is `action.previous` — the two were one value while the two
// questions had one answer.
async function judge(
  deps: ActDeps,
  action: Dispatch,
  card: Card,
  setupSubtree: boolean,
  context: TickContext,
): Promise<ActResult> {
  const p = phase('story-review');
  const skill = p.skill;
  if (skill === undefined) return { dispatches: 0 };
  const gathered = CHECKUP_PHASES.includes(action.phase)
    ? await checkupEvidence(deps, action, card, context)
    : {};
  if (gathered.refused) return gathered.refused;
  const started = await deps.client.dispatch({
    board: card.board,
    card: card.id,
    skill,
    // `gatesPassed` is true for the excused case too: the gate STEP passed, and which of the two happened is
    // what `setupSubtree` says. The prompt renders the setup wording in preference, so it never claims a
    // suite is green when there was none to run.
    review: { gatesPassed: true, setupSubtree },
    ...(gathered.evidence === undefined ? {} : { checkup: gathered.evidence }),
  });
  if (!started.ok) {
    return await refused(deps, `could not dispatch ${card.id}'s review`, started.reason, started.fatal);
  }
  const settled = await settle(deps, started.value.run.run, () => deps.client.cardRuns(card.board, card.id));
  if (!settled) {
    return stop(
      deps,
      'stalled',
      `${card.id}'s review did not finish within the time auto-pilot waits for one, so nothing can be said about it and it has been left open.`,
    );
  }
  // A `failed` RUN NEVER ADVANCES ITS CARD — decision 40's third clause, asserted here because this path
  // bypasses `afterCardRun`, which asserts it for every other phase. The worst case that clause names is
  // exactly this one and decision 80 made it the ordinary one: `exitPass` is `done`, so a dead judgement
  // would CLOSE the story. A run the clock killed after it wrote a report has a verdict, so reading one is
  // not evidence that the judging finished.
  if (settled.status === 'failed') {
    await deps.client.log('run', failedRunLine(card, action, settled, context), {
      iteration: context.iteration + 1,
      card: card.id,
      board: card.board,
      skill,
      outcome: settled.status,
    });
    return { dispatches: 1 };
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
  return await recordVerdict(deps, card, action.previous, verification, passed ? p.exitPass : p.exitFail, {
    why: passed ? 'its review passed it.' : 'its review sent it back with findings.',
    line: reviewLine(card, settled, passed, context),
    dispatches: 1,
    iteration: context.iteration + 1,
  });
}

// A VERDICT WRITTEN ONTO THE RUN IT JUDGES, and then the move that verdict decides. One function for both
// kinds — a gate's and a judge's — because the ORDER is the behaviour and must not be written twice: the
// verdict is recorded first, so a card that moved is always a card whose reason is on disk.
//
// `workRun` IS OPTIONAL, and the absent case is real rather than defensive: a story whose tasks were made by
// hand, or one that skipped its break-down because it arrived with them attached, has no work run of its own
// (`judgeStory` in core/lifecycle/tick.ts dispatches it anyway rather than leaving it unsettled for ever).
// There is then nowhere to record a verdict, so the move is made on its own — a pass closes the story exactly
// as the story checkup used to, and a send-back is caught by the review total, which is the bound written for
// a verdict that cannot be recorded.
async function recordVerdict(
  deps: ActDeps,
  card: Card,
  workRun: string | undefined,
  verification: Verification,
  to: string | undefined,
  what: { why: string; line: string; dispatches: number; iteration: number },
): Promise<ActResult> {
  if (workRun !== undefined) {
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
  }
  // AND ONLY WHERE THE CARD IS NOT THERE ALREADY. A send-back's destination is the column the story is
  // judged from, so a refused story is told to move to where it is standing — a write for nothing and a
  // diary line about an event that did not happen, which is the same care `stampEntry` takes one file over.
  if (to !== undefined && card.columnSlug !== to) {
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
    skill: phase('story-review').skill,
  });
  return { dispatches: what.dispatches };
}
