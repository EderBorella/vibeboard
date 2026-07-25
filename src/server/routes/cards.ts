import type { FastifyInstance } from 'fastify';
import { readFile, writeFile } from 'node:fs/promises';
import {
  createCard, updateCard, placeCard, archiveCard, restoreCard, restoreTarget,
  type CreateCardInput,
} from '../../core/mutations.js';
import { readArchive, ARCHIVE_SLUG } from '../../core/board.js';
import { findCard } from '../../core/find.js';
import { setCardLinks } from '../../core/links.js';
import type { BoardName, CardFrontmatter } from '../../core/types.js';
import { ensureOpen, today, nowIso, type AppCtx } from '../route-context.js';

export async function registerCardRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.post('/cards', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const input = req.body as CreateCardInput;
    return createCard(ctx.session.root!, ctx.session.config!, input, today());
  });

  api.patch('/cards/:board/:id', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, id } = req.params as { board: BoardName; id: string };
    const card = await findCard(ctx.session.root!, board, id, ctx.session.config!);
    if (!card) return reply.code(404).send({ error: 'Card not found' });
    return updateCard(ctx.session.root!, card, req.body as Partial<CardFrontmatter> & { body?: string });
  });

  api.get('/cards/:board/:id/raw', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, id } = req.params as { board: BoardName; id: string };
    const card = await findCard(ctx.session.root!, board, id, ctx.session.config!);
    if (!card) return reply.code(404).send({ error: 'Card not found' });
    return { raw: await readFile(card.filePath, 'utf8') };
  });

  api.put('/cards/:board/:id/raw', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, id } = req.params as { board: BoardName; id: string };
    const { raw } = req.body as { raw: string };
    const card = await findCard(ctx.session.root!, board, id, ctx.session.config!);
    if (!card) return reply.code(404).send({ error: 'Card not found' });
    await writeFile(card.filePath, raw, 'utf8');
    return { ok: true };
  });

  api.put('/cards/:board/:id/links', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, id } = req.params as { board: BoardName; id: string };
    const { links } = req.body as { links: string[] };
    const card = await findCard(ctx.session.root!, board, id, ctx.session.config!);
    if (!card) return reply.code(404).send({ error: 'Card not found' });
    return setCardLinks(ctx.session.root!, ctx.session.config!, card, links);
  });

  // Position a card: within its column (reorder) or into another one, in a single call.
  // `beforeId: null` means the end of the column.
  api.post('/cards/:board/:id/place', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, id } = req.params as { board: BoardName; id: string };
    const { toColumnSlug, beforeId } = req.body as { toColumnSlug: string; beforeId?: string | null };
    const card = await findCard(ctx.session.root!, board, id, ctx.session.config!);
    if (!card) return reply.code(404).send({ error: 'Card not found' });
    return placeCard(ctx.session.root!, ctx.session.config!, card, toColumnSlug, beforeId ?? null);
  });

  api.post('/cards/:board/:id/archive', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, id } = req.params as { board: BoardName; id: string };
    const card = await findCard(ctx.session.root!, board, id, ctx.session.config!);
    if (!card) return reply.code(404).send({ error: 'Card not found' });
    return archiveCard(ctx.session.root!, card, nowIso());
  });

  // The archive is fetched on demand rather than pushed with every snapshot — see
  // buildSnapshot. `restoreTo` tells the UI where each card would land if restored now.
  api.get('/archive/:board', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board } = req.params as { board: BoardName };
    const cards = await readArchive(ctx.session.root!, board);
    return { cards: cards.map((c) => ({ ...c, restoreTo: restoreTarget(ctx.session.config!, c) })) };
  });

  api.post('/cards/:board/:id/restore', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, id } = req.params as { board: BoardName; id: string };
    const { toColumnSlug } = (req.body ?? {}) as { toColumnSlug?: string };
    const card = await findCard(ctx.session.root!, board, id, ctx.session.config!);
    if (!card) return reply.code(404).send({ error: 'Card not found' });
    if (card.columnSlug !== ARCHIVE_SLUG) return reply.code(400).send({ error: 'Card is not archived' });
    const restored = await restoreCard(ctx.session.root!, ctx.session.config!, card, toColumnSlug);
    if (restored === 'unknown-column') return reply.code(400).send({ error: 'Unknown column' });
    return restored;
  });
}
