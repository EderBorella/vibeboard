import type { FastifyInstance } from 'fastify';
import type { AutopilotStateName } from '../../core/autopilot-state.js';
import { type AppCtx, ensureOpen } from '../route-context.js';
import { type BoxBackend, boxName } from './containers.js';
import { ensureAgentImages } from './image-build.js';

// Throwing a project's boxes away, and nothing else.
//
// WHY THIS EXISTS AT ALL. `BoxManager.ensure` ADOPTS a healthy box rather than recreating it, which is
// deliberate — a container outlives the server and may hold an agent's session state — and it is also
// why a box that has drifted into a bad state cannot be fixed by restarting VibeBoard. The live case:
// the Claude credential is bind-mounted as a FILE, the host CLI refreshes it by atomic rename, and the
// box stays pinned to the old, now-deleted inode until the container is replaced.
//
// Admin-only BY ABSENCE from the scope table in auth.ts, and here that default is doing real work: an
// agent must not be able to destroy the box it is running inside.

// Both, always. A project's two boxes exist for credential isolation (see containers.ts) and drift
// hits them the same way, so there is no version of this that means one of them.
const BACKENDS: readonly BoxBackend[] = ['claude-code', 'opencode'];

// What is in flight, and why that refuses the rebuild. The predicates are the ones already in use, not
// new ones: `state === 'running'` is `stateConflict` and `dispatchLock` in autopilot/routes.ts and
// runs/routes.ts, and active-plus-queued is `activity()` in auth/signin-routes.ts — a run waiting for a
// slot is a dispatch already decided and will start on its own, so a rebuild racing it is the same
// accident a moment later.
//
// Named rather than inlined so the sentence, which is the only thing a person sees, can be asserted
// without a container anywhere near the test.
export function rebuildRefusal(activity: { runs: number; autopilot: AutopilotStateName }): string | null {
  if (activity.autopilot === 'running') {
    return 'Auto-pilot is running this project, so throwing its boxes away would kill the agent it has in flight. Soft-stop it from the auto-pilot panel first.';
  }
  if (activity.runs > 0) {
    const s = activity.runs === 1 ? '' : 's';
    return `${activity.runs} agent${s} ${activity.runs === 1 ? 'is' : 'are'} running on this project, so throwing the boxes away would kill ${activity.runs === 1 ? 'it' : 'them'} mid-turn. Wait, or stop the run${s} from the Execution dashboard.`;
  }
  return null;
}

// THE FRAMES A BUILD SENDS, and the first one is LAZY. `ensureAgentImages` is idempotent, so pressing
// the button on a machine that has both images is a legitimate no-op — and announcing a start and a done
// around it put every open browser's build log into "running" and out again for a build that never
// happened. Opening on the first STREAMED LINE means the frames describe something that occurred: no
// output, no build, nothing said. `useBuildLog` only ever leaves "running" on a start, so a no-op that
// says nothing leaves nothing behind either.
//
// Its own function, like `rebuildRefusal` above: the whole of the behaviour is which frames come out and
// in what order, and asserting that through the socket would need a browser to watch it.
export function buildFrames(send: (frame: { type: 'box:build'; state?: string; line?: string }) => void): {
  onLine: (line: string) => void;
  finish: (result: Awaited<ReturnType<typeof ensureAgentImages>>) => void;
} {
  let started = false;
  return {
    onLine(line) {
      if (!started) {
        started = true;
        send({ type: 'box:build', state: 'start' });
      }
      send({ type: 'box:build', line });
    },
    finish(result) {
      if (!started) return;
      send({ type: 'box:build', state: result === 'failed' || result === 'no-docker' ? 'failed' : 'done' });
    },
  };
}

export async function registerBoxRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.post('/boxes/rebuild', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const root = ctx.session.root;
    const state = await ctx.autopilot.current();
    const refusal = rebuildRefusal({
      runs: ctx.runner.activeIds.length + ctx.runner.queuedIds.length,
      autopilot: state.state,
    });
    if (refusal) return reply.code(409).send({ error: refusal });
    // No containers on this app at all. A 409 rather than `{ removed: 0 }`: answering success would
    // tell someone whose box is stuck that the thing they asked for happened.
    const boxes = ctx.boxes;
    if (!boxes) {
      return reply
        .code(409)
        .send({ error: 'This server is running without containers, so there are no boxes to rebuild.' });
    }
    // Asked BEFORE removing, because `stop` is `docker rm -f` and answers nothing — so a count taken
    // from the loop alone would report two removed on a project that had none, which is exactly the
    // false reassurance this control exists to avoid.
    const present = new Set(await boxes.manager.list());
    let removed = 0;
    for (const backend of BACKENDS) {
      if (!present.has(boxName(root, backend))) continue;
      await boxes.stop(root, backend);
      removed += 1;
    }
    // NOTHING IS RE-CREATED HERE, and that is why this route is short. `BoxService.ensure` runs before
    // every agent turn (see the note on it), so the next turn builds a fresh box on its own. Building
    // one eagerly would only mean guessing at a publish port and a command for a backend nobody has
    // asked to run yet.
    req.log.info({ root, removed }, 'agent boxes thrown away');
    return { ok: true, removed };
  });

  // BUILDING THE AGENT IMAGE FROM THE PRODUCT. The other half of the start-script build in main.ts, for
  // the machine where the server was already running when the image went missing — and the answer to a
  // refusal that used to print `npm run box:build` at someone with no repository to run it in.
  //
  // STREAMED OVER THE SOCKET, not returned at the end. This takes minutes, and a request that shows
  // nothing for minutes is indistinguishable from one that has hung — the same argument the copilot's
  // thinking indicator is built on. `box:build` frames carry one line each and the run transcript's
  // channel already exists to carry exactly this shape.
  api.post('/boxes/build', async (req, reply) => {
    const boxes = ctx.boxes;
    if (!boxes) {
      return reply.code(409).send({ error: 'This server is running without containers.' });
    }
    // REFUSED IF DOCKER ITSELF IS DOWN, rather than spending a failed build to discover it. `probe`
    // names which of the two is missing precisely so this can be told apart.
    //
    // A PRESENT WEB LAYER IS NOT A FINISHED JOB, so this no longer returns early on it: the base can be
    // absent on a machine whose `:latest` predates the split, and the ensurer is what notices. It is
    // idempotent, so "already" falls out of its answer rather than out of a second probe. decision 75.
    const before = await boxes.probe();
    if (!before.ok && before.missing !== 'image') return reply.code(409).send({ error: before.reason });

    const frames = buildFrames(ctx.broadcast);
    const result = await ensureAgentImages(boxes, frames.onLine);
    frames.finish(result);
    req.log.info({ result }, 'agent image build finished');
    if (result === 'failed' || result === 'no-docker') {
      return reply.code(500).send({ error: 'The build failed — the streamed lines carry the reason.' });
    }
    return { ok: true, already: result === 'present' };
  });
}
