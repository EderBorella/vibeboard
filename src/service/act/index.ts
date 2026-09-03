import type { TickAction } from '../../core/actions.js';
import type { AutopilotState } from '../../core/autopilot-state.js';
import { phase } from '../../core/phases.js';
import { commitAll } from '../../exec/git-work.js';
import type { verifyGates, verifySmoke } from '../../exec/verify.js';
import type { BoardClient, DispatchRequest } from '../board-client.js';
import type { ActResult, TickContext } from '../loop.js';
import { stamp } from '../stamp.js';
import { afterProjectRun } from './bootstrap.js';
import { CHECKUP_PHASES, type CheckupEvidence, checkupEvidence } from './checkup.js';
import { afterCardRun, countsTheBoard, liveCount } from './outcomes.js';
import { refused, stop } from './refusals.js';
import { inSetup, reviewTask } from './review.js';
import { commitMessage } from './sentences.js';
import { settle } from './settle.js';

// Carrying ONE action out. The decision was made by `decideTick`; this is the doing, and it has TWO paths.
//
// THE ORDINARY DISPATCH, which is every phase but one:
//
//   commit → stamp the entry column → dispatch → wait for the record to settle → stamp the exit column → diary
//
// AND THE REVIEW, which is deterministic first (decision 51) and so does not take that path at all:
//
//   commit → run the gates HERE, in this process → send-back with the command's own output if they fail
//          → only if they pass, dispatch a `review` run → write its verdict onto the run it judged → stamp
//
// Four rules, each of which is a decision rather than an implementation detail:
//
// 1. COMMIT FIRST (step 10). Committing before every dispatch is what makes an aborted, timed-out or plainly
//    wrong run one command from gone. A commit that FAILS stops the loop: the revert guarantee is the reason
//    this is safe to run unattended, and dispatching without it would be spending on a tree nobody can undo.
// 2. NOTHING MOVES ON SELF-ASSESSMENT (decision 3, amended by decision 40). What makes that hold is NOT that
//    the loop reads a status the agent did not write — `withReport` copies `status` straight out of the
//    agent's `outcome` (core/runs.ts), so for every run that delivered a report they are the same value. It
//    is three narrower facts:
//      * the only outcomes an agent MAY write are `success` and `attention`, and this code treats them
//        identically — it advances on the phase having completed, not on which was claimed, so the claim
//        cannot change where the card goes;
//      * VibeBoard OVERRIDES the status on timeout and on cancellation, in the runner, where the agent has
//        no say;
//      * a `failed` run NEVER advances its card, which is asserted on its own (see `recordFailedRun` in
//        outcomes.ts) because "it produced nothing" does not cover a run that died after touching one file.
//    What judges the work itself is the `task-review` phase, which is a separate run with no authority over
//    the card it judges.
// 3. THE CARD IS MOVED THROUGH THE ENDPOINT, and so is everything else this writes. The loop holds a
//    `service` credential and goes through the same validation as an agent (decision 10). Two exceptions,
//    both deliberate: the gate and smoke commands run in this process, because putting arbitrary command
//    execution behind an HTTP endpoint would be a far larger hole than the one it closes; and git runs here
//    for the same reason.
// 4. EVERY COLUMN STAMP GOES THROUGH `stamp.ts`, so no second way to move a card can grow here.
//
// THE VERIFICATION THAT LIVES HERE, since decision 51 moved the deterministic half of the review into the
// loop. Three kinds of verdict are written from this directory, and the modes are deliberate rather than tidy:
//
//   `gates`  — the gate commands, run here, failing closed; and the two correctness refusals that write the
//              same mode because they are the loop's own check: a run that left NOTHING behind, and a
//              card-only phase whose board did not grow;
//   `review` — what the `review` run answered, written onto the run it judged (ruling 57).
//
// It also runs the SMOKE command before a feature checkup and hands the result over as evidence (ruling 55).
// Both commands are refused outright while a gate document is unread — see `refuseWhileGateDocumentUnread` in
// checkup.ts, which is in front of every spawn in here.
//
// THE MODULES, and the boundary each one draws: `checkup.ts` is what a checkup is told and the one gate-document
// refusal; `outcomes.ts` is what a settled card run earned; `bootstrap.ts` is the tail of the one run with no
// card; `review.ts` is the deterministic-gates-then-model path; `sentences.ts` is every sentence a person reads
// afterwards; `settle.ts` and `refusals.ts` are the two things every path here needs. `act.ts` beside this
// directory is the barrel every importer still points at.

