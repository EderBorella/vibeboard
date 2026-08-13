import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { attemptsUsed, sumSpend } from '../../core/accounting.js';
import { DEFAULT_AUTOPILOT } from '../../core/autopilot.js';
import type { AutopilotState } from '../../core/autopilot-state.js';
import { unreviewedGatesSentence } from '../../core/autopilot-state.js';
import { boardColumnSlugs, readBoard } from '../../core/board.js';
import { resolveCopilotSelection } from '../../core/copilot-choice.js';
import { findCard } from '../../core/find.js';
import { foundationStatus, readGates } from '../../core/foundation.js';
import { foundationRel } from '../../core/layout.js';
import { phase } from '../../core/phases.js';
import { asVerification, isRunId, type RunRecord, withVerification } from '../../core/runs.js';
import { BOARDS, type BoardName, type ProjectConfig } from '../../core/types.js';
import type { DispatchInput } from '../agent-runner.js';
import type { Backend } from '../agent-turn.js';
import { readResources } from '../control-files.js';
import type { Scope } from '../credentials.js';
import { attachedOpencodeUrl } from '../opencode-server.js';
import { type AppCtx, ensureOpen, nowIso } from '../route-context.js';
import type { BoardColumns } from '../run-prompt.js';
import { listCardRuns, listRuns, readRun, resolveProjectRun, resolveRun, writeRun } from '../run-store.js';
import { agentRefusal } from '../sandbox.js';
import { readSkills } from '../skill-catalogue.js';

// Dispatching and reading runs.
//
// The route layer resolves everything the runner should not have to know: which card, which skill,
// which cards it links to, and which backend/model/effort a bare request means. The runner takes
// facts and produces a record.

// A run id reaches these routes as a URL segment and ends up inside a filesystem path, so the shape is
// checked before the store is touched. The store refuses it too — this is the half that gives the
// caller a 400 and a sentence instead of a 500.
const NOT_A_RUN_ID = 'That is not a run id.';

