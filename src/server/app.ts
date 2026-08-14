import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { forClient } from '../core/autopilot-state.js';
import { REAL_GIT } from '../exec/git-measure.js';
import { ChatStore } from '../store/chat-store.js';
import { DEFAULT_MAX_RUNS } from '../store/project/config.js';
import { listRuns } from '../store/run-store.js';
import { AgentRunner } from './agent-runner.js';
import { debugLogging } from './app-state.js';
import { registerAuth } from './auth.js';
import { AutopilotRuntime } from './autopilot-runtime.js';
import type { BoxService } from './box-service.js';
import { CopilotSession } from './copilot.js';
import { CopilotAuthority } from './copilot-authority.js';
import { createCopilotTurns } from './copilot-turns.js';
import { CredentialStore } from './credentials.js';
import { DeviceStore } from './devices.js';
import { type Log, serverLogger, stripSecrets, withRedaction } from './logging.js';
import {
  attachBoxes,
  attachHaltGate,
  attachOpencodeLogger,
  attachProjectRoot,
  attachSandbox,
  stopOpencodeServer,
} from './opencode-server.js';
import { groupsOf, reapGroups } from './reaper.js';
import type { AppCtx } from './route-context.js';
import { registerAutopilotRoutes } from './routes/autopilot.js';
import { registerCardRoutes } from './routes/cards.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerControlRoutes } from './routes/control.js';
import { registerCopilotRoutes } from './routes/copilot.js';
import { registerDiaryRoutes } from './routes/diary.js';
import { registerExplorerRoutes } from './routes/explorer.js';
import { registerModelRoutes } from './routes/models.js';
import { registerProjectRoutes } from './routes/project.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerSandboxRoutes } from './routes/sandbox.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerAuthRoutes, registerSigninRoutes } from './routes/signin.js';
import { registerSkillRoutes } from './routes/skills.js';
import { registerSuggestionRoutes } from './routes/suggestions.js';
import { registerToolchainRoutes } from './routes/toolchain.js';
import { NOT_REQUESTED, type SandboxStatus } from './sandbox.js';
import { type ServiceCommand, ServiceProcess } from './service-process.js';
import type { ProjectSession } from './session.js';
import { PendingRequests } from './signin.js';
import { createBroadcaster, registerWs } from './ws.js';

