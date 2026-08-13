import { burnsAttempt } from '../core/accounting.js';
import type { TickAction } from '../core/actions.js';
import type { AutopilotState } from '../core/autopilot-state.js';
import { unreviewedGatesSentence } from '../core/autopilot-state.js';
import { countLive, createdNothing } from '../core/created.js';
import type { StopReason } from '../core/dispatch-gate.js';
import { type PhaseName, phase } from '../core/phases.js';
import { producedNothing, type RunRecord } from '../core/runs.js';
import { hasSetupFeature, setupSubtreeIds } from '../core/setup-feature.js';
import { BOARDS, type Card } from '../core/types.js';
import { unverified, type Verification } from '../core/verify.js';
import { commitAll } from '../server/git-work.js';
import { verifyGates, type verifySmoke } from '../server/verifier.js';
import type { Answer, BoardClient, DispatchRequest } from './board-client.js';
import type { ActResult, TickContext } from './loop.js';
import { stamp } from './stamp.js';

// Carrying ONE action out. The decision was made by `decideTick`; this is the doing, and the order it does
// things in is the whole of it:
//
//   commit → stamp the entry column → dispatch → wait for the record to settle → stamp the exit column → diary
//
// Four rules, each of which is a decision rather than an implementation detail:
//
// 1. COMMIT FIRST (step 10). Committing before every dispatch is what makes an aborted, timed-out or plainly
//    wrong run one command from gone. A commit that FAILS stops the loop: the revert guarantee is the reason
//    this is safe to run unattended, and dispatching without it would be spending on a tree nobody can undo.
// 2. NOTHING MOVES ON SELF-ASSESSMENT (decision 3, amended by decision 40). A card advances when its phase's
//    run COMPLETES — read off `status`, which the RUNNER assigns — and never off the `outcome` the agent
//    wrote about its own work. What judges the work itself is the `task-review` phase, which is a separate
//    run with no authority over the card it judges.
// 3. THE CARD IS MOVED THROUGH THE ENDPOINT, and so is everything else this writes. The loop holds a
//    `service` credential and goes through the same validation as an agent (decision 10). Two exceptions,
//    both deliberate: the gate commands run in this process, because putting arbitrary command execution
//    behind an HTTP endpoint would be a far larger hole than the one it closes; and git runs here for the
//    same reason.
// 4. EVERY COLUMN STAMP GOES THROUGH `stamp.ts`, so no second way to move a card can grow here.
//
// THERE IS NO VERIFICATION IN THIS FILE YET, and that is correct rather than missing. A dispatch's exit is
// simply the stamp its phase names: a task's work is judged at the `task-review` phase and a creating run's
// product by `createdNothing`, both of which arrive with their own tasks. The one verdict written here is for
// a run that left NOTHING behind, which is a correctness rule rather than a judgement (see `producedNothing`).

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

const SETTLE_TIMEOUT_MS = 3_600_000; // an hour: a run's own timeout is half that by default
const SETTLE_POLL_MS = 2_000;

// Ceilings, so no configured or injected number can turn the wait into an unbounded one. A day is longer than
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
type Dispatch = Extract<TickAction, { kind: 'dispatch' }>;

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
function requestFor(action: Dispatch): DispatchRequest {
  const card = action.card;
  if (!card) return { project: true, skill: action.skill };
  return {
    board: card.board,
    card: card.id,
    skill: action.skill,
    ...(action.previous === undefined ? {} : { previous: action.previous }),
  };
}

// THE ENTRY STAMP, and only where the phase names one. `task-review` and `task-fix` name none because the
// card is already where they want it, and a move to where a card already is would be a write for nothing —
// and a diary line about an event that did not happen. The bootstrap names none because it has no card.
async function stampEntry(deps: ActDeps, action: Dispatch): Promise<ActResult | undefined> {
  const card = action.card;
  const entry = phase(action.phase).entry;
  if (!card || entry === undefined) return undefined;
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
  const before = CREATING_PHASES.includes(action.phase) ? await liveCount(deps) : undefined;

  const started = await deps.client.dispatch(requestFor(action));
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
    ? await afterCardRun(deps, action, card, settled, context, before)
    : await afterProjectRun(deps, action, settled, context, before);
}

