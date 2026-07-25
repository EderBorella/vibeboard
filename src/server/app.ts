import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import websocket from '@fastify/websocket';
import { dirname } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { scaffoldProject, type ScaffoldMode } from '../core/scaffold.js';
import { listBackendModels, modelStatus } from './models.js';
import { createCard, updateCard, moveCard, archiveCard, type CreateCardInput } from '../core/mutations.js';
import { findCard } from '../core/find.js';
import { setCardLinks } from '../core/links.js';
import { writeConfig } from '../core/config.js';
import { discoverProjects } from './discover.js';
import { CopilotSession, type Backend, type CopilotMode, type EffortLevel } from './copilot.js';
import { ChatStore } from './chat-store.js';
import {
  listControlFiles,
  readControlFile,
  writeControlFile,
  deleteControlFile,
  createControlFile,
  renameControlFile,
  readResources,
  writeResources,
} from './control-files.js';
import type { ProjectSession } from './session.js';
import type { BoardName, CardFrontmatter, ProjectConfig } from '../core/types.js';

const today = (): string => new Date().toISOString().slice(0, 10);

interface WsClient { send: (data: string) => void }

function ensureOpen(session: ProjectSession, reply: FastifyReply): boolean {
  if (!session.isOpen) {
    reply.code(409).send({ error: 'No project open' });
    return false;
  }
  return true;
}

