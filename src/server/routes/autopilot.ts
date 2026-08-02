import type { FastifyInstance } from 'fastify';
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
import type { ProjectConfig } from '../../core/types.js';
import { type AppCtx, ensureOpen } from '../route-context.js';
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
  if (!config.autopilot) return problems; // coverageProblems has already said the only useful thing
  return [...problems, ...skillProblems(config.autopilot, skillSlugs)];
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
    routes: { problems: routeProblems, count: config.autopilot?.routes.length ?? 0 },
  };
}

export async function registerAutopilotRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
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
