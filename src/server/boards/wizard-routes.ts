import type { FastifyInstance } from 'fastify';
import {
  clearWizardState,
  isScaffoldMode,
  readWizardState,
  WIZARD_STEPS,
  type WizardState,
  writeWizardState,
} from '../../store/project/wizard.js';
import { type AppCtx, ensureOpen } from '../route-context.js';

// The wizard's scratch state. ADMIN ONLY, by being absent from the scope table in auth.ts — that is
// the default and it is right here: this file steers what the person is asked and what the copilot is
// told, and an agent able to rewrite it could steer its own brief. The one agent-facing exception
// arrives in a later phase as its own narrow route, never as a loosening of these. decision 76.
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
}
