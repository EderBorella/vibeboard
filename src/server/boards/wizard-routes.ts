import type { FastifyInstance } from 'fastify';
import { FOUNDATION_FILES } from '../../core/layout.js';
import {
  clearWizardState,
  isScaffoldMode,
  knownSuggestions,
  readWizardState,
  WIZARD_STEPS,
  type WizardState,
  writeWizardState,
} from '../../store/project/wizard.js';
import { type AppCtx, ensureOpen } from '../route-context.js';

// The wizard's scratch state. The three routes below are ADMIN ONLY, by being absent from the scope
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
  // so it files the plain-language summary the person reads before opening any of them. Built from
  // FOUNDATION_FILES rather than listed, because a name here that no document answers to is a summary
  // of nothing sitting in the list for the rest of setup. decision 77.
  const RESUMABLE = new Set([...FOUNDATION_FILES.map((f) => f.name), 'README.md']);
  api.put('/wizard/resumes/:name', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { name } = req.params as { name: string };
    if (!RESUMABLE.has(name)) {
      return reply
        .code(400)
        .send({ error: `Not a document with a résumé. One of: ${[...RESUMABLE].join(', ')}.` });
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