// Why this dispatch cannot happen right now, or nothing. Separated from the handler because it is a
// rule rather than plumbing, and because every sentence has to offer a way forward: a refusal about a
// state the user cannot see and cannot act on is worse than the state itself.
//
// The SCOPE matters, and it is the whole of C2's change here. `running` means auto-pilot owns this
// project's runner, so a by-hand dispatch is refused (S6: the runner, the concurrency cap and the queue
// are shared, so a manual run would queue ahead of the loop's next one and make `autoPilotConcurrency: 1`
// aspirational). The service dispatching while `running` is not a competing caller — it IS the loop, and
// refusing it would refuse the only state in which it ever works.
//
// `halted` stays absolute. Nothing dispatches, the service included: halted is the state a person has to
// leave deliberately, and a loop that could still dispatch inside it would make the emergency stop a
// suggestion.
// Exported so the rule can be tested directly, for the same reason `allows` is: planting showed the
// halted branch here was held by NOTHING through the app, because agent-runner.ts refuses a halted
// project again on the far side of every await and produces the same sentence. That second guard is
// deliberate defence in depth — but a branch whose removal changes no test is a branch that does not
// work, whatever else happens to catch it.
export function dispatchLock(state: AutopilotState, scope: Scope | undefined): string | undefined {
  // First, and for everyone. Halted is the state a person has to leave deliberately (decision 12); a loop
  // that could still dispatch inside it would make the emergency stop a suggestion.
  if (state.state === 'halted') {
    return 'This project is halted, so nothing can be dispatched. Restart it from the auto-pilot panel first.';
  }
  // The service's authority is CO-TERMINOUS WITH `running`, stated as what is allowed rather than as what
  // is refused. Written the other way round — "not a by-hand caller while running" — it admitted the loop
  // while `idle` and while `stopped`, and `stopped` is what a soft stop produces: the runtime writes it
  // and kills nothing, so the soft stop was enforced by the loop's own cooperation and by no layer at
  // all. A stale token was then a dispatching one for the life of the server.
  if (scope === 'service') {
    if (state.state === 'running') return undefined;
    return `Auto-pilot is ${state.state}, so its loop has no authority to dispatch. Start it from the auto-pilot panel.`;
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
  // A run about the PROJECT rather than a card: the bootstrap, which derives the board from the README and so
  // has no card to be dispatched against (see `bootstrapSkill` in core/autopilot.ts). Explicit rather than
  // inferred from a missing `card`, because a request that simply forgot which card it meant must keep getting
  // its 404 — inferring would turn every such mistake into a silently different, more powerful run.
  project?: boolean;
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

// A REVIEW run JUDGES rather than builds, so it gets the judging contract — including when a person
// dispatches one by hand from the card. Without this the skill file would say "give a verdict" while the
// prompt asked for an ordinary report: no `verdict:` field, no values, and an answer nothing could act on.
//
// COMPUTED HERE rather than accepted, which is ruling 63's own precedent: where the server can work a fact
// out, it still should. The two facts inside it cannot be — whether the gates passed and whether the card is
// in the setup subtree are the loop's, so they arrive on the body under a `service` credential and default to
// the honest "nothing has run for this" for anyone else.
//
// The skill name comes from the PHASE TABLE (ruling 52), not a constant of its own: three copies of a slug is
// three places for it to drift.
function reviewFor(slug: string): { review?: { gatesPassed: boolean; setupSubtree: boolean } } {
  if (slug !== phase('task-review').skill) return {};
  return { review: { gatesPassed: false, setupSubtree: false } };
}

// Turn a request into everything the runner needs, or into the refusal to send back. Separated from
// the route so the handler is dispatch-and-report while the gathering — six ways to be wrong, three
// reads from disk — lives on its own.
// The run this one follows, or the refusal to send back.
//
// A NAMED `previous` THAT CANNOT BE READ IS A REFUSAL, not an absence. `readRun` swallows every failure and
// answers null, and mapping that to `undefined` failed OPEN in the worst place: a critic dispatch whose subject
// went missing renders the GENERAL judging contract — "you are judging work that is already done", with no run
// named — which is verbatim the state that let a judge score a dead run 1 and advance the card over it. The
// loop could not detect it either, because the dispatch answered 200. Found in review (2026-08-06).
//
// Its own function because `resolveDispatch` is already at the complexity the gate allows, and this is a
// self-contained question: which run, or why not.
async function resolvePrevious(
  root: string,
  body: DispatchBody,
  card: string,
): Promise<{ run: RunRecord } | { code: number; error: string } | undefined> {
  if (!body.previous || !isBoard(body.board)) return undefined;
  const found = await readRun(root, body.board, card, body.previous);
  if (found) return { run: found };
  return {
    code: 409,
    error: `There is no run ${body.previous} on ${card}, so there is nothing for this run to continue or to judge.`,
  };
}

// Everything a dispatch needs that does NOT depend on there being a card: the columns, the resources, the
// foundation documents, and which backend/model/effort a bare request means. One home, because the card path
// and the project path need all of it and a second copy would drift the moment one gained a field.
async function dispatchFrame(
  root: string,
  config: ProjectConfig,
  body: DispatchBody,
): Promise<
  Pick<
    DispatchInput,
    'boardColumns' | 'links' | 'foundation' | 'backend' | 'model' | 'effort' | 'mode' | 'attachments'
  >
> {
  // A dispatch may name any of backend/model/effort, or none: the project's saved selection fills
  // the rest, through the same precedence the chat uses.
  const choice = resolveCopilotSelection(config.copilot, {
    backend: body.backend,
    model: body.model,
    effort: body.effort,
  });
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
    boardColumns: everyBoardColumns(config),
    links: await readResources(root),
    attachments: Array.isArray(body.attachments) ? body.attachments.map(String) : [],
    foundation: {
      paths: foundation.present.map(foundationRel),
      ...(codeQuality ? { codeQuality } : {}),
    },
    backend: choice.backend as Backend,
    model: choice.model,
    effort: choice.effort,
    mode: body.mode ?? 'bypassPermissions',
  };
}

// A run about the project. No card, no card file, no linked cards and no previous run: there is no card for any
// of them to hang off, and `resolvePrevious` needs a board to find one on.
async function resolveProjectDispatch(
  root: string,
  config: ProjectConfig,
  body: DispatchBody,
): Promise<{ input: DispatchInput } | { code: number; error: string }> {
  const { skills } = await readSkills(root, config);
  const skill = skills.find((s) => s.slug === body.skill);
  if (!skill) return { code: 404, error: 'No such skill' };
  return {
    input: {
      skill,
      linked: [],
      userPrompt: body.prompt,
      ...(await dispatchFrame(root, config, body)),
    },
  };
}

async function resolveDispatch(
  ctx: AppCtx,
  body: DispatchBody,
): Promise<{ input: DispatchInput } | { code: number; error: string }> {
  const root = ctx.session.root;
  const config = ctx.session.config;
  if (!root || !config) return { code: 409, error: 'No project open' };
  if (body.project === true) return await resolveProjectDispatch(root, config, body);
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

  // Linked cards, resolved live rather than from the client's view of them.
  const everyCard = (await Promise.all(BOARDS.map((b) => readBoard(root, b, config)))).flat();
  const linked = card.links
    .map((id) => everyCard.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined);

  const previous = await resolvePrevious(root, body, card.id);
  if (previous && 'error' in previous) return previous;

  return {
    input: {
      skill,
      card,
      ...reviewFor(skill.slug),
      cardFile,
      linked,
      ...(previous ? { previous: previous.run } : {}),
      userPrompt: body.prompt,
      ...(await dispatchFrame(root, config, body)),
    },
  };
}

// The refusal when an agent has rewritten a gate document and nobody has read it. Named rather than
// inlined so the dispatch handler stays under its complexity budget — flattening beats a suppression —
// and so the sentence, which is the only thing a person sees, can be tested without dispatching.
export function unreviewedGatesRefusal(names: string[] | undefined): string | undefined {
  if (!names || names.length === 0) return undefined;
  // The wording lives in core/autopilot-state.ts, beside the flag it describes. It was written twice
  // before, and only one copy told you how to clear it.
  return unreviewedGatesSentence(names);
}

// Everything that refuses a dispatch before anything is resolved or written, in the order it is asked. Its own
// function rather than four guards in the handler — flattening beats a suppression, and the handler is then
// dispatch-and-report while the refusals, each of which is a rule with a history, sit together.
async function dispatchRefusal(
  ctx: AppCtx,
  body: DispatchBody,
  scope: Scope | undefined,
): Promise<{ code: number; error: string } | undefined> {
  // A run that cannot be confined is a run that does not start. 412 rather than 403 — the request is fine, the
  // machine is not in a state to serve it.
  const refusal = agentRefusal(ctx.sandbox, attachedOpencodeUrl());
  if (refusal) return { code: 412, error: refusal };
  // Then the project's own state. Halted means nothing dispatches at all; running means auto-pilot
  // owns this project, and S6 is the reason — the runner, the concurrency cap and the queue are
  // shared, so a manual dispatch would queue ahead of the loop's next one and make
  // `autoPilotConcurrency: 1` aspirational rather than true. Both refusals say what to do instead.
  const state = await ctx.autopilot.current();
  const locked = dispatchLock(state, scope);
  if (locked) return { code: 409, error: locked };
  // AND THE GATES NOBODY HAS READ. Blocking `POST /autopilot/start` alone was not enough: a loop that
  // is ALREADY running dispatches without passing through start, and the verifier re-reads
  // foundation/CODE-QUALITY.md fresh for every card (server/verifier.ts) — so an authorised copilot
  // rewriting it mid-run had its commands executed on the next dispatch, outside the sandbox, as the
  // server's user. "The write is allowed; the execution waits" was false in exactly that window,
  // which is the window an agent is most able to reach.
  //
  // Refusing the dispatch stops the loop with a reason rather than killing it, so the work already in
  // flight finishes and the person is told what to look at.
  const unreviewed = unreviewedGatesRefusal(state.unreviewedGates);
  if (unreviewed) return { code: 412, error: unreviewed };
  // A PROJECT run is the loop's alone. It is the only run confined to no card — decision 5's scope spiral is
  // exactly what a card gives you — and the only caller with a reason to start one is the loop deriving an
  // empty board. Anyone at the browser is dispatching FROM a card and has one to name.
  if (body?.project === true && scope !== 'service') {
    return {
      code: 403,
      error:
        'Only auto-pilot may start a run with no card. Dispatch this skill from a card, or let auto-pilot derive the board.',
    };
  }
  return undefined;
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
    const body = req.body as DispatchBody;
    const stopped = await dispatchRefusal(ctx, body, req.credential?.scope);
    if (stopped) return reply.code(stopped.code).send({ error: stopped.error });
    const resolved = await resolveDispatch(ctx, body);
    if ('error' in resolved) return reply.code(resolved.code).send({ error: resolved.error });
    try {
      return { run: await ctx.runner.dispatch(resolved.input) };
    } catch (err) {
      // The cap, today. Phase 5 replaces it with a queue, at which point this stops being a refusal.
      return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // The VERDICT on a run, written by the loop that judged it. Decision 18: a verdict carries its evidence,
  // and it belongs to the record of the run it judged — so "why did this card advance?" is answerable from
  // disk months later.
  //
  // Service-scoped. Neither working scope may reach it, and that is the whole of decision 3: a run that
  // could write its own verification would be a run advancing itself on self-assessment, which is the one
  // thing this design exists to prevent. The verdict is validated on the way in by `asVerification`, which
  // drops a critic score that does not agree with its own threshold.
  api.post('/runs/:board/:card/:run/verification', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, card, run } = req.params as { board: string; card: string; run: string };
    if (!isBoard(board)) return reply.code(400).send({ error: 'Unknown board' });
    if (!isRunId(run)) return reply.code(400).send({ error: NOT_A_RUN_ID });
    const verification = asVerification((req.body ?? {}) as Record<string, unknown>);
    if (!verification) {
      return reply
        .code(400)
        .send({ error: 'That is not a verification: it needs a mode, a passed and an at.' });
    }
    const record = await readRun(ctx.session.root, board, card, run);
    if (!record) return reply.code(404).send({ error: 'No such run' });
    const judged = withVerification(record, verification);
    await writeRun(ctx.session.root, judged);
    return { run: judged };
  });

  // "I have dealt with this." Board and card in the path, like the list above: a run id is unique,
  // but finding its record without them would mean walking every results folder.
  api.post('/runs/:board/:card/:run/resolve', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, card, run } = req.params as { board: string; card: string; run: string };
    if (!isBoard(board)) return reply.code(400).send({ error: 'Unknown board' });
    if (!isRunId(run)) return reply.code(400).send({ error: NOT_A_RUN_ID });
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
    if (!isRunId(run)) return reply.code(400).send({ error: NOT_A_RUN_ID });
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
