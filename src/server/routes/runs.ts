import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { attemptsUsed, sumSpend } from '../../core/accounting.js';
import { DEFAULT_AUTOPILOT } from '../../core/autopilot.js';
import type { AutopilotState } from '../../core/autopilot-state.js';
import { boardColumnSlugs, readBoard } from '../../core/board.js';
import { resolveCopilotSelection } from '../../core/copilot-choice.js';
import { findCard } from '../../core/find.js';
import { foundationStatus, readGates } from '../../core/foundation.js';
import { foundationRel } from '../../core/layout.js';
import { BOARDS, type BoardName, type ProjectConfig } from '../../core/types.js';
import type { DispatchInput } from '../agent-runner.js';
import type { Backend } from '../agent-turn.js';
import { readResources } from '../control-files.js';
import { attachedOpencodeUrl } from '../opencode-server.js';
import { type AppCtx, ensureOpen, nowIso } from '../route-context.js';
import type { BoardColumns } from '../run-prompt.js';
import { listCardRuns, listRuns, readRun, resolveProjectRun, resolveRun } from '../run-store.js';
import { agentRefusal } from '../sandbox.js';
import { readSkills } from '../skill-catalogue.js';

// Dispatching and reading runs.
//
// The route layer resolves everything the runner should not have to know: which card, which skill,
// which cards it links to, and which backend/model/effort a bare request means. The runner takes
// facts and produces a record.

// Why a manual dispatch cannot happen right now, or nothing. Separated from the handler because it
// is a rule rather than plumbing, and because both sentences have to offer a way forward: a refusal
// about a state the user cannot see and cannot act on is worse than the state itself.
function dispatchLock(state: AutopilotState): string | undefined {
  if (state.state === 'halted') {
    return 'This project is halted, so nothing can be dispatched. Restart it from the auto-pilot panel first.';
  }
  if (state.state === 'running') {
    return 'Auto-pilot is running this project, so it owns the runner. Soft-stop it first if you want to dispatch a run by hand.';
  }
  return undefined;
}

function isBoard(value: unknown): value is BoardName {
  return typeof value === 'string' && (BOARDS as readonly string[]).includes(value);
}

interface DispatchBody {
  board?: string;
  card?: string;
  skill?: string;
  prompt?: string;
  attachments?: string[];
  previous?: string;
  backend?: string;
  model?: string;
  effort?: string;
  mode?: string;
}

// EVERY board's columns, never just the skill's. `Skill.boards` scopes where a skill may be
// dispatched FROM, not where it may write to: the break-down skill is scoped to features and product
// precisely so it can turn one of those cards into engineering cards. Scoping this to `skill.boards`
// would therefore have left the agent guessing at exactly the board it was sent to write to — the
// hole this section exists to close. (An empty `skill.boards` means every board anyway, so half the
// skills would get all three regardless; three short lines is not worth a rule with two answers.)
function everyBoardColumns(config: ProjectConfig): BoardColumns[] {
  return BOARDS.map((board) => {
    // Index-parallel by construction: boardColumnSlugs is a 1:1 map over this same list.
    const slugs = boardColumnSlugs(config, board);
    return {
      board,
      columns: config.boards[board].columns.map((name, i) => ({ name, slug: slugs[i] })),
    };
  });
}

// Turn a request into everything the runner needs, or into the refusal to send back. Separated from
// the route so the handler is dispatch-and-report while the gathering — six ways to be wrong, three
// reads from disk — lives on its own.
async function resolveDispatch(
  ctx: AppCtx,
  body: DispatchBody,
): Promise<{ input: DispatchInput } | { code: number; error: string }> {
  const root = ctx.session.root;
  const config = ctx.session.config;
  if (!root || !config) return { code: 409, error: 'No project open' };
  if (!isBoard(body.board)) return { code: 400, error: 'Unknown board' };

  const card = await findCard(root, body.board, body.card ?? '', config);
  if (!card) return { code: 404, error: 'No such card' };
  // An archived card is not in the snapshot, so nothing could show what a run did to it.
  if (card.archived) return { code: 409, error: 'That card is archived' };

  const { skills } = await readSkills(root, config);
  const skill = skills.find((s) => s.slug === body.skill);
  if (!skill) return { code: 404, error: 'No such skill' };

  let cardFile: string;
  try {
    cardFile = await readFile(card.filePath, 'utf8');
  } catch {
    return { code: 409, error: 'That card has no file on disk any more' };
  }

  // A dispatch may name any of backend/model/effort, or none: the project's saved selection fills
  // the rest, through the same precedence the chat uses.
  const choice = resolveCopilotSelection(config.copilot, {
    backend: body.backend,
    model: body.model,
    effort: body.effort,
  });

  // Linked cards, resolved live rather than from the client's view of them.
  const everyCard = (await Promise.all(BOARDS.map((b) => readBoard(root, b, config)))).flat();
  const linked = card.links
    .map((id) => everyCard.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined);

  const previous = body.previous
    ? ((await readRun(root, body.board, card.id, body.previous)) ?? undefined)
    : undefined;

  // Only the documents that exist. A path list naming a file that is not there teaches an agent that
  // the paths in this prompt are approximate, and the next one it cannot find it will not look for.
  const foundation = await foundationStatus(root);
  // Inlined under "the gates your work must pass, in full" only if it actually declares gates.
  // `present` means the file exists and is non-empty — so a CODE-QUALITY.md of prose with no `gates:`
  // frontmatter, or frontmatter that will not parse, was handed to the agent under a heading
  // asserting it contained the bar, containing no bar. Readiness would refuse such a project, but
  // nothing on the dispatch path consults readiness.
  const codeQuality = (await readGates(root)).ok
    ? await readFile(join(root, foundationRel('CODE-QUALITY.md')), 'utf8')
    : undefined;

  return {
    input: {
      skill,
      card,
      boardColumns: everyBoardColumns(config),
      cardFile,
      linked,
      attachments: Array.isArray(body.attachments) ? body.attachments.map(String) : [],
      links: await readResources(root),
      previous,
      userPrompt: body.prompt,
      foundation: {
        paths: foundation.present.map(foundationRel),
        ...(codeQuality ? { codeQuality } : {}),
      },
      backend: choice.backend as Backend,
      model: choice.model,
      effort: choice.effort,
      mode: body.mode ?? 'bypassPermissions',
    },
  };
}

