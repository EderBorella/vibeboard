import type { FastifyInstance } from 'fastify';
import { applyRouteRenames } from '../../core/autopilot.js';
import { coverageProblems, numberProblems, shapeProblems } from '../../core/autopilot-cover.js';
import type { BoardName, ProjectConfig } from '../../core/types.js';
import { BOARD_LABELS, BOARDS } from '../../core/types.js';
import { applyColumnPlan, isRefused, planColumnChanges, validateColumns } from '../../store/cards/columns.js';
import { writeConfig } from '../../store/project/config.js';
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
type BoardPlan = { board: BoardName; renamed: { from: string; to: string }[] };

function isRefusal(r: Refusal | { plans: BoardPlan[] }): r is Refusal {
  return 'error' in r;
}

// A column is a folder, so a column edit has to move folders too — otherwise the renamed column's
// cards stay in the old folder and silently vanish from the board.
//
// PLANS the moves; it does not make them. Nothing on disk may change until every reason to refuse
// has been considered, and one of those reasons — the routing table — lives outside this function.
// The Settings modal sends all three boards on every save, so renaming one board's columns and then
// refusing the request over another board's left the cards in a folder no column mapped to, invisible
// to the board and with their ids released for reuse. Reproduced before this was split.
async function planColumnEdits(
  root: string,
  current: ProjectConfig,
  boards: Partial<ProjectConfig>['boards'],
): Promise<Refusal | { plans: BoardPlan[] }> {
  if (!boards) return { plans: [] };
  for (const board of BOARDS) {
    const next = boards[board]?.columns;
    if (!next) continue;
    const invalid = validateColumns(next);
    if (invalid) return { code: 400, error: `${BOARD_LABELS[board]}: ${invalid}` };
  }
  const plans: BoardPlan[] = [];
  for (const board of BOARDS) {
    const next = boards[board]?.columns;
    if (!next) continue;
    const result = await planColumnChanges(root, board, current.boards[board].columns, next);
    if (isRefused(result)) return { code: 409, error: `${BOARD_LABELS[board]}: ${result.error}` };
    plans.push({ board, renamed: result.renamed });
  }
  return { plans };
}

const renamesOf = (plans: BoardPlan[]): Rename[] =>
  plans.flatMap((p) => p.renamed.map((r) => ({ board: p.board, ...r })));

// A rename is unambiguous — both slugs are known — so the table follows the folder rather than the
// user having to keep two places in step. Everything else that would leave a column unreachable is
// refused. A project with no autopilot block is untouched: migration of projects written before the
// lifecycle is one deliberate pass later, not a silent half-upgrade here.
function retableAndCheck(current: ProjectConfig, merged: ProjectConfig, renames: Rename[]): Refusal | null {
  // Removing the block is removing the gate. `mergeConfig` is a spread, so `{"autopilot": null}` was
  // a 200 that wrote `autopilot: null` to disk and turned every check below off for good — the one
  // request a caller could make to be rid of the validator entirely. A project that has a lifecycle
  // keeps it; one that never had it is untouched, which is the deferred-migration case.
  if (current.autopilot && !merged.autopilot) {
    return {
      code: 400,
      error:
        'That would remove the autopilot block, and with it the caps that bound a run and the columns that tell auto-pilot a card is finished. Edit `autopilot` in .vibeboard/config.yaml if you mean to change the lifecycle.',
    };
  }
  if (!merged.autopilot) return null;
  // Before the renames, not after: applyRouteRenames indexes into `terminal`, so a hand-edited block
  // missing it threw a TypeError and the request became a 500 with no explanation. The shape has to be
  // answerable before anything reads it.
  const malformed = shapeProblems(merged.autopilot);
  if (malformed.length > 0) return { code: 400, error: malformed.join(' ') };
  for (const r of renames) {
    merged.autopilot = applyRouteRenames(merged.autopilot, r.board, [{ from: r.from, to: r.to }]);
  }
  const problems = coverageProblems(merged);
  if (problems.length === 0) return null;
  // The remedy, not just the refusal. A message about a condition the user cannot see and cannot act on is
  // a worse failure than the condition — and this block is not editable from the UI, so without this
  // sentence the only way forward is to guess which file to open.
  //
  // But it is the remedy for a BLOCK problem, and it used to be appended to every problem including the
  // pure numbers: a cleared cap box was answered with `budgetUsd must be zero or more; it is null.` followed
  // by an instruction about column routing. Same shape as the bug this file already records as fixed — the
  // refusal spoke about columns while the user was changing something else.
  const numeric = new Set(merged.autopilot ? numberProblems(merged.autopilot) : []);
  if (problems.every((p) => numeric.has(p))) {
    return { code: 400, error: `${problems.join(' ')} Correct it in Settings.` };
  }
  return {
    code: 400,
    error: `${problems.join(' ')} Edit \`autopilot\` in .vibeboard/config.yaml — that block is not editable from Settings.`,
  };
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

    const planned = await planColumnEdits(ctx.session.root, ctx.session.config, patch.boards);
    if (isRefusal(planned)) return reply.code(planned.code).send({ error: planned.error });

    // Only when the patch actually touches the lifecycle. The cover check ran on EVERY patch, so a
    // project whose `autopilot` block was invalid for any reason — a hand edit, a config from a newer
    // version — could not save a single setting: the Settings modal sends `boards` on every save, and
    // the refusal spoke about columns while the user was changing their model. A pre-existing problem
    // is not this request's fault, and a save that changes nothing about the lifecycle cannot make it
    // worse. `in`, not a truthiness test, so an explicit `autopilot: null` still reaches the removal
    // guard rather than slipping past as absent.
    if (patch.boards !== undefined || 'autopilot' in patch) {
      const uncovered = retableAndCheck(ctx.session.config, merged, renamesOf(planned.plans));
      if (uncovered) return reply.code(uncovered.code).send({ error: uncovered.error });
    }

    // Nothing above this line has touched the filesystem. From here the request cannot be refused,
    // so the folders and the config move together.
    for (const plan of planned.plans) await applyColumnPlan(ctx.session.root, plan.board, plan);
    await writeConfig(ctx.session.root, merged);
    await ctx.session.reloadConfig();
    // Push the updated snapshot so all clients reflect the new config immediately (the
    // watcher would also fire, but this is instant and race-free for the backend toggle).
    ctx.broadcast({ type: 'snapshot', snapshot: await ctx.session.snapshot() });
    return ctx.session.config;
  });
}
