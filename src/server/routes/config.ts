import type { FastifyInstance } from 'fastify';
import { applyRouteRenames } from '../../core/autopilot.js';
import { coverageProblems } from '../../core/autopilot-cover.js';
import { isRefused, reconcileColumns, validateColumns } from '../../core/columns.js';
import { writeConfig } from '../../core/config.js';
import type { BoardName, ProjectConfig } from '../../core/types.js';
import { BOARD_LABELS, BOARDS } from '../../core/types.js';
import { type AppCtx, ensureOpen } from '../route-context.js';

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

interface Refusal {
  code: number;
  error: string;
}
type Rename = { board: BoardName; from: string; to: string };

function isRefusal(r: Refusal | { renames: Rename[] }): r is Refusal {
  return 'error' in r;
}

// A column is a folder, so a column edit has to move folders too — otherwise the renamed column's
// cards stay in the old folder and silently vanish from the board. Every board is validated before
// any folder moves, so a bad name in one board cannot leave another half-reconciled.
//
// Returns the reply to send on refusal, or the renames it performed. The renames are the caller's
// business: a column is a folder AND a slug in the routing table, and moving the folder without
// rewriting the table deletes a route in silence.
async function applyColumnEdits(
  root: string,
  current: ProjectConfig,
  boards: Partial<ProjectConfig>['boards'],
): Promise<Refusal | { renames: Rename[] }> {
  if (!boards) return { renames: [] };
  for (const board of BOARDS) {
    const next = boards[board]?.columns;
    if (!next) continue;
    const invalid = validateColumns(next);
    if (invalid) return { code: 400, error: `${BOARD_LABELS[board]}: ${invalid}` };
  }
  const renames: Rename[] = [];
  for (const board of BOARDS) {
    const next = boards[board]?.columns;
    if (!next) continue;
    const result = await reconcileColumns(root, board, current.boards[board].columns, next);
    if (isRefused(result)) return { code: 409, error: `${BOARD_LABELS[board]}: ${result.error}` };
    for (const r of result.renamed) renames.push({ board, ...r });
  }
  return { renames };
}

// A rename is unambiguous — both slugs are known — so the table follows the folder rather than the
// user having to keep two places in step. Everything else that would leave a column unreachable is
// refused. A project with no autopilot block is untouched: migration of projects written before the
// lifecycle is one deliberate pass later, not a silent half-upgrade here.
function retableAndCheck(merged: ProjectConfig, renames: Rename[]): Refusal | null {
  if (!merged.autopilot) return null;
  for (const r of renames) {
    merged.autopilot = applyRouteRenames(merged.autopilot, r.board, [{ from: r.from, to: r.to }]);
  }
  const problems = coverageProblems(merged);
  return problems.length > 0 ? { code: 400, error: problems.join(' ') } : null;
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

    const edits = await applyColumnEdits(ctx.session.root, ctx.session.config, patch.boards);
    if (isRefusal(edits)) return reply.code(edits.code).send({ error: edits.error });

    const uncovered = retableAndCheck(merged, edits.renames);
    if (uncovered) return reply.code(uncovered.code).send({ error: uncovered.error });

    await writeConfig(ctx.session.root, merged);
    await ctx.session.reloadConfig();
    // Push the updated snapshot so all clients reflect the new config immediately (the
    // watcher would also fire, but this is instant and race-free for the backend toggle).
    ctx.broadcast({ type: 'snapshot', snapshot: await ctx.session.snapshot() });
    return ctx.session.config;
  });
}
