import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { DEFAULT_MAX_RUNS } from '../core/config.js';
import { AgentRunner } from './agent-runner.js';
import { registerAuth } from './auth.js';
import { ChatStore } from './chat-store.js';
import { CopilotSession } from './copilot.js';
import { createCopilotTurns } from './copilot-turns.js';
import { CredentialStore } from './credentials.js';
import { type Log, serverLogger, stripSecrets, withRedaction } from './logging.js';
import { attachOpencodeLogger, attachSandbox } from './opencode-server.js';
import type { AppCtx } from './route-context.js';
import { registerAutopilotRoutes } from './routes/autopilot.js';
import { registerCardRoutes } from './routes/cards.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerControlRoutes } from './routes/control.js';
import { registerExplorerRoutes } from './routes/explorer.js';
import { registerModelRoutes } from './routes/models.js';
import { registerProjectRoutes } from './routes/project.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerSandboxRoutes } from './routes/sandbox.js';
import { registerSkillRoutes } from './routes/skills.js';
import { registerSuggestionRoutes } from './routes/suggestions.js';
import { NOT_REQUESTED, type SandboxStatus } from './sandbox.js';
import type { ProjectSession } from './session.js';
import { createBroadcaster, registerWs } from './ws.js';

declare module 'fastify' {
  interface FastifyInstance {
    // Set by registerStatic when a built UI exists, so the one not-found handler below can serve
    // the SPA without this module having to know whether there is a build.
    spaFallback: ((reply: import('fastify').FastifyReply) => unknown) | null;
    runner: AgentRunner;
  }
}

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
    // Probed once, by main.ts, before the app exists — every agent this app starts is confined the
    // same way, and re-probing per turn would put a process spawn in front of every dispatch.
    sandbox?: SandboxStatus;
  } = {},
): FastifyInstance {
  const app = Fastify({ logger: withRedaction(opts.logger ?? serverLogger().options) });
  const credentials = opts.credentials ?? new CredentialStore(randomUUID());
  // Each subsystem logs under its own `component`, so the file can be filtered by area:
  //   jq 'select(.component == "watcher")' logs/vibeboard-*.log
  const log: Log = app.log;
  const copilot = new CopilotSession({ sandbox: opts.sandbox });
  const chats = new ChatStore(session, log.child({ component: 'chat' }));
  // The watcher and the debounced snapshot broadcast happen with no request in flight, and the
  // session is constructed before the app — so the composition root hands it the logger.
  session.attachLogger(log.child({ component: 'watcher' }));
  // Same reason for the OpenCode backend: the spawned `opencode serve` and the turns that run
  // through it are module singletons, and both only speak with no request in flight.
  attachOpencodeLogger(log.child({ component: 'opencode' }));
  // Same singleton, same reason: the managed server is spawned lazily, long after this runs.
  attachSandbox(opts.sandbox ?? NOT_REQUESTED);
  const { clients, broadcast } = createBroadcaster();
  // A run does real work — implementing a card, not answering a question — so its patience is its
  // own, an order of magnitude beyond the chat's per-turn timeout.
  const runner = new AgentRunner({
    root: () => session.root ?? '',
    now: () => new Date(),
    suffix: () => Math.random().toString(36).slice(2, 6),
    // The project's own setting wins, so the number a person can see and change is the number a run
    // is actually held to (decision 8: it "must be surfaced in the auto-pilot settings tab rather
    // than remaining a buried env var"). The env var stays as the fallback for a project with no
    // lifecycle block, which is every project created before it existed.
    timeoutMs: () =>
      session.config?.autopilot?.runTimeoutMs ?? Number(process.env.VIBEBOARD_RUN_TIMEOUT_MS ?? 1_800_000),
    // Read per dispatch from the open project's config, so changing it in Settings takes effect
    // without a restart.
    maxConcurrent: () => session.config?.maxConcurrentRuns ?? DEFAULT_MAX_RUNS,
    credentials,
    // Read at dispatch rather than captured, so a port set after buildApp still lands. Taken from
    // the same variable main.ts listens on — the app is not told the port it was bound to.
    apiBase: () => `http://127.0.0.1:${process.env.VIBEBOARD_PORT ?? 4610}`,
    bin: opts.runBin,
    sandbox: opts.sandbox,
    onUpdate: (record) => broadcast({ type: 'run:update', record }),
    log: log.child({ component: 'runner' }),
  });
  const ctx: AppCtx = {
    session,
    copilot,
    chats,
    runner,
    credentials,
    broadcast,
    log,
    sandbox: opts.sandbox ?? NOT_REQUESTED,
  };
  const turns = createCopilotTurns(ctx);

  registerWs(app, ctx, clients, turns.handleMessage, turns.sendHistory);

  app.register(
    async (api) => {
      // First inside the scope, so it runs for every route below it and for nothing outside.
      registerAuth(api, credentials, () => session.root);
      await registerProjectRoutes(api, ctx);
      await registerConfigRoutes(api, ctx);
      await registerModelRoutes(api, ctx);
      await registerControlRoutes(api, ctx);
      await registerSandboxRoutes(api, ctx);
      await registerAutopilotRoutes(api, ctx);
      await registerSuggestionRoutes(api, ctx);
      await registerExplorerRoutes(api, ctx);
      await registerSkillRoutes(api, ctx);
      await registerRunRoutes(api, ctx);
      await registerCardRoutes(api, ctx);
    },
    { prefix: '/api' },
  );

  // Fastify's own 404 handler logs `Route GET:<url> not found` — the one line the request
  // serializer cannot reach, and the launch URL carries a credential. Registered here rather than
  // only in registerStatic, which runs solely when a UI build exists: `npm run dev` has no build,
  // and a redaction that holds in production but not in development is not a redaction.
  app.decorate('spaFallback', null);
  app.setNotFoundHandler((req, reply) => {
    req.log.info({ url: stripSecrets(req.url) }, 'route not found');
    const isApp = !req.url.startsWith('/api') && !req.url.startsWith('/ws');
    if (isApp && app.spaFallback) return app.spaFallback(reply);
    return reply.code(404).send({ error: 'Not found' });
  });

  // Exposed for main.ts's shutdown handlers: a spawned agent outlives the server unless something
  // stops it, and the composition root is the only place that holds the runner.
  app.decorate('runner', runner);

  return app;
}
