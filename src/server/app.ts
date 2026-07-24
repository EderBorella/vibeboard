import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import websocket from '@fastify/websocket';
import { dirname } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { scaffoldProject, type ScaffoldMode } from '../core/scaffold.js';
import { createCard, updateCard, moveCard, archiveCard, type CreateCardInput } from '../core/mutations.js';
import { findCard } from '../core/find.js';
import { setCardLinks } from '../core/links.js';
import { writeConfig } from '../core/config.js';
import { discoverProjects } from './discover.js';
import { CopilotSession, type Backend, type CopilotMode, type EffortLevel } from './copilot.js';
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
  const clients = new Set<WsClient>();

  const broadcast = (msg: unknown): void => {
    const data = JSON.stringify(msg);
    for (const c of clients) { try { c.send(data); } catch { /* closed */ } }
  };
  const copilotState = (): void => broadcast({ type: 'copilot:state', state: copilot.state });

  interface CopilotOpts { mode: CopilotMode; model?: string; effort?: EffortLevel }

  async function handleCopilotSend(text: string, opts: CopilotOpts): Promise<void> {
    if (!session.isOpen) { broadcast({ type: 'copilot:error', error: 'No project open' }); return; }
    if (!text.trim()) return;
    try {
      copilotState(); // running flips true only once send starts; announce optimistically
      const cfg = session.config?.copilot;
      await copilot.send({
        cwd: session.root!,
        text,
        mode: opts.mode,
        backend: ((cfg?.backend as Backend) ?? 'claude-code'),
        model: opts.model ?? cfg?.model,
        effort: (opts.effort ?? cfg?.effort) as EffortLevel | undefined,
        onEvent: (event) => broadcast({ type: 'copilot:event', event }),
      });
    } catch (err) {
      broadcast({ type: 'copilot:error', error: err instanceof Error ? err.message : String(err) });
    } finally {
      copilotState();
    }
  }

  function handleCopilotMessage(raw: string): void {
    let msg: { type?: string; text?: string; mode?: CopilotMode; model?: string; effort?: EffortLevel };
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
        copilot.newSession();
        copilotState();
        break;
      case 'copilot:cancel':
        copilot.cancel();
        copilotState();
        break;
    }
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
      return session.config;
    });

    // Available models for a backend. claude → friendly aliases; opencode → `opencode models`.
    api.get('/models', async (req) => {
      const { backend } = req.query as { backend?: string };
      if (backend === 'opencode') {
        const bin = process.env.VIBEBOARD_OPENCODE_BIN ?? 'opencode';
        const out = await new Promise<string>((resolve) => {
          execFile(bin, ['models'], { maxBuffer: 1 << 20 }, (err, stdout) => resolve(err ? '' : stdout));
        });
        return out.split('\n').map((l) => l.trim()).filter(Boolean);
      }
      return ['opus', 'sonnet', 'haiku', 'fable'];
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
