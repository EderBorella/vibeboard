import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { type ScaffoldMode, scaffoldProject } from '../../core/scaffold.js';
import { rememberProject } from '../app-state.js';
import { discoverProjects } from '../discover.js';
import { type AppCtx, today } from '../route-context.js';

export async function registerProjectRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.get('/state', async () =>
    ctx.session.isOpen ? { open: true, snapshot: await ctx.session.snapshot() } : { open: false },
  );

  api.get('/projects', async (req) => {
    const { root } = req.query as { root?: string };
    const base = root ?? process.env.VIBEBOARD_ROOT ?? dirname(process.cwd());
    return discoverProjects(base);
  });

  api.post('/project/open', async (req, reply) => {
    const { path } = req.body as { path: string };
    try {
      const snapshot = await ctx.session.open(path);
      await rememberProject(path); // reopened automatically on the next start
      return { snapshot };
    } catch {
      return reply.code(400).send({ error: 'Not a VibeBoard project' });
    }
  });

  api.post('/project/scaffold', async (req) => {
    const { path, name, mode } = req.body as { path: string; name: string; mode: ScaffoldMode };
    await scaffoldProject(path, { name, mode, today: today() });
    const snapshot = await ctx.session.open(path);
    await rememberProject(path);
    return { snapshot };
  });
}
