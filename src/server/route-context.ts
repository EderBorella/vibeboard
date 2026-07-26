import type { FastifyReply } from 'fastify';
import type { ProjectConfig } from '../core/types.js';
import type { AgentRunner } from './agent-runner.js';
import type { ChatStore } from './chat-store.js';
import type { CopilotSession } from './copilot.js';
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
  broadcast: (msg: unknown) => void;
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
