import type { FastifyReply } from 'fastify';
import type { ProjectConfig } from '../core/types.js';
import type { AgentRunner } from './agent-runner.js';
import type { AutopilotRuntime } from './autopilot-runtime.js';
import type { ChatStore } from './chat-store.js';
import type { CopilotSession } from './copilot.js';
import type { CredentialStore } from './credentials.js';
import type { Log } from './logging.js';
import type { SandboxStatus } from './sandbox.js';
import type { ProjectSession } from './session.js';

// The shared surface every route group and the WS layer needs. Passed explicitly rather
// than closed over, so each route module is a plain function of its context and can be
// read (and tested) without the rest of the app.
export interface WsClient {
  send: (data: string) => void;
}

export interface AppCtx {
  session: ProjectSession;
  copilot: CopilotSession;
  chats: ChatStore;
  // Skill runs. Separate from `copilot` deliberately: the chat is one conversation at a time, a run
  // is one prompt in and one report out, and neither should be able to block the other.
  runner: AgentRunner;
  // Auto-pilot's state and the three stops. Everything that refuses an action while a project is
  // halted or under auto-pilot asks this rather than reading the file itself.
  autopilot: AutopilotRuntime;
  // Who is allowed to call what. Held on the context because both the HTTP boundary and the
  // websocket need to verify against the same store, and a run's credential is minted here when
  // it is dispatched and revoked when it settles.
  credentials: CredentialStore;
  // Whether agents are confined, and to what. Probed once by main.ts: it cannot change while the
  // process runs, so a function would only invite callers to wonder whether it might.
  sandbox: SandboxStatus;
  broadcast: (msg: unknown) => void;
  // Route handlers already have `request.log`. This is for everything that happens with no request to
  // hang off: the watcher, the WS channel, a run settling long after its dispatch was answered.
  log: Log;
}

export const today = (): string => new Date().toISOString().slice(0, 10);

// Full precision, unlike `created` — the archive drawer orders by it, and a day-granular
// stamp would leave everything archived today in an arbitrary order.
export const nowIso = (): string => new Date().toISOString();

// A type predicate, not a boolean: past this guard `root` and `config` are known to be set, so
// handlers read them directly instead of asserting non-null at every use.
export function ensureOpen(
  session: ProjectSession,
  reply: FastifyReply,
): session is ProjectSession & { root: string; config: ProjectConfig } {
  if (!session.root || !session.config) {
    reply.code(409).send({ error: 'No project open' });
    return false;
  }
  return true;
}
