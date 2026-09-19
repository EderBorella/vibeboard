import type { FastifyInstance } from 'fastify';
import { RESUMABLE_DOCUMENTS } from '../../core/layout.js';
import {
  clearWizardState,
  isScaffoldMode,
  knownSuggestions,
  readWizardState,
  WIZARD_STEPS,
  type WizardState,
  writeWizardState,
} from '../../store/project/wizard.js';
import type { Scope } from '../auth/credentials.js';
import { errorText } from '../errors.js';
import { type AppCtx, ensureOpen } from '../route-context.js';
import { agentDispatchRefusal, resolveProjectDispatch } from '../runs/dispatch.js';

const WIZARD_SKILLS = ['scan-project', 'suggest-stack'];

// Why setup cannot start this run right now, or nothing. Its own function for `dispatchRefusal`'s
// reason: the handler is then dispatch-and-report, while the rules — a machine that cannot confine an
// agent, a door that starts two named skills and nothing else, a setup that is not running — sit
// together and can be read as one thing.
//
// `root` rather than the session, because `ensureOpen` is a type predicate over the SESSION and its
// narrowing does not survive a function boundary.
async function wizardRunRefusal(
  ctx: AppCtx,
  root: string,
  skill: string | undefined,
  scope: Scope | undefined,
): Promise<{ code: number; error: string } | undefined> {
  // THE SAME GATE EVERY OTHER AGENT PASSES, and it is first because nothing may be resolved or written
  // in front of it. A narrower door is still a door, and this one shipped without the gate: with the
  // sandbox refusing, `wrapCommand` hands the caller back the bare command, so setup's first run
  // executed on the HOST with nothing confining it. The shared function rather than three guards of
  // its own — a door that has to remember them is a door that can forget, and this is the one that did.
  const refused = await agentDispatchRefusal(ctx, scope);
  if (refused) return refused;
  if (skill === undefined || !WIZARD_SKILLS.includes(skill)) {
    return { code: 400, error: `Setup only starts ${WIZARD_SKILLS.join(' or ')}.` };
  }
  if (!(await readWizardState(root))) return { code: 409, error: 'No setup is in progress.' };
  return undefined;
}

