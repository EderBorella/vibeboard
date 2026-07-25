import type { FastifyReply } from 'fastify';
import type { ProjectSession } from './session.js';
import type { CopilotSession } from './copilot.js';
import type { ChatStore } from './chat-store.js';

// The shared surface every route group and the WS layer needs. Passed explicitly rather
// than closed over, so each route module is a plain function of its context and can be
// read (and tested) without the rest of the app.
export interface WsClient { send: (data: string) => void }

export interface AppCtx {
  session: ProjectSession;
  copilot: CopilotSession;
  chats: ChatStore;
  broadcast: (msg: unknown) => void;
}

export const today = (): string => new Date().toISOString().slice(0, 10);

// Full precision, unlike `created` — the archive drawer orders by it, and a day-granular
// stamp would leave everything archived today in an arbitrary order.
export const nowIso = (): string => new Date().toISOString();

export function ensureOpen(session: ProjectSession, reply: FastifyReply): boolean {
  if (!session.isOpen) {
    reply.code(409).send({ error: 'No project open' });
    return false;
  }
  return true;
}