// THE THREE PHASES WHOSE ONLY PRODUCT IS CARDS (decision 43). Named here rather than derived from `creates`,
// because the two checkups declare a `creates` too and this rule must not touch them: a checkup's product is a
// REPORT, creating is optional, and a checkup that creates nothing is the ordinary closing case (decision 47) —
// applied to them, this would refuse every close.
const CREATING_PHASES: readonly PhaseName[] = ['bootstrap', 'feature-breakdown', 'story-breakdown'];

// How many live cards the board holds, or `undefined` when it could not be read. A failed read is stated as
// unknown rather than guessed at: "created no cards" is a verdict, and a failed read is not evidence for it.
async function liveCount(deps: ActDeps): Promise<number | undefined> {
  const board = await deps.client.board();
  return board.ok ? countLive(board.value.boards) : undefined;
}

// What a card's run earned. DECISION 40: the loop reads its own record of how the run ended — `status`, which
// the runner assigns — and never the `outcome` the agent wrote about itself.
async function afterCardRun(
  deps: ActDeps,
  action: Dispatch,
  card: Card,
  settled: RunRecord,
  context: TickContext,
  // The live-card count before the dispatch, for a phase whose product is cards. See `CREATING_PHASES`.
  before: number | undefined,
): Promise<ActResult> {
  const p = phase(action.phase);
  // An ending nobody is answerable for: the user cancelled it, or a restart left it stale. No attempt is
  // burned (accounting.ts), and the card does not move — the work never happened.
  if (!burnsAttempt(settled.status)) {
    await deps.client.log(
      'run',
      `${card.id}: ${action.skill} ended as ${settled.status}, so no attempt was used and the card has not moved.`,
    );
    return { dispatches: 1 };
  }

  // A run that left NOTHING behind does not advance, and this is a correctness rule rather than an economy
  // one: the gates would answer about a tree the run never touched — commands that were passing before the
  // dispatch and are passing now — so the card would advance having implemented nothing. The attempt is still
  // burned: the agent had its chance (accounting.ts).
  if (producedNothing(settled)) return await recordEmptyRun(deps, action, card, settled, context);

  // AND A CREATING PHASE WHOSE RUN PRODUCED NO CARD has not done its job, whatever it reported (decision 43).
  // A different question from `producedNothing`, and both earn their place: that one asks whether the run left
  // anything behind at all, and this one asks whether the board GREW — which is the only honest measure for a
  // phase whose product goes through the API and therefore changes no files.
  if (before !== undefined) {
    const after = await liveCount(deps);
    if (after !== undefined && createdNothing(before, after)) {
      return await recordEmptyCreate(deps, action, card, settled, context);
    }
  }

  // THE EXIT STAMP, written because the run COMPLETED, whatever it says about itself.
  if (p.exitPass) {
    const stamped = await stamp(deps, card, p.exitPass, `its ${action.skill} run completed.`);
    // `dispatches: 1` EVEN HERE, and that is not tidiness: a dispatch that happened and then failed to move
    // its card was reported as no dispatch at all, so neither cap was told about a real agent run, the tick
    // counted as idle, and the next tick re-picked the same card and dispatched over work that had already
    // passed — three times over, until the attempt cap caught it.
    if (!stamped.ok) {
      return refused(deps, `could not advance ${card.id} to ${p.exitPass}`, stamped.reason, stamped.fatal, 1);
    }
  }
  // The STRUCTURED fields as well as the sentence. `DiaryEntry` carries `iteration`, `card`, `board`, `skill`
  // and `outcome` precisely so the diary's readers do not have to regex prose.
  await deps.client.log('run', runLine(card, action, settled, p.exitPass, context), {
    iteration: context.iteration + 1,
    card: card.id,
    board: card.board,
    skill: action.skill,
    outcome: settled.status,
  });
  return { dispatches: 1 };
}

