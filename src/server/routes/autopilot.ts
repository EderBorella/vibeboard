import type { FastifyInstance } from 'fastify';
import {
  attemptsUsed,
  type CapName,
  governingCap,
  type Spend,
  spendByCard,
  sumSpend,
} from '../../core/accounting.js';
import { type AutopilotConfig, DEFAULT_AUTOPILOT } from '../../core/autopilot.js';
import { coverageProblems, skillProblems } from '../../core/autopilot-cover.js';
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
import { type AppCtx, ensureOpen } from '../route-context.js';
import { listRuns } from '../run-store.js';
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
}

// Everything wrong with this project, in the order a person would fix it: the lifecycle first (it is
// config), then the README (it is the input), then the documents derived from it.
function blockersFrom(routeProblems: string[], { readme, foundation, gates, smoke }: Read): string[] {
  return [
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
    routes: {
      problems: routeProblems,
      count: Array.isArray(config.autopilot?.routes) ? config.autopilot.routes.length : 0,
    },
  };
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
    return { state: await ctx.autopilot.current() };
  });

  // Stop dispatching. The app is untouched: chat, manual runs and the board all carry on.
  api.post('/autopilot/stop', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { detail } = (req.body ?? {}) as { detail?: string };
    const result = await ctx.autopilot.softStop(detail);
    if (!result.ok) return reply.code(409).send({ error: result.error });
    return { state: result.state };
  });

  // Everything project-related dies. Deliberately a separate endpoint from the soft stop rather than a
  // flag on it: one of these is reversible and the other kills work in flight, and a boolean in a body
  // is a poor place for that difference to live.
  api.post('/autopilot/kill', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { detail } = (req.body ?? {}) as { detail?: string };
    const result = await ctx.autopilot.emergencyStop(detail);
    if (!result.ok) return reply.code(409).send({ error: result.error });
    return { state: result.state };
  });

  // The way back to idle. Auto-pilot stays off until it is started separately.
  api.post('/autopilot/restart', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const result = await ctx.autopilot.restart();
    if (!result.ok) return reply.code(409).send({ error: result.error });
    return { state: result.state };
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
  cap: { cap: CapName; why: string };
}

export function composeAccounting(runs: RunRecord[], ap: AutopilotConfig | undefined): Accounting {
  const project = sumSpend(runs);
  const cards: CardAccount[] = [];
  for (const [key, spend] of spendByCard(runs)) {
    const [board, card] = key.split('/') as [BoardName, string];
    const skills = new Set(runs.filter((r) => r.card === card && r.board === board).map((r) => r.skill));
    const attempts: Record<string, number> = {};
    for (const skill of skills) attempts[skill] = attemptsUsed(runs, card, skill);
    cards.push({ board, card, spend, attempts });
  }
  // A project with no lifecycle block has no caps to be governed by, and saying "iterations" would
  // name a number that does not exist. DEFAULT_AUTOPILOT's values are what such a project would get
  // if it were upgraded, which is the honest thing to show beside a total.
  const caps = ap ?? DEFAULT_AUTOPILOT;
  return { project, cards, attemptCap: caps.attemptCap, cap: governingCap(caps, project) };
}

export async function registerAutopilotRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  // Readable by the SERVICE as well as the browser: slice C's loop compares this spend against the
  // budget between dispatches, and it is a separate process reaching the board over HTTP like anything
  // else. Not readable by `work` or `checkup`: an agent that can see how much room is left in the
  // budget is an agent reasoning about its own leash, which is not its business.
  api.get('/accounting', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    return composeAccounting(await listRuns(ctx.session.root), ctx.session.config.autopilot);
  });

  await registerControls(api, ctx);

  api.get('/autopilot/readiness', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { root, config } = ctx.session;
    const [readme, foundation, gates, smoke, catalogue] = await Promise.all([
      readmeGate(root),
      foundationStatus(root),
      readGates(root),
      readSmokeCommand(root),
      readSkills(root, config),
    ]);
    return composeReadiness(
      config,
      catalogue.skills.map((s) => s.slug),
      { readme, foundation, gates, smoke },
    );
  });
}
