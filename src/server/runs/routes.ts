import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { attemptsUsed, sumSpend } from '../../core/accounting.js';
import { DEFAULT_AUTOPILOT } from '../../core/autopilot.js';
import { boardAroundFor } from '../../core/board-around.js';
import { findCard } from '../../core/find.js';
import { actingPhase, phase } from '../../core/phases.js';
import { asVerification, isInFlight, isRunId, type RunRecord, withVerification } from '../../core/runs.js';
import { BOARDS, isBoard } from '../../core/types.js';
import { readBoard } from '../../store/cards/board.js';
import { readSkills } from '../../store/project/skill-catalogue.js';
import {
  forgiveCardRuns,
  forgiveProjectRuns,
  listCardRuns,
  listProjectRuns,
  listRuns,
  readProjectRun,
  readRun,
  resetCardRuns,
  resolveProjectRun,
  resolveRun,
  writeRun,
} from '../../store/run-store.js';
import type { Credential, Scope } from '../auth/credentials.js';
import { errorText } from '../errors.js';
import { type AppCtx, ensureOpen, nowIso } from '../route-context.js';
import type { DispatchInput } from './agent-runner.js';
import {
  agentDispatchRefusal,
  type DispatchBody,
  dispatchFrame,
  resolveProjectDispatch,
} from './dispatch.js';
import { moveOnHandStart } from './hand-run.js';

// Dispatching and reading runs.
//
// The route layer resolves everything the runner should not have to know: which card, which skill,
// which cards it links to, and which backend/model/effort a bare request means. The runner takes
// facts and produces a record. The half of that resolution the wizard's door needs too — the frame
// and the card-less dispatch — is in dispatch.ts, because a route may not import a route.

// A run id reaches these routes as a URL segment and ends up inside a filesystem path, so the shape is
// checked before the store is touched. The store refuses it too — this is the half that gives the
// caller a 400 and a sentence instead of a 500.
const NOT_A_RUN_ID = 'That is not a run id.';

// The two booleans, coerced. A `service` caller is the loop, but a body is still JSON: `=== true` is the only
// reading that cannot turn a string, a number or a missing key into a pass.
// The checkup's evidence, shape-checked rather than trusted. A `service` caller is the loop, but a body is
// still JSON, and a prompt built over a `children` that is not an array is a 500 handed to the loop.
function isCheckupEvidence(given: unknown): given is NonNullable<DispatchInput['checkup']> {
  if (typeof given !== 'object' || given === null) return false;
  const o = given as Record<string, unknown>;
  return Array.isArray(o.children) && Array.isArray(o.blocked) && Array.isArray(o.suggestions);
}

// `feature` NARROWED TO EXACTLY `true`, the same way `reviewFacts` narrows its two booleans, rather than
// left to travel through on the spread. The body is JSON however trusted the caller is, and this one field
// decides whether a whole section of the prompt renders — a `"yes"` would be truthy and would put the
// feature checkup's question in front of a story checkup, where it is about the wrong thing entirely.
function checkupEvidenceOf(given: unknown): NonNullable<DispatchInput['checkup']> {
  const evidence = given as NonNullable<DispatchInput['checkup']>;
  const feature = (given as Record<string, unknown>).feature === true;
  return { ...evidence, ...(feature ? { feature: true as const } : { feature: undefined }) };
}

