import type { FastifyInstance } from 'fastify';
import {
  attemptsUsed,
  type CapName,
  governingCap,
  type Spend,
  spendByCard,
  splitCardKey,
  sumSpend,
} from '../../core/accounting.js';
import { type AutopilotConfig, DEFAULT_AUTOPILOT } from '../../core/autopilot.js';
import { coverageProblems, skillProblems } from '../../core/autopilot-cover.js';
import type { AutopilotState } from '../../core/autopilot-state.js';
import { forClient } from '../../core/autopilot-state.js';
import { STOP_REASONS, type StopReason } from '../../core/dispatch-gate.js';
import {
  type FoundationStatus,
  foundationStatus,
  type GatesResult,
  readGates,
  readSmokeCommand,
  type SmokeResult,
} from '../../core/foundation.js';
import { type ReadmeGate, readmeGate } from '../../core/readme.js';
import type { RunRecord } from '../../core/runs.js';
import type { BoardName, ProjectConfig } from '../../core/types.js';
import { readAutopilotState, updateAutopilotState } from '../autopilot-store.js';
import { attachedOpencodeUrl } from '../opencode-server.js';
import { type AppCtx, ensureOpen } from '../route-context.js';
import { listRuns } from '../run-store.js';
import { agentRefusal } from '../sandbox.js';
import { readSkills } from '../skill-catalogue.js';

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
  routes: { problems: string[]; count: number };
  // Named separately as well as being a blocker sentence, so the UI can offer the button that clears
  // it without matching on prose that is meant to be improvable.
  unreviewedGates: string[];
}

// A route naming a skill the project does not have is a phase that silently never runs, so the
// catalogue is part of the lifecycle's completeness rather than a separate concern.
function routeProblemsFor(config: ProjectConfig, skillSlugs: string[]): string[] {
  const problems = coverageProblems(config);
  const ap = config.autopilot;
  // SHAPE, not presence. `coverageProblems` returns early on `shapeProblems` precisely so nothing
  // indexes into a malformed block — and then this guard asked whether the block EXISTS and handed a
  // hand-edited `autopilot:\n  maxIterations: 10` to `skillProblems`, which does `ap.routes.filter`.
  // A 500 in place of the list of shape problems already computed and sitting in `problems`: the exact
  // crash autopilot-cover.ts has a comment about, reintroduced one layer up.
  if (!ap || !Array.isArray(ap.routes)) return problems;
  return [...problems, ...skillProblems(ap, skillSlugs)];
}

interface Read {
  readme: ReadmeGate;
  foundation: FoundationStatus;
  gates: GatesResult;
  smoke: SmokeResult;
  // Gate documents an AGENT rewrote that nobody has read yet. See `unreviewedGates` in
  // core/autopilot-state.ts: the write is allowed, the EXECUTION waits.
  unreviewedGates: string[];
}

// Everything wrong with this project, in the order a person would fix it: the lifecycle first (it is
// config), then the README (it is the input), then the documents derived from it.
function blockersFrom(
  routeProblems: string[],
  { readme, foundation, gates, smoke, unreviewedGates }: Read,
): string[] {
  return [
    // FIRST, and out of the "order a person would fix them" sequence deliberately: this is not a
    // document to write but a decision to take, and it is the only blocker here that exists because
    // something might be UNSAFE rather than incomplete. The commands in these documents run through
    // /bin/sh unsandboxed as the server's user, and an agent chose them.
    ...(unreviewedGates.length === 0
      ? []
      : [
          `${unreviewedGates.map((n) => `foundation/${n}`).join(' and ')} ${
            unreviewedGates.length === 1 ? 'was' : 'were'
          } rewritten by an agent. Read the commands in Project Control before auto-pilot runs them — they run outside the sandbox, as you.`,
        ]),
    ...routeProblems,
    ...(readme.ok ? [] : [readme.reason]),
    // Named one by one rather than "the foundation is incomplete": the fix is to write a specific
    // file, and the point of an enumerated set is that nobody has to guess which.
    ...foundation.missing.map((name) => `foundation/${name} has not been written yet.`),
    // The gate and smoke readers say more than "missing" — they also catch a file that exists and
    // decides nothing, which `foundation.missing` cannot see. Skipped when the file is absent
    // altogether, since the line above already names it and one problem deserves one sentence.
    ...(gates.ok || foundation.missing.includes('CODE-QUALITY.md') ? [] : [gates.reason]),
    ...(smoke.ok || foundation.missing.includes('TESTING.md') ? [] : [smoke.reason]),
  ];
}

