import type { FastifyInstance } from 'fastify';
import { writeConfig } from '../../core/config.js';
import { validateColumns, reconcileColumns, isRefused } from '../../core/columns.js';
import { BOARDS, BOARD_LABELS } from '../../core/types.js';
import type { ProjectConfig } from '../../core/types.js';
import { ensureOpen, type AppCtx } from '../route-context.js';

// Merge `boards` per board and `copilot.backends` per backend, not wholesale: a patch carrying
// one board would otherwise drop the others (and ensureBoards would silently reset them), and a
// patch naming one backend's slot would discard the other's remembered model — the loss that
// per-backend slots exist to prevent.
function mergeConfig(current: ProjectConfig, patch: Partial<ProjectConfig>): ProjectConfig {
  const backends = { ...current.copilot?.backends };
  for (const [name, slot] of Object.entries(patch.copilot?.backends ?? {})) {
    backends[name] = { ...backends[name], ...slot };
  }
  return {
    ...current,
    ...patch,
    copilot: { ...current.copilot, ...(patch.copilot ?? {}), backends },
    boards: { ...current.boards, ...(patch.boards ?? {}) },
  };
}

// A column is a folder, so a column edit has to move folders too — otherwise the renamed column's
// cards stay in the old folder and silently vanish from the board. Every board is validated before
// any folder moves, so a bad name in one board cannot leave another half-reconciled.
// Returns the reply to send on refusal, or null when it is safe to persist.
async function applyColumnEdits(
  root: string,
  current: ProjectConfig,
  boards: Partial<ProjectConfig>['boards'],
): Promise<{ code: number; error: string } | null> {
  if (!boards) return null;
  for (const board of BOARDS) {
    const next = boards[board]?.columns;
    if (!next) continue;
    const invalid = validateColumns(next);
    if (invalid) return { code: 400, error: `${BOARD_LABELS[board]}: ${invalid}` };
  }
  for (const board of BOARDS) {
    const next = boards[board]?.columns;
    if (!next) continue;
    const result = await reconcileColumns(root, board, current.boards[board].columns, next);
    if (isRefused(result)) return { code: 409, error: `${BOARD_LABELS[board]}: ${result.error}` };
  }
  return null;
}

export async function registerConfigRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.get('/config', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    return ctx.session.config;
  });

  api.patch('/config', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const patch = req.body as Partial<ProjectConfig>;
    const merged = mergeConfig(ctx.session.config, patch);

    const refusal = await applyColumnEdits(ctx.session.root, ctx.session.config, patch.boards);
    if (refusal) return reply.code(refusal.code).send({ error: refusal.error });

    await writeConfig(ctx.session.root, merged);
    await ctx.session.reloadConfig();
    // Push the updated snapshot so all clients reflect the new config immediately (the
    // watcher would also fire, but this is instant and race-free for the backend toggle).
    ctx.broadcast({ type: 'snapshot', snapshot: await ctx.session.snapshot() });
    return ctx.session.config;
  });
}
