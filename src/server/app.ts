import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import websocket from '@fastify/websocket';
import { dirname } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { scaffoldProject, type ScaffoldMode } from '../core/scaffold.js';
import { createCard, updateCard, moveCard, archiveCard, type CreateCardInput } from '../core/mutations.js';
import { findCard } from '../core/find.js';
import { setCardLinks } from '../core/links.js';
import { discoverProjects } from './discover.js';
import type { ProjectSession } from './session.js';
import type { BoardName, CardFrontmatter } from '../core/types.js';

const today = (): string => new Date().toISOString().slice(0, 10);

function ensureOpen(session: ProjectSession, reply: FastifyReply): boolean {
  if (!session.isOpen) {
    reply.code(409).send({ error: 'No project open' });
    return false;
  }
  return true;
}

export function buildApp(session: ProjectSession): FastifyInstance {
  const app = Fastify();

  app.register(websocket);

  app.register(async (root) => {
    root.get('/ws', { websocket: true }, (socket) => {
      const send = (snapshot: unknown): void => {
        try {
          socket.send(JSON.stringify({ type: 'snapshot', snapshot }));
        } catch {
          /* socket closed mid-send */
        }
      };
      if (session.isOpen) void session.snapshot().then(send).catch(() => {});
      const unsubscribe = session.subscribe(send);
      socket.on('close', unsubscribe);
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