// A failing verdict for a creating run whose board did not grow. The card stays where its entry stamp put it
// and the attempt is burned by the record, exactly as an empty run's is — there is nothing to advance to,
// because the thing this phase exists to produce does not exist.
async function recordEmptyCreate(
  deps: ActDeps,
  action: Dispatch,
  card: Card,
  settled: RunRecord,
  context: TickContext,
): Promise<ActResult> {
  const verification = unverified(
    'gates',
    deps.now().toISOString(),
    `The ${action.skill} run created no card, and cards are the only thing this phase produces — so ${card.id} has not moved. Read its report: it may have decided there was nothing to create, which is a judgement a person needs to see.`,
  );
  const recorded = await deps.client.verdict(card.board, card.id, settled.run, verification);
  if (!recorded.ok) {
    return refused(
      deps,
      `could not record the verdict on ${settled.run}`,
      recorded.reason,
      recorded.fatal,
      1,
    );
  }
  await deps.client.log(
    'run',
    `Iteration ${context.iteration + 1}: ${card.id} ran ${action.skill} for its ${action.phase} phase and created no card, so it stayed where it is.${said(settled)}`,
    {
      iteration: context.iteration + 1,
      card: card.id,
      board: card.board,
      skill: action.skill,
      outcome: settled.status,
    },
  );
  return { dispatches: 1 };
}

// A failing verdict for work that was never done, recorded WITHOUT running anything over the tree.
async function recordEmptyRun(
  deps: ActDeps,
  action: Dispatch,
  card: Card,
  settled: RunRecord,
  context: TickContext,
): Promise<ActResult> {
  const verification = unverified(
    // `gates` is the mode the loop's own check wears under this machine (decision 51's first step). Not a
    // fourth mode invented for this case: `unverified` wears a real one deliberately, because "this card is
    // checked by nothing" is not a check.
    'gates',
    deps.now().toISOString(),
    // "nothing this server can see", not "nothing": a run killed by the clock may really have created cards
    // through the API, and its report is deliberately not folded — so what is absent here is the evidence
    // rather than necessarily the work. The verdict fails either way, and the sentence should not overclaim.
    `The ${action.skill} run left nothing this server can see — it failed, changed no files and delivered no report — so nothing was checked and the card has not moved.`,
  );
  const recorded = await deps.client.verdict(card.board, card.id, settled.run, verification);
  if (!recorded.ok) {
    return refused(
      deps,
      `could not record the verdict on ${settled.run}`,
      recorded.reason,
      recorded.fatal,
      1,
    );
  }
  await deps.client.log('run', emptyRunLine(card, action, verification, settled, context), {
    iteration: context.iteration + 1,
    card: card.id,
    board: card.board,
    skill: action.skill,
    outcome: settled.status,
  });
  return { dispatches: 1 };
}

// THE BOOTSTRAP'S TAIL: one run about the project, with no card to be about. It departs from a card run in
// exactly two places, both because there is no card:
//
//  * NO VERDICT IS RECORDED. `POST /runs/:board/:card/:run/verification` is card-scoped, and there is no card
//    for it to be written beside. Nothing is lost that a person needs: what this run did is on the board.
//  * NO COLUMN IS STAMPED, because there is no card to stamp. What this phase produced is read off the board
//    instead — cards are created through the API, so a bootstrap that worked changes no files and a
//    file-based check would call every success a failure.
//
// A bootstrap that produced nothing does NOT stop the loop here. The attempt is burned by the record itself,
// `decideTick` counts those attempts, and it is the one place that decides when to give up — a second opinion
// here would be a second cap disagreeing with the first.
//
// ITS EXIT IS THE SCAFFOLDING FLAG, and this is the only place it is ever written (decision 44).
async function afterProjectRun(
  deps: ActDeps,
  action: Dispatch,
  settled: RunRecord,
  context: TickContext,
  before: number | undefined,
): Promise<ActResult> {
  const board = await deps.client.board();
  // `countLive`, the same count `createdNothing` is defined over: two ways of counting one board would be two
  // answers to "did this run produce anything".
  const created = board.ok ? countLive(board.value.boards) : undefined;
  // Only where the board actually grew. A bootstrap that produced nothing has no scaffolding feature to name,
  // and a board that could not be read is not evidence that it did.
  if (board.ok && before !== undefined && created !== undefined && !createdNothing(before, created)) {
    await stampSetup(deps, board.value.boards.features ?? []);
  }
  await deps.client.log('run', bootstrapLine(action.skill, settled, created, context), {
    iteration: context.iteration + 1,
    skill: action.skill,
    outcome: settled.status,
  });
  return { dispatches: 1 };
}

