import type { FastifyInstance } from 'fastify';
import { declaredCommands, writeSmokeCommand } from '../../core/foundation.js';
import { FOUNDATION_FILES, foundationRel } from '../../core/layout.js';
import { checkSmokeCommand } from '../../core/smoke-declaration.js';
import { updateAutopilotState } from '../autopilot-store.js';
import {
  createControlFile,
  deleteControlFile,
  listControlFiles,
  readControlFile,
  readResources,
  renameControlFile,
  writeControlFile,
  writeResources,
} from '../control-files.js';
import type { Scope } from '../credentials.js';
import { type AppCtx, ensureOpen } from '../route-context.js';

// The two documents whose contents are EXECUTED. `CODE-QUALITY.md` carries the `gates:` commands and
// `TESTING.md` the `smoke:` command, and both run through `/bin/sh` unsandboxed as the server's own
// user (exec/commands.ts). The other three foundation documents are prose and carry no such risk.
const EXECUTED = new Set(['CODE-QUALITY.md', 'TESTING.md']);

// Record that an AGENT rewrote a document whose commands the server will later run, so auto-pilot can
// refuse to start until a person has read them. The write itself is allowed — it is the execution that
// waits, which is where the escalation actually bites.
//
// `admin` is exempt because that is you, editing your own gates in Project Control; blocking on that
// would be a gate nobody could ever satisfy without dismissing it, which teaches everyone to dismiss it.
async function noteGateChange(ctx: AppCtx, scope: Scope | undefined, name: string): Promise<void> {
  if (scope === 'admin' || !EXECUTED.has(name)) return;
  const root = ctx.session.root;
  if (!root) return;
  const at = new Date().toISOString();
  await updateAutopilotState(root, at, (current) => ({
    ...current,
    // A set by hand: the same document rewritten three times is one thing to review, not three.
    unreviewedGates: [...new Set([...(current.unreviewedGates ?? []), name])],
  }));
  ctx.log.warn(
    { document: name, scope },
    'an agent changed a gate document; auto-pilot is blocked until it is reviewed',
  );
}

// Project Control: the file controller for documents that steer the models. Every path is
// sandboxed to the project root + an allow-list inside control-files.ts.
export async function registerControlRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.get('/control/files', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    return { groups: await listControlFiles(ctx.session.root) };
  });

  api.get('/control/file', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { path } = req.query as { path?: string };
    const file = await readControlFile(ctx.session.root, path);
    if (!file) return reply.code(400).send({ error: 'Path not allowed' });
    return file;
  });

  api.put('/control/file', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { path, content } = req.body as { path?: string; content?: string };
    const ok = await writeControlFile(ctx.session.root, path, content ?? '');
    if (!ok) return reply.code(400).send({ error: 'Path not allowed' });
    return { ok: true };
  });

  // THE ONE CONTROL-PLANE WRITE AN AGENT MAY MAKE, and only the `assist` scope — the chat copilot,
  // which has a person reading its answer as it types. Every autonomous scope is refused, because
  // these documents hold the gates a run is judged against.
  //
  // A dedicated route rather than a path allow-list on `PUT /control/file`: `allows()` in auth.ts is a
  // pure function of the route pattern and its params, and a rule that depended on the request body
  // would be a new category of thing that table can express.
  api.put('/control/foundation/:name', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { name } = req.params as { name: string };
    // The FIVE, by exact name. An allow-list rather than a traversal check, so `../config.yaml` and
    // `..%2fconfig.yaml` alike simply are not in the set — there is no path arithmetic to get wrong.
    if (!FOUNDATION_FILES.some((f) => f.name === name)) {
      return reply.code(400).send({
        error: `Not a foundation document. Expected one of: ${FOUNDATION_FILES.map((f) => f.name).join(', ')}.`,
      });
    }
    const { content } = req.body as { content?: string };
    if (typeof content !== 'string') return reply.code(400).send({ error: 'Expected `content`.' });
    // THE FLAG IS RECORDED BEFORE THE CONTENT IT DESCRIBES EXISTS. The other order fails open: if
    // recording it threw — a full disk, a permission problem — the document with agent-chosen commands
    // would already be on disk with nothing marking it, and the 500 would not say so. Marked first, a
    // failure means the write never happened, which is the safe half of the pair.
    await noteGateChange(ctx, req.credential?.scope, name);
    if (!(await writeControlFile(ctx.session.root, foundationRel(name), content))) {
      return reply.code(400).send({ error: 'Path not allowed' });
    }
    return { ok: true };
  });

  // Create with a default, collision-free name ("New doc", "New doc 2", …). The UI renames it
  // in place afterwards, so there is no browser dialog in the flow.
  // THE SMOKE COMMAND, AND ONE KEY OF ONE DOCUMENT (ruling 67; core/smoke-declaration.ts holds the argument
  // for why this is not decision 3 reopened). The route the harness feature needs in order to be finishable
  // at all: the card asks for a declaration in a file every autonomous scope is refused, and before this
  // existed the only honest thing an agent could do was report that it could not comply.
  //
  // NOT `PUT /control/foundation/:name` WITH A WIDER SCOPE, which would hand the same credential the `gates:`
  // list. The narrowness is the safety: one key, one validated single-line string, the prose and every other
  // key preserved by `writeSmokeCommand`.
  //
  // NO `noteGateChange`. Marking TESTING.md unreviewed here would stop auto-pilot in the middle of the run
  // that just fixed itself, and would do it for the write that ADDS the check rather than the one that could
  // weaken it — the escalation exists for the second and this is unambiguously the first.
  api.post('/foundation/smoke', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const root = ctx.session.root;
    if (!root) return reply.code(409).send({ error: 'No project is open' });
    const { command } = (req.body ?? {}) as { command?: unknown };
    const { gates } = await declaredCommands(root);
    const checked = checkSmokeCommand(command, gates);
    if (!checked.ok) return reply.code(400).send({ error: checked.reason });
    const written = await writeSmokeCommand(root, checked.command);
    if (!written.ok) return reply.code(400).send({ error: written.reason });
    // Loud on purpose: this is the one command a person did not choose that the server will later run, so the
    // project's own log is where they find out it happened and what it says.
    ctx.log.warn(
      { command: checked.command, scope: req.credential?.scope },
      'a run declared this project’s smoke command',
    );
    return { ok: true, command: checked.command };
  });

  api.post('/control/create', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { category } = req.body as { category?: string };
    const file = await createControlFile(ctx.session.root, category);
    if (!file) return reply.code(400).send({ error: 'Cannot create in that category' });
    return file;
  });

  api.post('/control/rename', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { path, name } = req.body as { path?: string; name?: string };
    const result = await renameControlFile(ctx.session.root, path, name);
    if (result === 'taken') return reply.code(409).send({ error: 'That name is already used' });
    if (!result) return reply.code(400).send({ error: 'Cannot rename that file' });
    return result;
  });

  api.delete('/control/file', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { path } = req.query as { path?: string };
    const result = await deleteControlFile(ctx.session.root, path);
    if (result === 'invalid') return reply.code(400).send({ error: 'Path not allowed' });
    if (result === 'not-allowed') return reply.code(400).send({ error: 'This file cannot be deleted' });
    return { ok: true };
  });

  api.get('/control/resources', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    return { links: await readResources(ctx.session.root) };
  });

  api.put('/control/resources', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { links } = req.body as { links?: unknown[] };
    await writeResources(ctx.session.root, links ?? []);
    return { ok: true };
  });
}
