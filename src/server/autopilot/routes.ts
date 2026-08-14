import type { FastifyInstance } from 'fastify';
import {
  type Accounting,
  attemptsUsed,
  type CardAccount,
  governingCap,
  spendByCard,
  splitCardKey,
  sumSpend,
} from '../../core/accounting.js';
import { type AutopilotConfig, DEFAULT_AUTOPILOT } from '../../core/autopilot.js';
import { coverageProblems, phaseSkillProblems, shapeProblems } from '../../core/autopilot-cover.js';
import type { AutopilotState } from '../../core/autopilot-state.js';
import { forClient, unreviewedGatesSentence } from '../../core/autopilot-state.js';
import { countLive } from '../../core/created.js';
import { isStopReason, STOP_REASONS, type StopReason } from '../../core/dispatch-gate.js';
import { PHASES, phase } from '../../core/phases.js';
import type { RunRecord } from '../../core/runs.js';
import type { BoardName, Card, ProjectConfig } from '../../core/types.js';
import { BOARDS } from '../../core/types.js';
import { readAutopilotState, updateAutopilotState } from '../../store/autopilot-store.js';
import { readBoard } from '../../store/cards/board.js';
import {
  type FoundationStatus,
  foundationStatus,
  type GatesResult,
  readGates,
  readSmokeCommand,
  type SmokeResult,
} from '../../store/project/foundation.js';
import { type ReadmeGate, readmeGate } from '../../store/project/readme.js';
import { readSkills } from '../../store/project/skill-catalogue.js';
import { listRuns } from '../../store/run-store.js';
import { attachedOpencodeUrl } from '../boxes/opencode-server.js';
import { agentRefusal } from '../boxes/sandbox.js';
import { type AppCtx, ensureOpen } from '../route-context.js';

// "Could auto-pilot start here, and if not, why not?" — answered in ONE place, so the settings tab,
// the play button and pre-flight all read the same answer rather than each deciding for themselves.
// Two components disagreeing about whether a project is ready is how one of them ends up starting a
// run the other would have refused.
//
// Admin-only by absence from the scope table in auth.ts: this is the project's readiness, not a
// run's business, and a route has to opt into agent access deliberately.
//
// Every negative carries a sentence. A boolean tells someone that something is wrong and nothing
// about what to do, which is the dead-end message this design refuses to ship.

export interface Readiness {
  ok: boolean;
  // Every reason, flattened, in the order a person would fix them: the lifecycle first (it is
  // config), then the README (it is the input), then the documents derived from it.
  blockers: string[];
  readme: ReadmeGate;
  foundation: FoundationStatus;
  gates: { ok: boolean; reason?: string; count: number };
  smoke: { ok: boolean; reason?: string };
  phases: { problems: string[]; count: number };
  // Named separately as well as being a blocker sentence, so the UI can offer the button that clears
  // it without matching on prose that is meant to be improvable.
  unreviewedGates: string[];
}

// A phase naming a skill the project does not have is a phase that silently never runs, so the
// catalogue is part of the lifecycle's completeness rather than a separate concern.
function lifecycleProblemsFor(config: ProjectConfig, skillSlugs: string[]): string[] {
  const problems = coverageProblems(config);
  const ap = config.autopilot;
  // SHAPE FIRST AND ALONE, which is the same ordering `coverageProblems` keeps internally. A hand-edited
  // `autopilot:\n  maxIterations: 10` has a dozen things wrong with it, and appending a list about missing
  // skills to a list about a block that will not parse buries the one the reader has to fix first.
  if (!ap || shapeProblems(ap).length > 0) return problems;
  return [...problems, ...phaseSkillProblems(skillSlugs)];
}

interface Read {
  readme: ReadmeGate;
  foundation: FoundationStatus;
  gates: GatesResult;
  smoke: SmokeResult;
  // Gate documents an AGENT rewrote that nobody has read yet. See `unreviewedGates` in
  // core/autopilot-state.ts: the write is allowed, the EXECUTION waits.
  unreviewedGates: string[];
  // How many live cards there are across all three boards. Zero is a blocker, not a stop — see below.
  liveCards: number;
}