function reviewFacts(given: unknown): { gatesPassed: boolean; setupSubtree: boolean } {
  const o = (given ?? {}) as Record<string, unknown>;
  return { gatesPassed: o.gatesPassed === true, setupSubtree: o.setupSubtree === true };
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
function reviewFor(
  slug: string,
  given: unknown,
): { review?: { gatesPassed: boolean; setupSubtree: boolean } } {
  if (slug !== phase('story-review').skill) return {};
  return { review: reviewFacts(given) };
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

// A PERSON'S DISPATCH (decisions 93 and 95): marked as theirs, and its card moved into the working column
// first — then resolved again, so the prompt names the card's file where it now is.
async function resolveByHand(
  ctx: AppCtx,
  body: DispatchBody,
): Promise<{ input: DispatchInput } | { code: number; error: string }> {
  const first = await resolveDispatch(ctx, body);
  if ('error' in first) return first;
  const { card, skill } = first.input;
  const { root, config } = ctx.session;
  const moved = card && root && config ? await moveOnHandStart(root, config, card, skill) : false;
  const resolved = moved ? await resolveDispatch(ctx, body) : first;
  return 'error' in resolved ? resolved : { input: { ...resolved.input, dispatchedBy: 'person' } };
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
  const around = boardAroundFor(actingPhase(skill.slug, card.board)?.name, card, everyCard);

  return {
    input: {
      skill,
      card,
      ...reviewFor(skill.slug, body.review),
      // Passed straight through. The route computes nothing here: unlike the review contract, whose PRESENCE is
      // a property of the skill, every field is a fact only the loop holds — so there is no honest default for
      // a hand dispatch, and its absence is what the prompt renders nothing from.
      ...(isCheckupEvidence(body.checkup) ? { checkup: checkupEvidenceOf(body.checkup) } : {}),
      cardFile,
      linked,
      ...(around ? { around } : {}),
      ...(previous ? { previous: previous.run } : {}),
      userPrompt: body.prompt,
      ...(await dispatchFrame(root, config, body)),
    },
  };
}

// Everything that refuses a dispatch before anything is resolved or written, in the order it is asked. Its own
// function rather than four guards in the handler — flattening beats a suppression, and the handler is then
// dispatch-and-report while the refusals, each of which is a rule with a history, sit together. The three the
// wizard's door asks too live in dispatch.ts; what is left here is the two about the BODY, which only this
// route has one of.
async function dispatchRefusal(
  ctx: AppCtx,
  body: DispatchBody,
  scope: Scope | undefined,
): Promise<{ code: number; error: string } | undefined> {
  // THE THREE EVERY DOOR ASKS — the sandbox, the project's state, the gates nobody has read — from the
  // one home both doors read them from. See `agentDispatchRefusal` in dispatch.ts for each one's reason.
  const shared = await agentDispatchRefusal(ctx, scope);
  if (shared) return shared;
  // WHAT IS THIS ROUTE'S ALONE follows, and both of these are about the BODY rather than the machine.
  //
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
  // RULING 63, and it follows the refusal above exactly — including that it refuses the BROWSER too, which is
  // the only other caller the scope table lets reach this route at all.
  //
  // These are facts the loop COMPUTES and hands to a model: that the gates it ran in its own process passed,
  // and whether the card is in the setup subtree where an absent gate set is expected. A field on this request
  // is a field its caller can set, so a review able to send `gatesPassed: true` could talk its own reviewer
  // into a pass — decision 40 defeated through a side door.
  if ((body?.review !== undefined || body?.checkup !== undefined) && scope !== 'service') {
    return {
      code: 403,
      error:
        'Only auto-pilot may say what its own gates, its own board read and its own commands produced: it computes those facts, and a run that could supply them would be describing the work it is being judged on. Dispatch without them, and the run will be told plainly what is and is not known.',
    };
  }
  return undefined;
}

// WHO OVERRULED THE MACHINE, in the voice the three attempt-clearing lines are written in. A person at the
// browser, or the copilot under Fix board — and then which conversation, because the answer to "why did
// this card get four tries" is in that transcript (decision 88).
export function overruledBy(cred: Credential | undefined): {
  actor: string;
  facts: { by?: Scope; chat?: string };
} {
  if (cred?.scope === 'repair') {
    return { actor: 'the copilot, repairing the board,', facts: { by: 'repair', chat: cred.run } };
  }
  return { actor: 'a person', facts: { by: cred?.scope } };
}

// Why a card's spent attempts cannot be cleared right now, or nothing.
//
// A run still in flight settles into this card's history moments from now, and if it settles as an
// attempt the count the user has just watched go to zero climbs straight back — which reads as a
// button that did nothing, on the one control they reached for because nothing else was working. So
// it is refused with the reason rather than answered with a number that will not last.
//
// Named and exported for the same reason `dispatchLock` is: the sentence is the only part of this a
// person ever sees, and it can then be asserted without a run anywhere near the test.
export function forgiveRefusal(inFlight: number): string | undefined {
  if (inFlight === 0) return undefined;
  return inFlight === 1
    ? 'A run on this card has not finished, and it will land as an attempt of its own — so clearing them now would put the count straight back. Wait for it to end, or stop it from the report list first.'
    : `${inFlight} runs on this card have not finished, and each will land as an attempt of its own — so clearing them now would put the count straight back. Wait for them to end, or stop them from the report list first.`;
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
  // budget is enforced with, and one statement of it is the whole point (see autopilot/routes.ts).
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
    const resolved =
      req.credential?.scope === 'admin' ? await resolveByHand(ctx, body) : await resolveDispatch(ctx, body);
    if ('error' in resolved) return reply.code(resolved.code).send({ error: resolved.error });
    try {
      return { run: await ctx.runner.dispatch(resolved.input) };
    } catch (err) {
      // The cap, today. Phase 5 replaces it with a queue, at which point this stops being a refusal.
      return reply.code(409).send({ error: errorText(err) });
    }
  });

  // The VERDICT on a run, written by the loop that judged it. Decision 18: a verdict carries its evidence,
  // and it belongs to the record of the run it judged — so "why did this card advance?" is answerable from
  // disk months later.
  //
  // Service-scoped. Neither working scope may reach it, and that is the whole of decision 3: a run that
  // could write its own verification would be a run advancing itself on self-assessment, which is the one
  // thing this design exists to prevent. The verdict is validated on the way in by `asVerification`, so a
  // body that is not one — including one claiming a mode this machine no longer has — is refused here.
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

  // The same, for a run about the project: what the loop measured after a Mini review (decision 100), kept on the
  // record it judged so the next round is told it and the tick reads it off disk.
  api.post('/runs/project/:run/verification', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { run } = req.params as { run: string };
    if (!isRunId(run)) return reply.code(400).send({ error: NOT_A_RUN_ID });
    const verification = asVerification((req.body ?? {}) as Record<string, unknown>);
    if (!verification) {
      return reply
        .code(400)
        .send({ error: 'That is not a verification: it needs a mode, a passed and an at.' });
    }
    const record = await readProjectRun(ctx.session.root, run);
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

  // "This card is not the one that failed." Clears the attempts a card has spent, so auto-pilot will
  // dispatch it again — the way out of a card the machine itself blocked, which until now had none.
  //
  // REFUSED TO EVERY AUTONOMOUS SCOPE AND TO `assist` by the scope table in auth/auth.ts, which names
  // `repair` alone. The attempt cap is what stops a card being retried for ever, so an agent able to
  // forgive its own card's attempts would be an agent granting itself unlimited retries — decision 3's
  // subject reached through the counting side instead of through the verdict. `repair` has no card of its
  // own and cannot dispatch, so nothing it forgives is its own (decision 88).
  //
  // Board and card in the path like the two routes above: attempts are counted per card, and finding
  // a card's records without its board would mean walking every results folder.
  api.post('/runs/:board/:card/forgive', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, card } = req.params as { board: string; card: string };
    if (!isBoard(board)) return reply.code(400).send({ error: 'Unknown board' });
    const runs = await listCardRuns(ctx.session.root, board, card);
    // FROM THE RECORDS, not from `ctx.runner`: the reason to refuse is that a record is about to be
    // written with an ending, and the records are where that is true. A queued run counts as much as a
    // running one — it is a dispatch already decided, and it will land the same way a moment later.
    const refusal = forgiveRefusal(runs.filter((r) => isInFlight(r.status)).length);
    if (refusal) return reply.code(409).send({ error: refusal });
    const forgiven = await forgiveCardRuns(ctx.session.root, board, card, nowIso());
    // Somebody overruling the machine, so the log says who did what. This is the one write that makes
    // a card the caps had stopped dispatchable again, and months later "why did this card get four
    // tries" is a question only this line answers.
    const who = overruledBy(req.credential);
    req.log.info({ board, card, forgiven, ...who.facts }, `${who.actor} cleared a card's attempts`);
    return { forgiven };
  });

  // "NONE OF THIS CARD'S HISTORY SHOULD STILL BE COUNTING" (decision 86). The route above spares a run
  // that SUCCEEDED, for the reason written on `forgiveCardRuns`; this one does not, and that is the whole
  // difference between them. A card whose spent runs are all successes — a feature whose checkup ran,
  // created work, and closed cleanly three times — is at its cap with nothing the other route will touch,
  // and until this existed the product offered no way out of it at all.
  //
  // A SEPARATE ROUTE AND NOT A FLAG ON THE ONE ABOVE. The two are different decisions with different costs,
  // so they are different verbs with different names, and the cost of this one is stated in its
  // confirmation rather than hidden behind a checkbox on the milder action.
  //
  // REFUSED TO EVERY AGENT BUT `repair`, exactly as the forgive above is, and here the reason is stronger
  // rather than merely the same: an agent that could reset its own card's attempts would have unlimited
  // retries AND could clear the record of the creating run that bounds it, which is every counter this loop
  // keeps undone from inside a run. A repair is inside no run (decision 88).
  api.post('/runs/:board/:card/reset', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, card } = req.params as { board: string; card: string };
    if (!isBoard(board)) return reply.code(400).send({ error: 'Unknown board' });
    const runs = await listCardRuns(ctx.session.root, board, card);
    // The same refusal as the forgive, from the records rather than from the runner, and for the same
    // reason: a dispatch already decided lands as an attempt moments later and puts the count back.
    const refusal = forgiveRefusal(runs.filter((r) => isInFlight(r.status)).length);
    if (refusal) return reply.code(409).send({ error: refusal });
    const forgiven = await resetCardRuns(ctx.session.root, board, card, nowIso());
    // Its own message, not the forgive's. This is the write that can re-open a creating run, so "why did
    // this feature grow a second set of stories" is a question only this line answers.
    const who = overruledBy(req.credential);
    req.log.info({ board, card, forgiven, ...who.facts }, `${who.actor} reset a card`);
    return { forgiven };
  });

  // THE SAME ACTION FOR THE POSITION WITH NO CARD, and it needs its own route because the one above is
  // addressed by board and card.
  //
  // The bootstrap — an empty board derived from the README — runs without a card, so its cap is counted over
  // PROJECT runs of that skill and `forgiveCardRuns` cannot even find the records. Measured 2026-08-16: an
  // unreachable OpenCode server spent all three of the calculator's derivation attempts in five seconds, and
  // the only way back was deleting files out of `project-runs/` by hand.
  //
  // NOT `/runs/:board/:card/forgive` with a sentinel card, which was the cheaper shape and the wrong one: a
  // card id that means "no card" would have to be understood by `listCardRuns`, the results-folder layout and
  // every reader of a record, and one of them would eventually treat it as a real card.
  api.post('/runs/project/forgive', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const runs = await listProjectRuns(ctx.session.root);
    // Same refusal as the card route, from the records rather than from the runner, and for the same reason:
    // a dispatch already decided will land as an attempt a moment later and put the count straight back.
    const refusal = forgiveRefusal(runs.filter((r) => isInFlight(r.status)).length);
    if (refusal) return reply.code(409).send({ error: refusal });
    const forgiven = await forgiveProjectRuns(ctx.session.root, nowIso());
    // Somebody overruling the machine, so the log says who. This is the write that makes a project the caps
    // had stopped derivable again.
    const who = overruledBy(_req.credential);
    _req.log.info({ forgiven, ...who.facts }, `${who.actor} cleared the project's attempts`);
    return { forgiven };
  });

  api.post('/runs/:run/cancel', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { run } = req.params as { run: string };
    if (!ctx.runner.cancel(run)) return reply.code(404).send({ error: 'That run is not in flight' });
    return { ok: true, at: nowIso() };
  });
}