// The wizard's scratch state. The four routes below are ADMIN ONLY, by being absent from the scope
// table in auth.ts — that is the default and it is right here: this file steers what the person is
// asked and what the copilot is told, and an agent able to rewrite it could steer its own brief.
// decision 76. What an agent may reach is the two narrow routes at the foot of this file, each granted
// one block of the state rather than admitted to these. decision 77.
export async function registerWizardRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.get('/wizard', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    return { state: await readWizardState(ctx.session.root) };
  });

  // A whole-state replace, never a merge: the browser holds the answers and sends all of them, and a
  // merge would leave a field a person has just emptied impossible to clear.
  api.put('/wizard', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const state = req.body as WizardState;
    if (!state || !isScaffoldMode(state.mode)) {
      return reply.code(400).send({ error: 'Expected a wizard state with a mode.' });
    }
    // THE STEP IS WHAT A RESUMED SETUP COMES BACK TO, so a value nothing renders is a person opening
    // their project onto a blank screen with every answer still on disk. The set is named in the
    // refusal because the only caller hand-mirrors it, and a browser one release ahead of the server
    // should be told which side is behind rather than merely told no.
    if (!WIZARD_STEPS.includes(state.step)) {
      return reply.code(400).send({ error: `Expected step to be one of: ${WIZARD_STEPS.join(', ')}.` });
    }
    await writeWizardState(ctx.session.root, state);
    return { state };
  });

  api.delete('/wizard', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    await clearWizardState(ctx.session.root);
    return { ok: true };
  });

  // SETUP'S OWN DISPATCH DOOR, AND WHY IT IS NOT `POST /api/runs`. Both of these runs are about the
  // project and have no card to be dispatched from, and a card-less run is refused to every scope but
  // `service` in runs/routes.ts — the browser included, deliberately: it is the one run confined to
  // nothing, which is what decision 5's scope spiral is about. Loosening that guard for the wizard
  // would grant every admin caller every card-less run for ever, so the wizard gets a narrower door
  // than the one it was refused: exactly these two skills, only while a setup is in progress, and
  // nothing else about the dispatch is the caller's to choose. decision 77.
  api.post('/wizard/run', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { skill, prompt } = (req.body ?? {}) as { skill?: string; prompt?: string };
    const refused = await wizardRunRefusal(ctx, ctx.session.root, skill, req.credential?.scope);
    if (refused) return reply.code(refused.code).send({ error: refused.error });
    // `seedSkills` only writes into an ABSENT skills folder, so a project part-way through setup when
    // this version arrived will not have either of these — and the browser has to be able to tell
    // that from every other refusal, because the answer to it is to skip the run and ask the person.
    // The runner's own 404 rather than a second wording of it.
    const resolved = await resolveProjectDispatch(ctx.session.root, ctx.session.config, {
      project: true,
      skill,
      ...(prompt === undefined ? {} : { prompt }),
    });
    if ('error' in resolved) return reply.code(resolved.code).send({ error: resolved.error });
    try {
      return { run: await ctx.runner.dispatch(resolved.input) };
    } catch (err) {
      // The concurrency cap, exactly as `POST /api/runs` answers it: a refusal with a sentence, not a
      // 500 with a stack trace on the one screen a beginner is standing in front of.
      return reply.code(409).send({ error: errorText(err) });
    }
  });

  // The one agent-facing wizard write: a scan or stack run posting what it found. Narrow on purpose —
  // it can only fill `suggested`, which the form reads into EMPTY fields, so the worst a poisoned
  // repo can do is suggest, visibly, on a screen built for second-guessing it. decision 77.
  //
  // A MERGE, unlike the replace above, because the two runs post at different moments and each knows
  // half of it — and neither is the browser holding the whole state.
  api.put('/wizard/prefill', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const current = await readWizardState(ctx.session.root);
    // A run can outlive the setup that dispatched it — the person may abandon the wizard while the
    // scan is still reading — and there is nothing to merge into once the file is gone.
    if (!current) return reply.code(409).send({ error: 'No setup is in progress.' });
    const suggested = { ...current.suggested, ...knownSuggestions(req.body) };
    await writeWizardState(ctx.session.root, { ...current, suggested });
    return { ok: true };
  });

  // The copilot's door, and the other half of what `suggested` is to a run: it writes the documents,
  // so it files the plain-language summary the person reads before opening any of them. The set is
  // `core/layout.ts`'s rather than listed here, because a name this door accepts that no document
  // answers to is a summary of nothing sitting in the list for the rest of setup — and the attachment
  // seam refuses against the same constant, so neither door can drift from the other. decision 77.
  api.put('/wizard/resumes/:name', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { name } = req.params as { name: string };
    if (!RESUMABLE_DOCUMENTS.has(name)) {
      return reply.code(400).send({
        error: `Not a document with a résumé. One of: ${[...RESUMABLE_DOCUMENTS].join(', ')}.`,
      });
    }
    const { summary } = (req.body ?? {}) as { summary?: string };
    if (typeof summary !== 'string' || summary.trim() === '') {
      return reply.code(400).send({ error: 'Expected `summary`.' });
    }
    // A RÉSUMÉ PAST THIS IS THE WALL OF TEXT IT REPLACES. Refused rather than truncated: the person
    // reads these first, and half a summary reads as a finished one.
    if (summary.length > 600) {
      return reply
        .code(400)
        .send({ error: 'That summary is a wall of text — make it shorter than 600 characters.' });
    }
    const current = await readWizardState(ctx.session.root);
    if (!current) return reply.code(409).send({ error: 'No setup is in progress.' });
    await writeWizardState(ctx.session.root, {
      ...current,
      resumes: { ...current.resumes, [name]: summary.trim() },
    });
    return { ok: true };
  });
}
