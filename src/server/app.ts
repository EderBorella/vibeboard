import Fastify, { type FastifyInstance } from 'fastify';
import { CopilotSession } from './copilot.js';
import { ChatStore } from './chat-store.js';
import { createBroadcaster, registerWs } from './ws.js';
import { createCopilotTurns } from './copilot-turns.js';
import { registerProjectRoutes } from './routes/project.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerModelRoutes } from './routes/models.js';
import { registerControlRoutes } from './routes/control.js';
import { registerCardRoutes } from './routes/cards.js';
import type { AppCtx } from './route-context.js';
import type { ProjectSession } from './session.js';

// Composition root: wire the session, copilot and chat store into one context, register the
// WS channel, then mount each route group under /api. Route bodies live in ./routes.
export function buildApp(session: ProjectSession): FastifyInstance {
  const app = Fastify();
  const copilot = new CopilotSession();
  const chats = new ChatStore(session);
  const { clients, broadcast } = createBroadcaster();
  const ctx: AppCtx = { session, copilot, chats, broadcast };
  const turns = createCopilotTurns(ctx);

  registerWs(app, ctx, clients, turns.handleMessage, turns.sendHistory);

  app.register(
    async (api) => {
      await registerProjectRoutes(api, ctx);
      await registerConfigRoutes(api, ctx);
      await registerModelRoutes(api, ctx);
      await registerControlRoutes(api, ctx);
      await registerCardRoutes(api, ctx);
    },
    { prefix: '/api' },
  );

  return app;
}