export async function registerRunRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  // Every run in the project, newest first — the Execution dashboard's list.
  api.get('/runs', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    return {
      runs: await listRuns(ctx.session.root),
      active: ctx.runner.activeIds,
      queued: ctx.runner.queuedIds,
    };
  });

  // One card's history, oldest first: the Reports section on the card — with that card's own ledger
  // line beside it. Computed here rather than in the browser because it is the same arithmetic the
  // budget is enforced with, and one statement of it is the whole point (see routes/autopilot.ts).
  // Carried on this response rather than fetched separately, so the card pane makes one request.
  api.get('/runs/:board/:card', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, card } = req.params as { board: string; card: string };
    if (!isBoard(board)) return reply.code(400).send({ error: 'Unknown board' });
    const runs = await listCardRuns(ctx.session.root, board, card);
    const attempts: Record<string, number> = {};
    for (const skill of new Set(runs.map((r) => r.skill))) attempts[skill] = attemptsUsed(runs, card, skill);
    return {
      runs,
      account: {
        spend: sumSpend(runs),
        attempts,
        attemptCap: (ctx.session.config.autopilot ?? DEFAULT_AUTOPILOT).attemptCap,
      },
    };
  });

  api.post('/runs', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    // Before anything is resolved or written: a run that cannot be confined is a run that does not
    // start. 412 rather than 403 — the request is fine, the machine is not in a state to serve it.
    const refusal = agentRefusal(ctx.sandbox, attachedOpencodeUrl());
    if (refusal) return reply.code(412).send({ error: refusal });
    // Then the project's own state. Halted means nothing dispatches at all; running means auto-pilot
    // owns this project, and S6 is the reason — the runner, the concurrency cap and the queue are
    // shared, so a manual dispatch would queue ahead of the loop's next one and make
    // `autoPilotConcurrency: 1` aspirational rather than true. Both refusals say what to do instead.
    const locked = dispatchLock(await ctx.autopilot.current());
    if (locked) return reply.code(409).send({ error: locked });
    const resolved = await resolveDispatch(ctx, req.body as DispatchBody);
    if ('error' in resolved) return reply.code(resolved.code).send({ error: resolved.error });
    try {
      return { run: await ctx.runner.dispatch(resolved.input) };
    } catch (err) {
      // The cap, today. Phase 5 replaces it with a queue, at which point this stops being a refusal.
      return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // "I have dealt with this." Board and card in the path, like the list above: a run id is unique,
  // but finding its record without them would mean walking every results folder.
  api.post('/runs/:board/:card/:run/resolve', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, card, run } = req.params as { board: string; card: string; run: string };
    if (!isBoard(board)) return reply.code(400).send({ error: 'Unknown board' });
    const record = await resolveRun(ctx.session.root, board, card, run, nowIso());
    if (!record) return reply.code(404).send({ error: 'No such run' });
    return { run: record };
  });

  // The same decision, for a run with no card in its path to find it by: the checkup and pre-flight
  // are about the project. A separate route rather than an optional segment, so the card route keeps
  // refusing a request that forgot which board it meant.
  api.post('/project-runs/:run/resolve', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { run } = req.params as { run: string };
    const record = await resolveProjectRun(ctx.session.root, run, nowIso());
    if (!record) return reply.code(404).send({ error: 'No such run' });
    return { run: record };
  });

  api.post('/runs/:run/cancel', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { run } = req.params as { run: string };
    if (!ctx.runner.cancel(run)) return reply.code(404).send({ error: 'That run is not in flight' });
    return { ok: true, at: nowIso() };
  });
}
