import type { FastifyInstance } from 'fastify';
import { type AppCtx, ensureOpen } from '../route-context.js';
import { readSkills } from '../skill-catalogue.js';

// The skill catalogue. Read from disk per request rather than cached: the user (or an agent) can
// write a SKILL.md at any moment, and a stale rail is worse than a readdir.
export async function registerSkillRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.get('/skills', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    return readSkills(ctx.session.root, ctx.session.config);
  });
}
