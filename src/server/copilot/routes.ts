import type { FastifyInstance } from 'fastify';
import { type AppCtx, ensureOpen } from '../route-context.js';

// Authorising the chat copilot to use the API.
//
// ADMIN ONLY, by absence from auth.ts's scope table — which is the point of that default. An agent
// able to call this would be an agent granting itself authority, and the `assist` scope this hands
// out includes the one control-plane write in the whole system.
export async function registerCopilotRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.post('/copilot/authority', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { enabled } = req.body as { enabled?: unknown };
    if (typeof enabled !== 'boolean') return reply.code(400).send({ error: 'Expected `enabled`.' });

    if (!enabled) {
      ctx.copilotAuthority.revoke();
      ctx.log.warn({}, 'the copilot’s API authority was withdrawn');
    } else {
      // Keyed to the conversation that is open NOW. `currentId` creates one if none exists, so the
      // credential always belongs to a chat that really is on screen.
      ctx.copilotAuthority.authorise(await ctx.chats.currentId(), ctx.session.root);
      ctx.log.warn({}, 'the copilot was authorised to use the API for this conversation');
    }
    // Every tab is told, so a second one does not show a stale button for authority it shares.
    ctx.broadcast({ type: 'copilot:authority', authorised: ctx.copilotAuthority.enabled });
    return { authorised: ctx.copilotAuthority.enabled };
  });

  api.get('/copilot/authority', async () => ({ authorised: ctx.copilotAuthority.enabled }));
}
