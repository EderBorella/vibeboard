import { dirname, resolve } from 'node:path';
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

  // S7: SWITCHING project is what is refused. Otherwise the next dispatch resolves against the new
  // project, and `session.open`'s markInterrupted rewrites the live runs of the old one to
  // `interrupted` — a status that burns no attempt, corrupting the ledger of a run still in flight.
  // Every in-flight run credential is invalidated too, since a credential names the project it was
  // minted against (auth.ts).
  //
  // Reopening the project already open is not a switch: it is an ordinary thing to do from the picker,
  // and refusing it would deadlock the recovery path. A server that died mid-run leaves `running` on
  // disk with nothing behind it, and the reconcile that fixes that happens ON OPEN — so a blanket
  // refusal made the one state that needs reconciling the one state that cannot be.
  //
  // Two spellings of one folder are one folder. A raw string compare meant reopening the OPEN project
  // with a trailing slash — or any un-normalised spelling — read as a switch and was refused while
  // running, which is the deadlock the reconcile-on-open path cannot survive: the state that most needs
  // reconciling would be the one state that could not be.
  const samePath = (a: string, b: string | undefined): boolean =>
    b !== undefined && resolve(a) === resolve(b);

  // Shared by both handlers, because it was on `open` alone: scaffolding walked straight through it,
  // and the button that does it sits in the same picker. A refusal reachable by the adjacent button is
  // not a refusal. Scaffold's target is by definition not the open project, so it passes no path.
  async function switchRefusal(path?: string): Promise<string | undefined> {
    if (path !== undefined && samePath(path, ctx.session.root)) return undefined;
    if ((await ctx.autopilot.current()).state !== 'running') return undefined;
    return 'Auto-pilot is running in this project. Soft-stop it before opening or creating another one.';
  }

  api.post('/project/open', async (req, reply) => {
    const { path } = req.body as { path: string };
    const refusal = await switchRefusal(path);
    if (refusal) return reply.code(409).send({ error: refusal });
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

  api.post('/project/scaffold', async (req, reply) => {
    const { path, name, mode } = req.body as { path: string; name: string; mode: ScaffoldMode };
    // Before anything is written: scaffolding creates a project AND opens it, so it is a switch.
    const refusal = await switchRefusal();
    if (refusal) return reply.code(409).send({ error: refusal });
    await scaffoldProject(path, { name, mode, today: today() });
    const snapshot = await ctx.session.open(path, ctx.runner.activeIds);
    await ctx.autopilot.load();
    await rememberProject(path);
    return { snapshot };
  });
}