// Everything wrong with this project, in the order a person would fix it: the lifecycle first (it is
// config), then the README (it is the input), then the documents derived from it.
function blockersFrom(
  lifecycleProblems: string[],
  { readme, foundation, gates, smoke, unreviewedGates, liveCards }: Read,
  // Whether an empty board is a state auto-pilot can start from: a README it can derive the feature list from,
  // and the bootstrap phase's skill to derive it with. See the empty-board blocker below.
  canDerive: boolean,
): string[] {
  return [
    // FIRST, and out of the "order a person would fix them" sequence deliberately: this is not a
    // document to write but a decision to take, and it is the only blocker here that exists because
    // something might be UNSAFE rather than incomplete. The commands in these documents run through
    // /bin/sh unsandboxed as the server's user, and an agent chose them.
    // The SAME sentence the dispatch refusal uses, from one home. This one used to be its own shorter
    // copy that told you to read the commands and stopped there — so it named the thing that does not
    // clear the block and omitted the thing that does.
    ...(unreviewedGates.length === 0 ? [] : [unreviewedGatesSentence(unreviewedGates)]),
    ...lifecycleProblems,
    ...(readme.ok ? [] : [readme.reason]),
    // Named one by one rather than "the foundation is incomplete": the fix is to write a specific
    // file, and the point of an enumerated set is that nobody has to guess which.
    ...foundation.missing.map((name) => `foundation/${name} has not been written yet.`),
    // The gate and smoke readers say more than "missing" — they also catch a file that exists and
    // decides nothing, which `foundation.missing` cannot see. Skipped when the file is absent
    // altogether, since the line above already names it and one problem deserves one sentence.
    ...(gates.ok || foundation.missing.includes('CODE-QUALITY.md') ? [] : [gates.reason]),
    ...(smoke.ok || foundation.missing.includes('TESTING.md') ? [] : [smoke.reason]),
    // LAST, because it is the last thing a person does: the README first, then the documents derived
    // from it, then the work itself.
    //
    // A BLOCKER rather than a stop, which is the fix for a real flow problem: the loop's own `no-op` ending
    // arrives AFTER you press Start, so pressing it looked like nothing happening at all.
    //
    // AND ONLY WHEN THE BOARD CANNOT BE DERIVED, which is the correction. An empty board with a README is the
    // one auto-pilot bootstraps (the `bootstrap` row of core/phases.ts), and blocking it made the flow
    // self-contradictory in the user's hands: it could not start without a card, and the run that creates the
    // cards is the one it could not start. Guarded by the same two facts the tick's own branch needs, so the
    // panel and the loop cannot disagree about whether this project can begin.
    ...(liveCards > 0 || canDerive
      ? []
      : [
          'There is no card on any board, and nothing auto-pilot could derive one from. Add a card, or write the README so it can derive the feature list from it.',
        ]),
  ];
}

function composeReadiness(config: ProjectConfig, skillSlugs: string[], read: Read): Readiness {
  const lifecycleProblems = lifecycleProblemsFor(config, skillSlugs);
  // BOTH facts, and the skill one is not a formality: a project with no `derive-features` skill has nothing
  // to bootstrap with, and telling it to go and write its README would send the reader to fix the wrong file.
  // The lifecycle problems above name the real one.
  //
  // THE BOOTSTRAP'S SKILL COMES FROM THE PHASE TABLE, which is the same place the tick takes it from
  // (core/tick.ts's `bootstrap`) — so the panel and the loop cannot disagree about whether this project can
  // begin. It used to be read off `config.autopilot.routes`, and they could.
  const bootstrapSkill = phase('bootstrap').skill;
  const canDerive = read.readme.ok && bootstrapSkill !== undefined && skillSlugs.includes(bootstrapSkill);
  const blockers = blockersFrom(lifecycleProblems, read, canDerive);
  const { readme, foundation, gates, smoke } = read;
  return {
    ok: blockers.length === 0,
    blockers,
    readme,
    foundation,
    gates: {
      ok: gates.ok,
      ...(gates.ok ? {} : { reason: gates.reason }),
      count: gates.ok ? gates.gates.length : 0,
    },
    smoke: { ok: smoke.ok, ...(smoke.ok ? {} : { reason: smoke.reason }) },
    unreviewedGates: read.unreviewedGates,
    // `phases`, not `routes`: the count is how many phases DISPATCH, which is a fact about the machine, so a
    // malformed config block no longer makes it zero — the number was never about the config.
    phases: { problems: lifecycleProblems, count: PHASES.filter((p) => p.skill !== undefined).length },
  };
}

// Read from disk, in one place. The readiness endpoint and the START endpoint must not each decide
// whether a project is ready: two components disagreeing about that is how one of them starts a run the
// other would have refused.
//
// Takes the root and config rather than the context: `ensureOpen` is a type predicate over the SESSION,
// and its narrowing does not survive being passed through a function boundary. Asking for what it needs
// keeps the check at the call site where the 409 is sent.
// Live cards across all three boards, THROUGH `countLive` — the same predicate the loop counts with.
// `readBoard(...).length` was not the same answer: it excludes the archive folder and nothing else,
// while `isLive` is two clauses, the folder AND the `archived` field, because those are written by
// different paths. A card marked archived but still in a live column therefore counted as work here and
// as nothing to the loop — the state core/tick.ts's half-archived stop exists precisely to name.
async function countLiveCards(root: string, config: ProjectConfig): Promise<number> {
  const boards = await Promise.all(BOARDS.map(async (b) => [b, await readBoard(root, b, config)] as const));
  return countLive(Object.fromEntries(boards) as Record<BoardName, Card[]>);
}

