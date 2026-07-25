import type { FastifyInstance } from 'fastify';
import { writeConfig } from '../../core/config.js';
import { validateColumns, reconcileColumns, isRefused } from '../../core/columns.js';
import { BOARDS, BOARD_LABELS } from '../../core/types.js';
import type { ProjectConfig } from '../../core/types.js';
import { ensureOpen, type AppCtx } from '../route-context.js';

export async function registerConfigRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.get('/config', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    return ctx.session.config;
  });

  api.patch('/config', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const patch = req.body as Partial<ProjectConfig>;
    // Merge `boards` per board, not wholesale: a patch carrying only one board would
    // otherwise drop the others, and ensureBoards would silently reset them to defaults.
    // Same for `copilot.backends`, per backend: a patch naming one backend's slot must not
    // discard the other's remembered model — that loss is the bug per-backend slots fix.
    const backends = { ...ctx.session.config!.copilot?.backends };
    for (const [name, slot] of Object.entries(patch.copilot?.backends ?? {})) {
      backends[name] = { ...backends[name], ...slot };
    }
    const merged: ProjectConfig = {
      ...ctx.session.config!,
      ...patch,
      copilot: { ...ctx.session.config!.copilot, ...(patch.copilot ?? {}), backends },
      boards: { ...ctx.session.config!.boards, ...(patch.boards ?? {}) },
    };

    // A column is a folder, so a column edit has to move folders too — otherwise the renamed
    // column's cards stay in the old folder and silently vanish from the board. Validate and
    // reconcile before persisting; refuse the whole save if any board can't be reconciled.
    if (patch.boards) {
      for (const board of BOARDS) {
        const next = patch.boards[board]?.columns;
        if (!next) continue;
        const invalid = validateColumns(next);
        if (invalid) return reply.code(400).send({ error: `${BOARD_LABELS[board]}: ${invalid}` });
      }
      for (const board of BOARDS) {
        const next = patch.boards[board]?.columns;
        if (!next) continue;
        const result = await reconcileColumns(ctx.session.root!, board, ctx.session.config!.boards[board].columns, next);
        if (isRefused(result)) return reply.code(409).send({ error: `${BOARD_LABELS[board]}: ${result.error}` });
      }
    }

    await writeConfig(ctx.session.root!, merged);
    await ctx.session.reloadConfig();
    // Push the updated snapshot so all clients reflect the new config immediately (the
    // watcher would also fire, but this is instant and race-free for the backend toggle).
    ctx.broadcast({ type: 'snapshot', snapshot: await ctx.session.snapshot() });
    return ctx.session.config;
  });
}
