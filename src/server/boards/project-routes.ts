import { rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_BACKEND } from '../../core/backends.js';
import { deleteProjectTree, isProjectDir, notAProject } from '../../store/project/delete.js';
import { type ScaffoldMode, scaffoldProject } from '../../store/project/scaffold.js';
import { BOX_BACKENDS, type BoxBackend } from '../boxes/containers.js';
import { projectStateDir } from '../boxes/copilot-env.js';
import { stopOpencodeServer } from '../boxes/opencode-server.js';
import { type AppCtx, today } from '../route-context.js';
import { forgetProject, rememberProject } from '../settings/app-state.js';
import { discoverProjects } from './discover.js';

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

  // WHERE A PROJECT IS, said in full or not said at all.
  //
  // The New Project form concatenates a free-text parent folder with the name, so one missing leading
  // slash asked for `data/projects/calculator`. Nothing here made it absolute or refused it, and Node
  // resolves a relative path against the SERVER's working directory — so the project was created inside
  // the VibeBoard install. docker then refused its box ("includes invalid characters for a local volume
  // name": to `-v`, a relative string is a volume NAME), auto-pilot's pre-flight commit ran in
  // VibeBoard's own repository and stopped a run over a failure in VibeBoard's test suite, and the
  // project never got the `.git/hooks` pin its box depends on.
  //
  // REFUSED RATHER THAN RESOLVED. `resolve()` would have produced exactly that directory, silently, and
  // the same guess would be made again on the next relative path. From a browser, a relative path means
  // nobody has said where they meant — so the honest answer is to say so and write nothing.
  const notAbsolute = (path: unknown): string | undefined =>
    typeof path === 'string' && isAbsolute(path)
      ? undefined
      : `Give an absolute path, starting with "/". A relative one is resolved against VibeBoard's own folder rather than yours.`;

  api.post('/project/open', async (req, reply) => {
    const { path } = req.body as { path: string };
    const badPath = notAbsolute(path);
    if (badPath) return reply.code(400).send({ error: badPath });
    const refusal = await switchRefusal(path);
    if (refusal) return reply.code(409).send({ error: refusal });
    // The copilot's credential names the project it was minted against, exactly as a run's does. Ended
    // HERE rather than left to the next turn: `currentId` reloads the newest chat from disk, so coming
    // back to the original project would otherwise hand the same credential back with nobody having
    // re-authorised it — the failure `expireScope` exists for, reached by a different door.
    ctx.copilotAuthority.revoke();
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
    // FIRST, because this one writes: `scaffoldProject` creates the folder, the board and the git repo,
    // and a request refused after that leaves a real project the user has been told does not exist.
    const badPath = notAbsolute(path);
    if (badPath) return reply.code(400).send({ error: badPath });
    // Before anything is written: scaffolding creates a project AND opens it, so it is a switch.
    const refusal = await switchRefusal();
    if (refusal) return reply.code(409).send({ error: refusal });
    await scaffoldProject(path, { name, mode, today: today() });
    // The box is part of what creating a project PRODUCES, alongside its `.vibeboard/` folder —
    // ruled 2026-08-09. A project and the container its agents run in are one object, so there is no
    // state where one exists and the other was never made.
    //
    // NOT fatal, and this is deliberate: the files on disk are already written by the time we get
    // here, so failing the request would leave a real project the user is told does not exist. The
    // box is re-ensured before every turn anyway, so the only cost of a failure here is that the
    // first dispatch pays for the container start — and the reason is logged rather than swallowed.
    if (ctx.boxes) {
      try {
        // The project's own config is not loaded until it is opened, a line below, so this is the
        // product default. A project configured for the other backend simply builds that box on its
        // first turn instead — one container start, once.
        //
        // THE BACKEND IS THE ONLY THING GUESSED HERE. The box's SHAPE is not: `BoxService.ensure` reads
        // this project's config off disk itself, so the kind and the packages the scaffolder just wrote
        // are honoured on this first box rather than on the second. decision 75.
        await ctx.boxes.ensure(path, DEFAULT_BACKEND as BoxBackend);
      } catch (err) {
        req.log.warn({ err, path }, 'the project was created but its agent box was not');
      }
    }
    // THE SAME SHAPE AND THE SAME SENTENCE AS `open` ABOVE, because it is the same failure: a folder
    // on disk that will not read as a project. It was left bare while the only caller was a form on a
    // screen with a board behind it; the wizard's identity step has no project behind it, so an
    // unhandled throw here is a 500 on the one screen where that reads as the app having crashed.
    try {
      const snapshot = await ctx.session.open(path, ctx.runner.activeIds);
      await ctx.autopilot.load();
      await rememberProject(path);
      return { snapshot };
    } catch {
      return reply.code(400).send({ error: 'Not a VibeBoard project' });
    }
  });

  // WHY A DELETE IS REFUSED, kept apart from the doing of it so that neither is long enough to hide a
  // branch. Answers the status as well as the sentence: one of these is a bad request and two are a
  // conflict, and a route that flattened them would tell the UI the wrong thing to do about it.
  async function deleteRefusal(
    path: string,
    name: string | undefined,
  ): Promise<{ code: number; error: string } | undefined> {
    // REFUSED WHILE ANYTHING IS RUNNING, and both halves are needed. Auto-pilot may be dispatching into
    // this project from another process; a run may be live in a container whose working directory is
    // about to stop existing — which is precisely the dead-box failure `workdirProbeArgs` exists for,
    // manufactured on purpose.
    if ((await ctx.autopilot.current()).state === 'running') {
      return { code: 409, error: 'Auto-pilot is running. Soft-stop it before deleting this project.' };
    }
    if (samePath(path, ctx.session.root) && ctx.runner.activeIds.length > 0) {
      return { code: 409, error: 'A run is still going. Stop it before deleting this project.' };
    }
    // THE NAME IS THE CONFIRMATION, checked on the server and not only in the dialog. A confirm that
    // lives only in the browser is a confirm the API does not have — and this is the one call in
    // VibeBoard that destroys a person's work.
    const expected = basename(resolve(path));
    if (name !== expected) {
      return { code: 400, error: `Type the folder name — ${expected} — to confirm. Nothing was removed.` };
    }
    return undefined;
  }

  // LET GO OF THE PROJECT BEFORE THE FILES GO. A watcher on a directory being deleted, a container
  // bind-mounted at it, and a server whose working directory it is all behave badly when the ground
  // disappears underneath them — and none of them can be cleaned up afterwards by anything that has
  // forgotten where the project was.
  async function releaseProject(
    path: string,
    onBoxError: (err: unknown, backend: BoxBackend) => void,
  ): Promise<void> {
    if (samePath(path, ctx.session.root)) {
      ctx.copilotAuthority.revoke();
      stopOpencodeServer();
      await ctx.session.close();
    }
    if (!ctx.boxes) return;
    for (const backend of BOX_BACKENDS) {
      try {
        await ctx.boxes.stop(path, backend);
      } catch (err) {
        onBoxError(err, backend);
      }
    }
  }

  // DELETING A PROJECT — ruled 2026-09-01, and the list is five things rather than the three the entry
  // named. Everything VibeBoard creates for a project must be findable from the project alone, or a
  // delete leaves a remainder nothing will ever clean up while the user reasonably believes it is gone.
  //
  //   1. the project tree              — `deleteProjectTree`, which refuses anything without the marker
  //   2. its box or boxes              — by label, one per backend
  //   3. its agent state               — `~/.vibeboard/copilot/projects/<digest of the path>`
  //   4. `lastProject`, if it is this  — or the next start reopens a folder that is gone
  //   5. its OpenCode server, if live  — a server holding a working directory that no longer exists
  //
  // AND WHAT IS DELIBERATELY NOT TOUCHED, because every one of them is shared and app-level: the two
  // credential mirrors under `~/.cache/vibeboard/creds/`, `~/.vibeboard/token` and the device store,
  // `~/.vibeboard/run/api.sock`, and `logs/`, which prunes itself by day across every project.
  //
  // ADMIN ONLY, by being absent from the scope table in auth.ts. That is the default and it is the
  // right one here: no agent scope has any business deleting the project it is working in, and an
  // absent route is admin-only rather than open, which is the property that default exists for.
  api.post('/project/delete', async (req, reply) => {
    const { path, name } = req.body as { path: string; name?: string };
    const badPath = notAbsolute(path);
    if (badPath) return reply.code(400).send({ error: badPath });

    const refused = await deleteRefusal(path, name);
    if (refused) return reply.code(refused.code).send({ error: refused.error });
    // THE MARKER IS CHECKED BEFORE ANYTHING IS TORN DOWN. `deleteProjectTree` refuses a directory that is
    // not a VibeBoard project, and that refusal used to arrive AFTER the session had been closed, the
    // copilot's credential revoked and both boxes removed — so a project whose `config.yaml` had gone
    // missing since it was opened answered 400 and left the server with no open project and the browser
    // showing an error rather than reloading. Raised in review; the ordering was free to fix.
    if (!(await isProjectDir(path))) {
      return reply.code(400).send({ error: notAProject(path) });
    }
    await releaseProject(path, (err, backend) =>
      // Not fatal. A box that cannot be removed is a remainder worth logging, and refusing the whole
      // delete over it would leave the user with a project they have been told is gone.
      req.log.warn({ err, path, backend }, 'a box outlived the project it belonged to'),
    );

    const result = await deleteProjectTree(path);
    if (!result.ok) return reply.code(400).send({ error: result.reason });

    // AFTER the tree, because the digest is of the path and the path is all either of these needs — and
    // a failure here must not stop the tree being removed, which is the part the user asked for.
    await rm(projectStateDir(resolve(path)), { recursive: true, force: true }).catch((err: unknown) => {
      req.log.warn({ err, path }, 'the project was deleted but its agent state was not');
    });
    await forgetProject(path);
    return { removed: result.removed };
  });
}