// `setup: true` ON THE FIRST FEATURE IN `features/backlog`, by the `order` THE ENDPOINT ASSIGNED — read off the
// board rather than out of the run's `created` list, which is the agent's claim about itself (finding F).
//
// WHICH FEATURE IS THE SCAFFOLDING IS NOT ASKED OF THE MODEL: it is the first one, and the loop stamps it. The
// skill is told to derive features in the order they must be built and cannot set this flag at all.
//
// GUARDED BY `hasSetupFeature` over the live board AND THE ARCHIVE, because "once" is a board fact (decision
// 50): a feature somebody archived after the bootstrap stamped it must still count, or a second derivation
// would hand the flag to a card nobody chose — and under decision 51 the flag is what makes an absent gate set
// expected instead of a failure.
async function stampSetup(deps: ActDeps, features: Card[]): Promise<void> {
  const archived = await deps.client.archive('features');
  // A read that failed is not "no scaffolding feature". Withholding the stamp costs an ordering fact; awarding
  // it on no evidence switches off a fail-closed check, so this fails the cheaper way.
  if (!archived.ok) {
    deps.log?.(`could not read the archive, so the scaffolding flag was left alone: ${archived.reason}`);
    return;
  }
  if (hasSetupFeature([...features, ...archived.value.cards])) return;
  const first = features.filter((c) => c.columnSlug === 'backlog').sort(byQueueOrder)[0];
  if (!first) return;
  const done = await deps.client.flags(first.board, first.id, { setup: true });
  if (!done.ok) {
    // NOT FATAL. This is the exit of a run that has already happened; losing the flag costs an ordering fact,
    // and stopping the loop over it costs the project.
    deps.log?.(`could not flag ${first.id} as the scaffolding feature: ${done.reason}`);
    return;
  }
  await deps.client.log(
    'lifecycle',
    `${first.id} is this project's scaffolding feature: it establishes the toolchain, the test runner and the gate commands, and it is worked first.`,
    { card: first.id, board: first.board },
  );
}