export function composeReadiness(config: ProjectConfig, skillSlugs: string[], read: Read): Readiness {
  const routeProblems = routeProblemsFor(config, skillSlugs);
  const blockers = blockersFrom(routeProblems, read);
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
    // `?.` guards the block, not `routes` — the same defect as above, on the same input.
    unreviewedGates: read.unreviewedGates,
    routes: {
      problems: routeProblems,
      count: Array.isArray(config.autopilot?.routes) ? config.autopilot.routes.length : 0,
    },
  };
}

// Read from disk, in one place. The readiness endpoint and the START endpoint must not each decide
// whether a project is ready: two components disagreeing about that is how one of them starts a run the
// other would have refused.
//
// Takes the root and config rather than the context: `ensureOpen` is a type predicate over the SESSION,
// and its narrowing does not survive being passed through a function boundary. Asking for what it needs
// keeps the check at the call site where the 409 is sent.
async function readReadiness(root: string, config: ProjectConfig): Promise<Readiness> {
  const [readme, foundation, gates, smoke, catalogue, state] = await Promise.all([
    readmeGate(root),
    foundationStatus(root),
    readGates(root),
    readSmokeCommand(root),
    readSkills(root, config),
    readAutopilotState(root, new Date().toISOString()),
  ]);
  return composeReadiness(
    config,
    catalogue.skills.map((s) => s.slug),
    { readme, foundation, gates, smoke, unreviewedGates: state.unreviewedGates ?? [] },
  );
}

// Why this project cannot be started right now, or nothing. `halted` needs a person (decision 12); `running`
// means it is already going; and an owed checkup is one this slice cannot run — the tick would stop for it on
// its first pass, so refusing here puts the reason in the panel instead of delivering it as a stop nobody
// asked for. Each names the control that clears it, because a refusal without a way forward is a dead end.
function stateConflict(state: AutopilotState, ap: AutopilotConfig): string | undefined {
  if (state.state === 'halted') {
    return 'This project is halted. Restart it from the auto-pilot panel before starting auto-pilot.';
  }
  if (state.state === 'running') return 'Auto-pilot is already running this project.';
  if (state.needsCheckup || state.dispatchesSinceCheckup >= ap.checkupEvery) {
    return 'This project owes a supervisor checkup, which auto-pilot cannot run yet. Restart it from the auto-pilot panel to clear that and start again from zero.';
  }
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
    const conflict = stateConflict(state, ctx.session.config.autopilot ?? DEFAULT_AUTOPILOT);
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
    if (typeof reason !== 'string' || !(STOP_REASONS as readonly string[]).includes(reason)) {
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

// What this project and each of its cards have spent, and which cap is actually bounding the run.
//
// Computed on the server rather than in the browser, so there is ONE statement of the arithmetic: the
// UI renders it, and the auto-pilot service reads the same numbers over the same endpoint to decide
// whether it may dispatch. Two copies of "what has this cost" would eventually disagree, and the one
// that enforces the budget is the one that must be right.
export interface CardAccount {
  board: BoardName;
  card: string;
  spend: Spend;
  // Attempts that BURNED, per skill. Per skill because that is how the cap is counted — a critic or
  // checkup run on the same card must not inflate the tally of the skill doing the work.
  attempts: Record<string, number>;
}

export interface Accounting {
  project: Spend; // every run, card and project runs alike: everything a model did counts
  cards: CardAccount[];
  attemptCap: number;
  // Absent for a project with no auto-pilot block: there is no cap, so there is no cap to name. The UI
  // renders nothing rather than a number nobody set.
  cap?: { cap: CapName; why: string };
}

export function composeAccounting(
  runs: RunRecord[],
  ap: AutopilotConfig | undefined,
  iteration = 0,
): Accounting {
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
