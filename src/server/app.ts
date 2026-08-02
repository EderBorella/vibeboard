import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { DEFAULT_MAX_RUNS } from '../core/config.js';
import { AgentRunner } from './agent-runner.js';
import { registerAuth } from './auth.js';
import { ChatStore } from './chat-store.js';
import { CopilotSession } from './copilot.js';
import { createCopilotTurns } from './copilot-turns.js';
import { CredentialStore } from './credentials.js';
import { type Log, serverLogger } from './logging.js';
import { attachOpencodeLogger } from './opencode-server.js';
import type { AppCtx } from './route-context.js';
import { registerCardRoutes } from './routes/cards.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerControlRoutes } from './routes/control.js';
import { registerExplorerRoutes } from './routes/explorer.js';
import { registerModelRoutes } from './routes/models.js';
import { registerProjectRoutes } from './routes/project.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerSkillRoutes } from './routes/skills.js';
import type { ProjectSession } from './session.js';
import { createBroadcaster, registerWs } from './ws.js';

// Composition root: wire the session, copilot and chat store into one context, register the
// WS channel, then mount each route group under /api. Route bodies live in ./routes.
export function buildApp(
  session: ProjectSession,
  // `logger` overrides what the environment asks for. main.ts passes one so the log file is opened
  // exactly once and it can name the file in the startup banner; test/logging.test.ts passes a
  // stream to read the lines back, which is the only way to prove the logger is really wired.
  // `credentials` defaults to a store whose admin token nobody knows, so an app built without one
  // is locked rather than open. main.ts passes the persisted token; tests pass their own store so
  // they can mint run credentials against the same one the app verifies with.
  opts: {
    runBin?: string;
    logger?: FastifyServerOptions['logger'];
    credentials?: CredentialStore;
  } = {},
): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? serverLogger().options });
  const credentials = opts.credentials ?? new CredentialStore(randomUUID());
  // Each subsystem logs under its own `component`, so the file can be filtered by area:
  //   jq 'select(.component == "watcher")' logs/vibeboard-*.log
  const log: Log = app.log;
  const copilot = new CopilotSession();
  const chats = new ChatStore(session, log.child({ component: 'chat' }));
  // The watcher and the debounced snapshot broadcast happen with no request in flight, and the
  // session is constructed before the app — so the composition root hands it the logger.
  session.attachLogger(log.child({ component: 'watcher' }));
  // Same reason for the OpenCode backend: the spawned `opencode serve` and the turns that run
  // through it are module singletons, and both only speak with no request in flight.
  attachOpencodeLogger(log.child({ component: 'opencode' }));
  const { clients, broadcast } = createBroadcaster();
  // A run does real work — implementing a card, not answering a question — so its patience is its
  // own, an order of magnitude beyond the chat's per-turn timeout.
  const runner = new AgentRunner({
    root: () => session.root ?? '',
    now: () => new Date(),
    suffix: () => Math.random().toString(36).slice(2, 6),
    timeoutMs: Number(process.env.VIBEBOARD_RUN_TIMEOUT_MS ?? 1_800_000),
    // Read per dispatch from the open project's config, so changing it in Settings takes effect
    // without a restart.
    maxConcurrent: () => session.config?.maxConcurrentRuns ?? DEFAULT_MAX_RUNS,
    bin: opts.runBin,
    onUpdate: (record) => broadcast({ type: 'run:update', record }),
    log: log.child({ component: 'runner' }),
  });
  const ctx: AppCtx = { session, copilot, chats, runner, credentials, broadcast, log };
  const turns = createCopilotTurns(ctx);

  registerWs(app, ctx, clients, turns.handleMessage, turns.sendHistory);

  app.register(
    async (api) => {
      // First inside the scope, so it runs for every route below it and for nothing outside.
      registerAuth(api, credentials);
      await registerProjectRoutes(api, ctx);
      await registerConfigRoutes(api, ctx);
      await registerModelRoutes(api, ctx);
      await registerControlRoutes(api, ctx);
      await registerExplorerRoutes(api, ctx);
      await registerSkillRoutes(api, ctx);
      await registerRunRoutes(api, ctx);
      await registerCardRoutes(api, ctx);
    },
    { prefix: '/api' },
  );

  return app;
}