// Committing whatever the last dispatch left behind. Called once when the loop ends, and it is what makes a
// SECOND session possible: commits happen before each dispatch, so the final agent's edits are uncommitted by
// construction — and the next day `ensureBranch` refuses a dirty tree, while the same day is worse, because the
// branch name matches and run two's first commit sweeps run one's tail in under another card's message.
export async function commitTail(deps: ActDeps, reason: string): Promise<void> {
  const done = await (deps.commit ?? commitAll)(deps.root, `autopilot: ${reason} — the last run's work`, {
    branch: deps.branch,
  });
  if (done.reason !== undefined) deps.log?.(`could not commit what the last run left: ${done.reason}`);
}

export interface ActDeps {
  client: BoardClient;
  // The project root, for the two things that are not HTTP: git, and the gate commands.
  root: string;
  // The branch this session is working on, from `ensureBranch` at start-up. Passed to every commit so a
  // caller that ignored an `ensureBranch` refusal cannot commit a person's work under an agent's message.
  branch: string;
  now: () => Date;
  // THE GATE-DOCUMENT APPROVAL, read at the moment the commands would run rather than once at start-up. An
  // agent may rewrite `foundation/CODE-QUALITY.md` mid-session, and a value captured earlier would be a
  // refusal about a state that has already changed. Required rather than optional: an absent reader would
  // default to running whatever is in the file, which is the hole this exists to close.
  state: () => Promise<Pick<AutopilotState, 'unreviewedGates'>>;
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

export async function performAction(
  deps: ActDeps,
  action: TickAction,
  context: TickContext,
): Promise<ActResult> {
  switch (action.kind) {
    case 'stamp':
      return await stampOnly(deps, action);
    case 'dispatch':
      return await dispatch(deps, action, context);
    // A `wait` is the one action with nothing to do: the loop sleeps and looks again. A `stop` never reaches
    // here — the loop returns on it before carrying anything out.
    default:
      return { dispatches: 0 };
  }
}

type Stamp = Extract<TickAction, { kind: 'stamp' }>;
export type Dispatch = Extract<TickAction, { kind: 'dispatch' }>;

// A move the loop makes with no run behind it: the two break-down skips, the re-stamp of a task whose verdict
// was already decided, and a task that has used every fix attempt. No dispatch and no cost — the judgement
// either already happened or was never needed.
async function stampOnly(deps: ActDeps, action: Stamp): Promise<ActResult> {
  const moved = await stamp(deps, action.card, action.to, action.why);
  if (!moved.ok) {
    return refused(deps, `could not move ${action.card.id} to ${action.to}`, moved.reason, moved.fatal);
  }
  return { dispatches: 0 };
}

// WHAT IS DISPATCHED, in one place. A card run names its card and may carry the run whose findings it is
// addressing; a project run names neither, because the card it would be about is the thing it exists to
// create.
function requestFor(action: Dispatch, checkup?: CheckupEvidence): DispatchRequest {
  const card = action.card;
  if (!card) return { project: true, skill: action.skill };
  return {
    board: card.board,
    card: card.id,
    skill: action.skill,
    ...(action.previous === undefined ? {} : { previous: action.previous }),
    ...(checkup === undefined ? {} : { checkup }),
  };
}

// THE ENTRY STAMP, and only where the phase names one. `task-review` and `task-fix` name none because the
// card is already where they want it, and a move to where a card already is would be a write for nothing —
// and a diary line about an event that did not happen. The bootstrap names none because it has no card.
//
// AND ONLY WHERE THE CARD IS NOT THERE ALREADY, which the phase table cannot express: a break-down RETRY has
// the same entry column as the attempt before it, so the card is already in `todo` and this wrote "moved to
// todo" into the diary for a non-event — which is the very thing the paragraph above says the design avoids.
async function stampEntry(deps: ActDeps, action: Dispatch): Promise<ActResult | undefined> {
  const card = action.card;
  const entry = phase(action.phase).entry;
  if (!card || entry === undefined || card.columnSlug === entry) return undefined;
  const stamped = await stamp(deps, card, entry, `auto-pilot is starting its ${action.phase} phase.`);
  if (stamped.ok) return undefined;
  return await refused(deps, `could not move ${card.id} to ${entry}`, stamped.reason, stamped.fatal);
}

// One dispatch, card or project. The two differ in exactly three places and share everything else, so they
// are one function rather than two that drift: a project run has no card to stamp, no card to write a verdict
// beside, and its own list rather than a card's to be found in.
async function dispatch(deps: ActDeps, action: Dispatch, context: TickContext): Promise<ActResult> {
  const card = action.card;
  const whose = card ? `${card.id}'s ${action.skill} run` : `the ${action.skill} run deriving the board`;

  // RULE 1. Before anything is spent. A clean tree is ordinary and carries on; a FAILURE stops the loop,
  // because from here on nothing it does could be reverted in one command.
  const committed = await (deps.commit ?? commitAll)(deps.root, commitMessage(action, context), {
    branch: deps.branch,
  });
  if (committed.reason !== undefined) {
    const what = card ? `dispatching ${card.id}` : 'deriving the board';
    return stop(deps, 'stalled', `Auto-pilot stopped before ${what}: ${committed.reason}`);
  }

  // DECISION 51: the review phase is DETERMINISTIC FIRST, so it does not take the ordinary path at all — its
  // gates run in this process and a model is dispatched only if they pass. Placed after the commit, because
  // whatever the last run left behind must be recoverable before anything else happens.
  if (action.phase === 'task-review' && card) {
    return await reviewTask(
      deps,
      card,
      action.previous,
      { setupSubtree: await inSetup(deps, card) },
      context,
    );
  }

  const refusedEntry = await stampEntry(deps, action);
  if (refusedEntry) return refusedEntry;

  // HOW BIG THE BOARD WAS BEFORE, for a phase whose only product is cards. Read here rather than counted from
  // the run's own `created` list, which is the agent's claim about itself (decision 43): that list would refuse
  // a break-down which created five cards and forgot to name them, and pass one that named five it never made.
  //
  // `undefined` means either "this phase is not judged that way" or "the board could not be read", and both
  // lead to the same place: a comparison that cannot be made is not evidence that nothing happened.
  const before = countsTheBoard(action.phase) ? await liveCount(deps) : undefined;

  // EVERYTHING A CHECKUP IS TOLD, gathered before the dispatch because it is the dispatch's own input — and for
  // a feature checkup that includes running the smoke command, which is why this is before rather than after,
  // and why gathering it can REFUSE: a command out of an unread gate document does not run (decision 51).
  const gathered =
    CHECKUP_PHASES.includes(action.phase) && card ? await checkupEvidence(deps, action, card, context) : {};
  if (gathered.refused) return gathered.refused;

  const started = await deps.client.dispatch(requestFor(action, gathered.evidence));
  if (!started.ok) return await refused(deps, `could not dispatch ${whose}`, started.reason, started.fatal);

  // WHERE to look differs: a card's runs come from the card route, and a project run has no card in its path
  // so it is found in the project's whole list.
  const settled = await settle(deps, started.value.run.run, () =>
    card ? deps.client.cardRuns(card.board, card.id) : deps.client.runs(),
  );
  if (!settled) {
    return stop(
      deps,
      'stalled',
      `${whose[0]?.toUpperCase()}${whose.slice(1)} did not finish within the time auto-pilot waits for one, so nothing can be said about it.`,
    );
  }
  return card
    ? await afterCardRun(deps, action, card, settled, context, before, gathered.evidence?.smoke)
    : await afterProjectRun(deps, action, settled, context, before);
}