async function readReadiness(root: string, config: ProjectConfig): Promise<Readiness> {
  const [readme, foundation, gates, smoke, catalogue, state, liveCards] = await Promise.all([
    readmeGate(root),
    foundationStatus(root),
    readGates(root),
    readSmokeCommand(root),
    readSkills(root, config),
    readAutopilotState(root, new Date().toISOString()),
    countLiveCards(root, config),
  ]);
  return composeReadiness(
    config,
    catalogue.skills.map((s) => s.slug),
    { readme, foundation, gates, smoke, unreviewedGates: state.unreviewedGates ?? [], liveCards },
  );
}

// Why this project cannot be started right now, or nothing. `halted` needs a person (decision 12) and
// `running` means it is already going. Each names the control that clears it, because a refusal without a
// way forward is a dead end.
//
// The third refusal — an owed periodic checkup — retired with `checkupEvery` (decision 47). It was the one
// that stopped a project after roughly five cards and waited for a human.
function stateConflict(state: AutopilotState): string | undefined {
  if (state.state === 'halted') {
    return 'This project is halted. Restart it from the auto-pilot panel before starting auto-pilot.';
  }
  if (state.state === 'running') return 'Auto-pilot is already running this project.';
  return undefined;
}

// The state, and the three ways to stop (decision 12). Every one of them is admin-only by absence
// from the scope table in auth.ts, and that is load-bearing rather than incidental: a run able to
// restart its own project could undo the emergency stop that was aimed at it, and the whole point of
// `halted` is that it is a decision only a person takes back.
async function registerControls(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.get('/autopilot/state', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    // The file, not the mirror: the auto-pilot service writes its own counters and this process does
    // not see those writes.
    //
    // WITHOUT the process group. `servicePgid` and `servicePgstart` are the reaper's business and nothing in
    // the browser reads them — sending a pid to a web page is a detail of this machine leaving the machine
    // for no one's benefit.
    return { state: forClient(await ctx.autopilot.current()) };
  });

  // Stop dispatching. The app is untouched: chat, manual runs and the board all carry on.
  api.post('/autopilot/stop', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { detail } = (req.body ?? {}) as { detail?: string };
    const result = await ctx.autopilot.softStop(detail);
    if (!result.ok) return reply.code(409).send({ error: result.error });
    return { state: forClient(result.state) };
  });

  // Everything project-related dies. Deliberately a separate endpoint from the soft stop rather than a
  // flag on it: one of these is reversible and the other kills work in flight, and a boolean in a body
  // is a poor place for that difference to live.
  api.post('/autopilot/kill', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { detail } = (req.body ?? {}) as { detail?: string };
    const result = await ctx.autopilot.emergencyStop(detail);
    if (!result.ok) return reply.code(409).send({ error: result.error });
    return { state: forClient(result.state) };
  });

  // Press start. The refusals are in the order a person would fix them, and every one names the way
  // forward — the whole point of a control that can refuse is that it says why.
  api.post('/autopilot/start', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;

    // THE SANDBOX FIRST, and 412 rather than 403: the request is fine, the machine is not in a state to
    // serve it. Auto-pilot is the one caller for which this is mandatory rather than advisable — it
    // dispatches unattended, so the confinement cannot be something a person decides to skip this once.
    const refusal = agentRefusal(ctx.sandbox, attachedOpencodeUrl());
    if (refusal) return reply.code(412).send({ error: refusal });

    // Then the project. A run whose routing table has a hole, or whose foundation documents are not
    // written, would dispatch into a lifecycle that cannot finish — and the gate commands ARE those
    // documents, so a missing one is a verification that fails closed on every card.
    const readiness = await readReadiness(ctx.session.root, ctx.session.config);
    if (!readiness.ok) {
      return reply.code(412).send({
        error: `Auto-pilot is not ready to start here: ${readiness.blockers.join(' ')}`,
        blockers: readiness.blockers,
      });
    }

    // Then the state, which is the project's own business rather than the machine's — 409 for each.
    const state = await ctx.autopilot.current();
    const conflict = stateConflict(state);
    if (conflict) return reply.code(409).send({ error: conflict });

    const started = await ctx.service.start();
    if (!started.ok) return reply.code(409).send({ error: started.error });
    ctx.broadcast({ type: 'autopilot:state', state: forClient(started.state) });
    return { state: forClient(started.state) };
  });

  // The loop reporting its own ending. The ONLY control on this file a run credential may call, and it is
  // scoped to `service` alone: a work agent that could stop auto-pilot could stop the thing supervising it.
  //
  // It is a stop, not a state write: it goes through the same `AutopilotRuntime` the buttons use, so the
  // mirror moves, every open tab gets the overlay, and the loop's credential is revoked on the way out.
  // The loop writing `autopilot-state.json` itself would silently skip all three.
  api.post('/autopilot/stopped', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { reason, detail } = (req.body ?? {}) as { reason?: unknown; detail?: unknown };
    // Validated against the shared list rather than trusted: this is agent-reachable input, and an
    // unrecognised reason would render in the overlay as a raw word with no sentence behind it.
    if (!isStopReason(reason)) {
      return reply.code(400).send({ error: `reason must be one of ${STOP_REASONS.join(', ')}` });
    }
    // The two a LOOP cannot claim about itself. `killed` belongs to the emergency stop and `stopped` to
    // the person who pressed it; a loop reporting either would put someone else's words in the overlay.
    if (reason === 'killed' || reason === 'stopped') {
      return reply.code(400).send({ error: `${reason} is not a reason the loop may report for itself.` });
    }
    const result = await ctx.autopilot.recordLoopStop(
      reason as StopReason,
      typeof detail === 'string' ? detail : undefined,
    );
    if (!result.ok) return reply.code(409).send({ error: result.error });
    return { state: forClient(result.state) };
  });

  // The way back to idle. Auto-pilot stays off until it is started separately.
  api.post('/autopilot/restart', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const result = await ctx.autopilot.restart();
    if (!result.ok) return reply.code(409).send({ error: result.error });
    return { state: forClient(result.state) };
  });
}