declare module 'fastify' {
  interface FastifyInstance {
    // Set by registerStatic when a built UI exists, so the one not-found handler below can serve
    // the SPA without this module having to know whether there is a build.
    spaFallback: ((reply: import('fastify').FastifyReply) => unknown) | null;
    runner: AgentRunner;
    // Auto-pilot's live state. Exposed for main.ts, which reopens the last project on boot and has to
    // reconcile a `running` state left behind by the process that died.
    autopilot: AutopilotRuntime;
    // The auto-pilot loop's process, so main.ts can take it down on the way out. A detached child
    // survives its parent, so nothing else would.
    service: ServiceProcess;
    // Hangs up on a revoked device's sockets, or on every socket for `null`. Exposed for main.ts's
    // SIGUSR2 break-glass: emptying the device store leaves the browsers holding sockets that are
    // still streaming, and an idle tab never makes the HTTP call that would 401.
    closeDevice: (device: string | null) => number;
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
    // The browsers that have signed in. main.ts passes the store it read off disk; an app built
    // without one gets an in-memory store, because `buildApp` is synchronous and `DeviceStore.load`
    // is not. A test that drives sign-in passes its own, the way it does for `credentials`.
    devices?: DeviceStore;
    // Probed once, by main.ts, before the app exists — every agent this app starts is confined the
    // same way, and re-probing per turn would put a process spawn in front of every dispatch.
    sandbox?: SandboxStatus;
    // Where agents actually run. Optional for the same reason `sandbox` is: a test about something
    // else neither has docker nor needs it, and without a sandbox no box is ever asked for.
    boxes?: BoxService;
    // What to spawn for the auto-pilot loop. Tests put a shim here and read back what the process was
    // actually given; production resolves the loop's entry point beside this module.
    serviceCommand?: () => ServiceCommand;
  } = {},
): FastifyInstance {
  const app = Fastify({
    logger: withRedaction(opts.logger ?? serverLogger().options),
    // Node's own default, rather than Fastify's 72 seconds. Fastify raises it to favour connection
    // reuse, which is the right trade for an API and buys almost nothing here: these requests finish
    // in single-digit milliseconds.
    //
    // IT WAS ADDED FOR THE WRONG REASON, and the claim is withdrawn rather than quietly left standing.
    // The comment here asserted that keep-alive held the browser's six-connection budget and queued the
    // WebSocket handshake — asserted without measuring, and disproved: during the wait ZERO bytes reach
    // this server, and Mozilla's own bugs 664305/748766 point the other way. The real cause was a stale
    // tab whose handshake could never succeed, holding Firefox's one-connection-per-host admission slot
    // through a fail-delay that grows to a 60-second ceiling. That is fixed by the cookie transport in
    // cookies.ts, not here. This value stays because it is a sane default, not because it fixed a bug.
    keepAliveTimeout: 5_000,
  });
  const credentials = opts.credentials ?? new CredentialStore(randomUUID());
  // Each subsystem logs under its own `component`, so the file can be filtered by area:
  //   jq 'select(.component == "watcher")' logs/vibeboard-*.log
  const log: Log = app.log;
  const copilot = new CopilotSession({ sandbox: opts.sandbox, boxes: opts.boxes });
  const copilotAuthority = new CopilotAuthority(credentials);
  const chats = new ChatStore(session, log.child({ component: 'chat' }));
  // The watcher and the debounced snapshot broadcast happen with no request in flight, and the
  // session is constructed before the app — so the composition root hands it the logger.
  session.attachLogger(log.child({ component: 'watcher' }));
  // Same reason for the OpenCode backend: the spawned `opencode serve` and the turns that run
  // through it are module singletons, and both only speak with no request in flight.
  attachOpencodeLogger(log.child({ component: 'opencode' }));
  // Same singleton, same reason: the managed server is spawned lazily, long after this runs.
  attachSandbox(opts.sandbox ?? NOT_REQUESTED);
  // The managed OpenCode server runs INSIDE a box, so the singleton needs one to start it in.
  attachBoxes(opts.boxes);
  // Which project's box. The singleton outlives any one project, so this is read per start.
  attachProjectRoot(() => session.root ?? '');
  const { clients, broadcast, closeDevice } = createBroadcaster();
  const devices = opts.devices ?? DeviceStore.inMemory();
  // A corrupt device file empties the store, and an empty store re-opens the unauthenticated claim.
  // That transition must never be quiet, so it is reported here at the level a person will see.
  if (devices.problem) log.error({ problem: devices.problem }, 'the device store could not be read');
  const signin = new PendingRequests({
    mint: async (label, address) => (await devices.add(label, address)).token,
    // Every signed-in browser is told immediately. The prompt has to appear on a screen someone is
    // looking at, and polling for it would put a request-a-second behind a feature used twice a year.
    onChange: () => broadcast({ type: 'signin:pending', pending: signin.list() }),
  });
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
    boxes: opts.boxes,
    // S11's files-changed. Real git here; tests that are about something else pass none and the field
    // is absent, which is what it means when there is no repository to ask.
    git: REAL_GIT,
    // The last word on whether a dispatch may start, checked after every await the route layer does.
    // Assigned below, because the runtime is built after the runner and this closes over it.
    halted: () => autopilot.isHalted(),
    onUpdate: (record) => broadcast({ type: 'run:update', record }),
    log: log.child({ component: 'runner' }),
  });
  // Everything an emergency stop takes down. Decision 13's blast radius: every agent this server
  // spawned, and the managed OpenCode server — which is a project-related child like any other, and
  // the thing that would otherwise respawn on the next chat message.
  const autopilot = new AutopilotRuntime({
    root: () => session.root,
    now: () => new Date(),
    onChange: (state) => broadcast({ type: 'autopilot:state', state: forClient(state) }),
    // Every stop takes the loop's authority away, so every stop revokes its credential. The service's
    // token belongs to no run record, so nothing else would ever expire it — and `dispatchLock` now
    // admits a `service` caller only while `running`, which makes this the second of two independent
    // reasons a stale token cannot dispatch.
    onDispatchingEnded: () => credentials.expireScope('service'),
    onKill: async (state) => {
      // In this order, and the order is the point: stop the runner first so nothing new is spawned into
      // the group we are about to reap, then the CHAT, then the managed server, then everything
      // recorded on disk.
      const stopped = runner.cancelAll();
      // The chat is an agent too, and it was the one this missed. It holds no run record, so it has no
      // pgid on disk and neither `cancelAll` nor the reaper can see it — its turn is spawned by
      // CopilotSession and reachable only through this call. Without it the confirm dialog's "every
      // agent working on this project is killed" was false for the default backend, and a chat turn's
      // grandchild outlived the halt. Its turn is spawned detached, so this reaches the whole group.
      copilot.cancel();
      stopOpencodeServer();
      const root = session.root;
      // Decision 13's full blast radius. `cancelAll` covers what THIS process holds handles for; the
      // records cover what a previous one left behind, and the service is a project-related child like
      // any other — Restart exists to bring it back.
      const targets = [
        ...(root ? groupsOf(await listRuns(root)) : []),
        ...(state.servicePgid === undefined
          ? []
          : [
              {
                pgid: state.servicePgid,
                ...(state.servicePgstart === undefined ? {} : { pgstart: state.servicePgstart }),
                what: 'the auto-pilot service',
              },
            ]),
      ];
      const { reaped, skipped } = reapGroups(targets, { log });
      log.warn(
        { stopped, reaped, skipped },
        'emergency stop: killed every run, the managed OpenCode server, and every process group still identifiable',
      );
    },
    log: log.child({ component: 'autopilot' }),
  });
  // The sync gate for the one caller that cannot await — see autopilot-runtime.ts.
  attachHaltGate(() => autopilot.isHalted());
  // The loop's process. It shares one file with the runtime above and owns the other half of it: the
  // runtime writes the state and the stops, this writes the pgid and supervises the child.
  const service = new ServiceProcess({
    root: () => session.root,
    now: () => new Date(),
    credentials,
    // The same expression the runner uses, for the same reason: read at start rather than captured, so a
    // port set after buildApp still lands.
    apiBase: () => `http://127.0.0.1:${process.env.VIBEBOARD_PORT ?? 4610}`,
    ...(opts.serviceCommand ? { command: opts.serviceCommand } : {}),
    // Read at every start, so flipping the switch in Settings takes effect on the next Start rather than at
    // the next restart of the whole app.
    debugLog: debugLogging,
    // A loop that died without saying why still has to raise the overlay in every open tab.
    onStopped: (state) => broadcast({ type: 'autopilot:state', state: forClient(state) }),
    onDispatchingEnded: () => credentials.expireScope('service'),
    log: log.child({ component: 'autopilot-service' }),
  });
  // Told on every change, including the ones no endpoint drives — switching chat or project revokes it,
  // and a button that still reads "Authorised" is a person believing they hold authority they do not.
  copilotAuthority.onChange((authorised) => broadcast({ type: 'copilot:authority', authorised }));
  const ctx: AppCtx = {
    session,
    copilot,
    copilotAuthority,
    chats,
    runner,
    autopilot,
    service,
    credentials,
    devices,
    signin,
    closeDevice,
    broadcast,
    log,
    sandbox: opts.sandbox ?? NOT_REQUESTED,
    boxes: opts.boxes,
  };
  const turns = createCopilotTurns(ctx);

  registerWs(app, ctx, clients, turns.handleMessage, turns.sendHistory);
  // THE SECOND AND LAST UNAUTHENTICATED SURFACE on this server, and it is here rather than under /api
  // deliberately: inside that prefix it would need an exception in registerAuth's hook, and that hook
  // having no exceptions is what makes "a route absent from the scope table is admin-only" mean
  // anything. The other unauthenticated surface is the static shell, which carries no secret.
  registerAuthRoutes(app, ctx);

  app.register(
    async (api) => {
      // First inside the scope, so it runs for every route below it and for nothing outside.
      registerAuth(api, credentials, () => session.root);
      registerSigninRoutes(api, ctx);
      await registerProjectRoutes(api, ctx);
      await registerConfigRoutes(api, ctx);
      await registerModelRoutes(api, ctx);
      await registerControlRoutes(api, ctx);
      await registerCopilotRoutes(api, ctx);
      await registerSandboxRoutes(api, ctx);
      await registerSettingsRoutes(api);
      await registerToolchainRoutes(api, ctx);
      await registerAutopilotRoutes(api, ctx);
      await registerSuggestionRoutes(api, ctx);
      await registerDiaryRoutes(api, ctx);
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
    // `/auth` joins the list: a typo'd sign-in URL answered with index.html has the client parsing
    // HTML as JSON, and the message it shows the user is then about JSON rather than about sign-in.
    const isApp = !req.url.startsWith('/api') && !req.url.startsWith('/ws') && !req.url.startsWith('/auth');
    if (isApp && app.spaFallback) return app.spaFallback(reply);
    return reply.code(404).send({ error: 'Not found' });
  });

  // Exposed for main.ts's shutdown handlers: a spawned agent outlives the server unless something
  // stops it, and the composition root is the only place that holds the runner.
  app.decorate('runner', runner);
  app.decorate('autopilot', autopilot);
  app.decorate('service', service);
  app.decorate('closeDevice', closeDevice);

  return app;
}