export function buildApp(session: ProjectSession): FastifyInstance {
  const app = Fastify();
  const copilot = new CopilotSession();
  const chats = new ChatStore(session);
  const clients = new Set<WsClient>();

  const broadcast = (msg: unknown): void => {
    const data = JSON.stringify(msg);
    for (const c of clients) { try { c.send(data); } catch { /* closed */ } }
  };
  const copilotState = (): void => broadcast({ type: 'copilot:state', state: copilot.state });
  // Full replay (connect + explicit chat change): replaces the client's transcript.
  const sendHistory = async (target?: WsClient): Promise<void> => {
    const payload = { type: 'copilot:history', ...(await chats.historyPayload()) };
    if (target) { try { target.send(JSON.stringify(payload)); } catch { /* closed */ } }
    else broadcast(payload);
  };
  // Switcher-only update (after a turn): refreshes the chat list without touching items.
  const broadcastChatList = async (): Promise<void> => {
    broadcast({ type: 'copilot:chats', ...(await chats.chatList()) });
  };

  interface CopilotOpts { mode: CopilotMode; model?: string; effort?: EffortLevel }

  async function handleCopilotSend(text: string, opts: CopilotOpts): Promise<void> {
    if (!session.isOpen) { broadcast({ type: 'copilot:error', error: 'No project open' }); return; }
    if (!text.trim()) return;
    try {
      await chats.recordUser(text);
      copilotState(); // running flips true only once send starts; announce optimistically
      const cfg = session.config?.copilot;
      await copilot.send({
        cwd: session.root!,
        text,
        mode: opts.mode,
        backend: ((cfg?.backend as Backend) ?? 'claude-code'),
        model: opts.model ?? cfg?.model,
        effort: (opts.effort ?? cfg?.effort) as EffortLevel | undefined,
        onEvent: (event) => { void chats.recordEvent(event); broadcast({ type: 'copilot:event', event }); },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      chats.recordError(message);
      broadcast({ type: 'copilot:error', error: message });
    } finally {
      await chats.flush();
      await broadcastChatList();
      copilotState();
    }
  }

  function handleCopilotMessage(raw: string): void {
    let msg: { type?: string; text?: string; chatId?: string; mode?: CopilotMode; model?: string; effort?: EffortLevel };
    try { msg = JSON.parse(raw); } catch { return; }
    const opts = (): CopilotOpts => ({ mode: msg.mode ?? 'bypassPermissions', model: msg.model, effort: msg.effort });
    switch (msg.type) {
      case 'copilot:send':
        void handleCopilotSend(msg.text ?? '', opts());
        break;
      case 'copilot:compact':
        void handleCopilotSend('/compact', opts());
        break;
      case 'copilot:new':
        void (async () => {
          copilot.newSession();
          await chats.newChat();
          await sendHistory();
          copilotState();
        })();
        break;
      case 'copilot:open':
        if (msg.chatId) void handleCopilotOpen(msg.chatId);
        break;
      case 'copilot:delete':
        if (msg.chatId) void handleCopilotDelete(msg.chatId);
        break;
      case 'copilot:cancel':
        copilot.cancel();
        copilotState();
        break;
    }
  }

  // Reopen a stored chat: restore its transcript and, when the backend matches, resume the
  // underlying CLI session so the next message continues it (a mismatch continues fresh — the
  // ChatStore attaches a one-shot note to the history payload).
  async function handleCopilotOpen(chatId: string): Promise<void> {
    const info = await chats.open(chatId);
    if (!info) return;
    const backend = session.config?.copilot.backend ?? 'claude-code';
    if (info.backend === backend) copilot.resume(info.cliSessionId, info.model);
    else copilot.newSession();
    await sendHistory();
    copilotState();
  }

  async function handleCopilotDelete(chatId: string): Promise<void> {
    const { wasCurrent } = await chats.delete(chatId);
    if (wasCurrent) copilot.newSession();
    await sendHistory();
    copilotState();
  }

  app.register(websocket);

  app.register(async (root) => {
    root.get('/ws', { websocket: true }, (socket) => {
      clients.add(socket);
      const send = (snapshot: unknown): void => {
        try {
          socket.send(JSON.stringify({ type: 'snapshot', snapshot }));
        } catch {
          /* socket closed mid-send */
        }
      };
      if (session.isOpen) void session.snapshot().then(send).catch(() => {});
      socket.send(JSON.stringify({ type: 'copilot:state', state: copilot.state }));
      if (session.isOpen) void sendHistory(socket).catch(() => {});
      const unsubscribe = session.subscribe(send);
      socket.on('message', (raw: Buffer) => handleCopilotMessage(raw.toString('utf8')));
      socket.on('close', () => { unsubscribe(); clients.delete(socket); });
    });
  });

  app.register(async (api) => {
    api.get('/state', async () =>
      session.isOpen ? { open: true, snapshot: await session.snapshot() } : { open: false });

    api.get('/projects', async (req) => {
      const { root } = req.query as { root?: string };
      const base = root ?? process.env.VIBEBOARD_ROOT ?? dirname(process.cwd());
      return discoverProjects(base);
    });

    api.get('/config', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      return session.config;
    });

    api.patch('/config', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      const patch = req.body as Partial<ProjectConfig>;
      const merged: ProjectConfig = { ...session.config!, ...patch, copilot: { ...session.config!.copilot, ...(patch.copilot ?? {}) } };
      await writeConfig(session.root!, merged);
      await session.reloadConfig();
      // Push the updated snapshot so all clients reflect the new config immediately (the
      // watcher would also fire, but this is instant and race-free for the backend toggle).
      broadcast({ type: 'snapshot', snapshot: await session.snapshot() });
      return session.config;
    });

    // Available models for a backend as {id, free}. claude → aliases; opencode → its own
    // models + OpenRouter's free tier, free ones flagged and listed first.
    api.get('/models', async (req) => {
      const { backend } = req.query as { backend?: string };
      return listBackendModels(backend ?? 'claude-code');
    });

    // Live status/uptime for one model (OpenRouter endpoints route); null if no source.
    api.get('/model-status', async (req) => {
      const { id } = req.query as { id?: string };
      return { status: id ? await modelStatus(id) : null };
    });

    // Project Control: the file controller for documents that steer the models. Every path is
    // sandboxed to the project root + an allow-list inside control-files.ts.
    api.get('/control/files', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      return { groups: await listControlFiles(session.root!) };
    });

    api.get('/control/file', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      const { path } = req.query as { path?: string };
      const file = await readControlFile(session.root!, path);
      if (!file) return reply.code(400).send({ error: 'Path not allowed' });
      return file;
    });

    api.put('/control/file', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      const { path, content } = req.body as { path?: string; content?: string };
      const ok = await writeControlFile(session.root!, path, content ?? '');
      if (!ok) return reply.code(400).send({ error: 'Path not allowed' });
      return { ok: true };
    });

    // Create with a default, collision-free name ("New doc", "New doc 2", …). The UI renames it
    // in place afterwards, so there is no browser dialog in the flow.
    api.post('/control/create', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      const { category } = req.body as { category?: string };
      const file = await createControlFile(session.root!, category);
      if (!file) return reply.code(400).send({ error: 'Cannot create in that category' });
      return file;
    });

    api.post('/control/rename', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      const { path, name } = req.body as { path?: string; name?: string };
      const result = await renameControlFile(session.root!, path, name);
      if (result === 'taken') return reply.code(409).send({ error: 'That name is already used' });
      if (!result) return reply.code(400).send({ error: 'Cannot rename that file' });
      return result;
    });

    api.delete('/control/file', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      const { path } = req.query as { path?: string };
      const result = await deleteControlFile(session.root!, path);
      if (result === 'invalid') return reply.code(400).send({ error: 'Path not allowed' });
      if (result === 'not-allowed') return reply.code(400).send({ error: 'This file cannot be deleted' });
      return { ok: true };
    });

    api.get('/control/resources', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      return { links: await readResources(session.root!) };
    });

    api.put('/control/resources', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      const { links } = req.body as { links?: unknown[] };
      await writeResources(session.root!, links ?? []);
      return { ok: true };
    });

    api.post('/project/open', async (req, reply) => {
      const { path } = req.body as { path: string };
      try {
        return { snapshot: await session.open(path) };
      } catch {
        return reply.code(400).send({ error: 'Not a VibeBoard project' });
      }
    });

    api.post('/project/scaffold', async (req) => {
      const { path, name, mode } = req.body as { path: string; name: string; mode: ScaffoldMode };
      await scaffoldProject(path, { name, mode, today: today() });
      return { snapshot: await session.open(path) };
    });

    api.post('/cards', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      const input = req.body as CreateCardInput;
      return createCard(session.root!, session.config!, input, today());
    });

    api.patch('/cards/:board/:id', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      const { board, id } = req.params as { board: BoardName; id: string };
      const card = await findCard(session.root!, board, id, session.config!);
      if (!card) return reply.code(404).send({ error: 'Card not found' });
      return updateCard(session.root!, card, req.body as Partial<CardFrontmatter> & { body?: string });
    });

    api.get('/cards/:board/:id/raw', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      const { board, id } = req.params as { board: BoardName; id: string };
      const card = await findCard(session.root!, board, id, session.config!);
      if (!card) return reply.code(404).send({ error: 'Card not found' });
      return { raw: await readFile(card.filePath, 'utf8') };
    });

    api.put('/cards/:board/:id/raw', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      const { board, id } = req.params as { board: BoardName; id: string };
      const { raw } = req.body as { raw: string };
      const card = await findCard(session.root!, board, id, session.config!);
      if (!card) return reply.code(404).send({ error: 'Card not found' });
      await writeFile(card.filePath, raw, 'utf8');
      return { ok: true };
    });

    api.put('/cards/:board/:id/links', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      const { board, id } = req.params as { board: BoardName; id: string };
      const { links } = req.body as { links: string[] };
      const card = await findCard(session.root!, board, id, session.config!);
      if (!card) return reply.code(404).send({ error: 'Card not found' });
      return setCardLinks(session.root!, session.config!, card, links);
    });

    api.post('/cards/:board/:id/move', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      const { board, id } = req.params as { board: BoardName; id: string };
      const { toColumnSlug } = req.body as { toColumnSlug: string };
      const card = await findCard(session.root!, board, id, session.config!);
      if (!card) return reply.code(404).send({ error: 'Card not found' });
      return moveCard(session.root!, card, toColumnSlug);
    });

    api.post('/cards/:board/:id/archive', async (req, reply) => {
      if (!ensureOpen(session, reply)) return;
      const { board, id } = req.params as { board: BoardName; id: string };
      const card = await findCard(session.root!, board, id, session.config!);
      if (!card) return reply.code(404).send({ error: 'Card not found' });
      return archiveCard(session.root!, card);
    });
  }, { prefix: '/api' });

  return app;
}