// The arithmetic behind `GET /api/accounting`. The SHAPE it returns — `Accounting` and `CardAccount`,
// with the reasoning for computing it here at all — lives in `core/accounting.ts`, because the loop
// reads this endpoint and a type declared in a route module made `src/service/` import from
// `src/server/`.
function composeAccounting(runs: RunRecord[], ap: AutopilotConfig | undefined, iteration = 0): Accounting {
  const project = sumSpend(runs);
  const cards: CardAccount[] = [];
  for (const [key, spend] of spendByCard(runs)) {
    // The board is a BoardName by construction — `spendByCard` keys on a record's own `board`, which
    // was validated when the record was written. Asserted here rather than re-validated because the
    // alternative is dropping a card's ledger over a type the data cannot actually have.
    const { board, card } = splitCardKey(key) as { board: BoardName; card: string };
    const skills = new Set(runs.filter((r) => r.card === card && r.board === board).map((r) => r.skill));
    const attempts: Record<string, number> = {};
    for (const skill of skills) attempts[skill] = attemptsUsed(runs, card, skill);
    cards.push({ board, card, spend, attempts });
  }
  // A project with no lifecycle block has no caps to be governed by. It used to be shown
  // DEFAULT_AUTOPILOT's values on the grounds that they are what it would get if upgraded — but the
  // sentence is rendered in the indicative about THIS project, so a project where auto-pilot cannot
  // start at all was told "auto-pilot stops when this project's runs have cost $20". No cap, no
  // sentence; the attempt cap still comes from the default because the card pane always shows one.
  return {
    project,
    cards,
    attemptCap: (ap ?? DEFAULT_AUTOPILOT).attemptCap,
    ...(ap ? { cap: governingCap(ap, project, iteration) } : {}),
  };
}

export async function registerAutopilotRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  // Readable by the SERVICE as well as the browser: slice C's loop compares this spend against the
  // budget between dispatches, and it is a separate process reaching the board over HTTP like anything
  // else. Not readable by `work` or `checkup`: an agent that can see how much room is left in the
  // budget is an agent reasoning about its own leash, which is not its business.
  api.get('/accounting', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    // The iteration comes from the live state, not from the run count: the two differ after a restart,
    // and it is the counter the gate compares that decides which cap is nearer.
    const [runs, state] = await Promise.all([listRuns(ctx.session.root), ctx.autopilot.current()]);
    return composeAccounting(runs, ctx.session.config.autopilot, state.iteration);
  });

  await registerControls(api, ctx);

  api.get('/autopilot/readiness', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    return readReadiness(ctx.session.root, ctx.session.config);
  });

  // A person has read the gate commands an agent wrote. ADMIN ONLY, by absence from auth.ts's table —
  // an agent that could clear this would be an agent approving its own commands, which is the entire
  // thing the flag exists to prevent.
  api.post('/autopilot/gates-reviewed', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const state = await updateAutopilotState(ctx.session.root, new Date().toISOString(), (current) => {
      const { unreviewedGates: _cleared, ...rest } = current;
      return rest;
    });
    ctx.log.warn({}, 'the gate commands were reviewed; auto-pilot may start again');
    return { ok: true, state: forClient(state) };
  });
}