// (order, then id) — the same comparator the queue is ranked by everywhere else. Two features with the same
// order is a board a person edited, and taking the lower id is at least deterministic.
const byQueueOrder = (a: Card, b: Card): number =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// WHETHER THIS CARD IS IN THE SETUP SUBTREE, asked of the board the loop can already read. It is the loop's
// question and not the card's: told by the card, an absent gate set would be something a card could claim.
//
// A board it could not read is treated as OUTSIDE the subtree, which is the fail-closed direction — being
// wrong the other way excuses an absent gate set for a card nobody chose (decision 51).
async function inSetup(deps: ActDeps, card: Card): Promise<boolean> {
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
  const unread = (await deps.state()).unreviewedGates;
  if (unread && unread.length > 0) {
    return stop(
      deps,
      'stalled',
      `Auto-pilot will not run a gate command while a gate document is unread. ${unreviewedGatesSentence(unread)}`,
    );
  }
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

// THE GATES' OWN WORDS. The command and how it ended, in the diary, so a person reads why a card went back
// without opening a run record — and no model was involved, which the line says because a reader would
// otherwise assume one was.
function gatesLine(card: Card, gates: Verification): string {
  const evidence = gates.command === undefined ? '' : ` \`${gates.command}\` is the one that failed.`;
  const because = gates.reason ? ` ${gates.reason}` : '';
  return `${card.id} failed its gates, so it goes back to be fixed — no model was asked and no iteration was spent.${evidence}${because}`;
}

function reviewLine(card: Card, review: RunRecord, passed: boolean, context: TickContext): string {
  const what = passed ? 'passed it' : 'sent it back';
  return `Iteration ${context.iteration + 1}: ${card.id}'s review ${what}.${said(review)}`;
}

// A review that ran and answered nothing. It says so plainly rather than reporting the run's own outcome: a
// review whose turn went perfectly and which decided nothing has not passed anything.
function inconclusiveLine(card: Card, review: RunRecord, context: TickContext): string {
  return `Iteration ${context.iteration + 1}: ${card.id}'s review ended as ${review.status} and reported no verdict, so nothing was decided and it stays in review.${said(review)}`;
}

// What a person reads afterwards about a bootstrap. The count is what happened; the run's own summary is what
// it says about it, and the two are kept apart deliberately — a run reporting success over an empty board is
// exactly the disagreement worth being able to see.
function bootstrapLine(
  skill: string,
  settled: RunRecord,
  // Absent when the board could not be read back. Stated as unknown rather than guessed at: "created no cards"
  // is a verdict, and a failed read is not evidence for it.
  cards: number | undefined,
  context: TickContext,
): string {
  const outcome =
    cards === undefined
      ? 'the board could not be read back, so what it produced is unknown'
      : cards === 0
        ? 'the board is still empty'
        : `the board now has ${cards} card${cards === 1 ? '' : 's'}`;
  return `Iteration ${context.iteration + 1}: ${skill} ran against the project to derive the board — ${outcome}.${said(settled)}`;
}

// Ask until it has finished. The record is the only place a run's ending is written, and it is written by the
// server — so this is polling by design rather than for want of an event: the loop is a separate process and
// has no channel of its own.
//
// WHERE to look is the caller's, because a run does not always live beside a card. A card's runs come from the
// card route; a project run — the bootstrap — has no card in its path and is found in the project's whole list.
// Passed as a thunk rather than as a board/card pair so the card-less case is not an absence to interpret.
async function settle(
  deps: ActDeps,
  run: string,
  look: () => Promise<Answer<{ runs: RunRecord[] }>>,
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
  const attempts = Math.min(MAX_SETTLE_POLLS, Math.max(1, Math.floor(patience / poll) + 1));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const answer = await look();
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

function commitMessage(action: Dispatch, context: TickContext): string {
  const what = action.card ? `${action.card.id} ${action.skill}` : `${action.skill} on the empty board`;
  return `autopilot: before ${what} (iteration ${context.iteration + 1})`;
}

// THE AGENT'S OWN SUMMARY, which nothing was appending before. Loop step 12 says "append the run's summary to
// the diary", and decision 10 justifies denying agents diary access on the grounds that auto-pilot appends it
// for them — so without this the narrative contained no agent voice at all.
const said = (run: RunRecord): string => (run.summary ? ` It reported: ${run.summary}` : '');

// What a person reads afterwards about a dispatch that completed. The PHASE is named as well as the skill,
// because `break-down` is two phases and `in-progress` is stamped by two — so the skill alone does not say
// which part of the machine this line came from.
function runLine(
  card: Card,
  action: Dispatch,
  settled: RunRecord,
  to: string | undefined,
  context: TickContext,
): string {
  const where = to === undefined ? 'and it stayed where it is' : `so it moved to ${to}`;
  return `Iteration ${context.iteration + 1}: ${card.id} ran ${action.skill} for its ${action.phase} phase; it ended as ${settled.status}, ${where}.${said(settled)}`;
}

// And about one that left nothing behind. It says the check DID NOT RUN rather than that it failed: a line
// whose opening clause contradicts the reason after it is worse than one that says less.
function emptyRunLine(
  card: Card,
  action: Dispatch,
  verification: Verification,
  settled: RunRecord,
  context: TickContext,
): string {
  const because = verification.reason ? ` ${verification.reason}` : '';
  return `Iteration ${context.iteration + 1}: ${card.id} ran ${action.skill} for its ${action.phase} phase and left nothing behind, so nothing was checked and it stayed where it is.${because}${said(settled)}`;
}

// A refusal from the board. Reported to the diary where it can be, and fatal refusals end the loop: a loop
// that cannot move a card cannot make progress, and one whose credential is gone cannot do anything at all.
//
// `dispatches` is carried through it, and that is not tidiness: a dispatch that HAPPENED and then failed to
// record its verdict or move its card was reported as no dispatch at all, so neither cap was told about a real
// agent run, the tick counted as idle, and the next tick re-picked the same card and dispatched over work that
// had already passed — three times over, until the attempt cap caught it. Decision 8 says everything a model
// does counts against every cap, and it has to count even when what came after it broke.
async function refused(
  deps: ActDeps,
  what: string,
  reason: string,
  fatal: boolean,
  dispatches = 0,
): Promise<ActResult> {
  deps.log?.(`${what}: ${reason}`);
  if (fatal) return { dispatches, stop: { reason: 'stalled', detail: `${what}: ${reason}` } };
  await deps.client.log('note', `Auto-pilot ${what}: ${reason}`);
  return { dispatches };
}

async function stop(deps: ActDeps, reason: StopReason, detail: string): Promise<ActResult> {
  deps.log?.(detail);
  await deps.client.log('note', detail);
  return { dispatches: 0, stop: { reason, detail } };
}
