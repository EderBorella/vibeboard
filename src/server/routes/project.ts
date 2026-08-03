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
    // S7: SWITCHING is what is refused, which is why the path is compared. Otherwise the next dispatch
    // resolves against the new project, and `session.open`'s markInterrupted rewrites the live runs of
    // the old one to `interrupted` — a status that burns no attempt, corrupting the ledger of a run
    // still in flight.
    //
    // Reopening the project already open is not a switch: it is an ordinary thing to do from the
    // picker, and refusing it would deadlock the recovery path. A server that died mid-run leaves
    // `running` on disk with nothing behind it, and the reconcile that fixes that happens ON OPEN —
    // so a blanket refusal made the one state that needs reconciling the one state that cannot be.
    if (path !== ctx.session.root && (await ctx.autopilot.current()).state === 'running') {
      return reply.code(409).send({
        error: 'Auto-pilot is running in this project. Soft-stop it before opening another one.',
      });
    }
    try {
      const snapshot = await ctx.session.open(path, ctx.runner.activeIds);
      // Before anything else can ask: a project whose state file says `halted` must be halted from the
      // moment it is open, and one that says `running` gets reconciled here rather than resuming.
      await ctx.autopilot.load();
      await rememberProject(path); // reopened automatically on the next start
      return { snapshot };
    } catch {
      return reply.code(400).send({ error: 'Not a VibeBoard project' });
    }
  });

  api.post('/project/scaffold', async (req) => {
    const { path, name, mode } = req.body as { path: string; name: string; mode: ScaffoldMode };
    await scaffoldProject(path, { name, mode, today: today() });
    const snapshot = await ctx.session.open(path, ctx.runner.activeIds);
    await ctx.autopilot.load();
    await rememberProject(path);
    return { snapshot };
  });
}
