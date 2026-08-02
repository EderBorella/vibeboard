import { readFile, writeFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { type CardProblem, readArchive } from '../../core/board.js';
import { pickCardPatch } from '../../core/card.js';
import { findCard } from '../../core/find.js';
import { ARCHIVE_SLUG } from '../../core/layout.js';
import { setCardLinks } from '../../core/links.js';
import {
  archiveCard,
  type CreateCardInput,
  createCard,
  placeCard,
  restoreCard,
  restoreTarget,
  updateCard,
} from '../../core/mutations.js';
import { slugify } from '../../core/slug.js';
import { BOARDS, type BoardName, type ProjectConfig } from '../../core/types.js';
import { type AppCtx, ensureOpen, nowIso, today } from '../route-context.js';
import { resolveCardRuns } from '../run-store.js';

// A card in its board's last column is closed, so nothing on it is still waiting for a decision.
// Which column that is comes from the config rather than a name: "done" is a convention, and a
// project may call it anything.
function isClosingColumn(config: ProjectConfig, board: BoardName, columnSlug: string): boolean {
  const last = config.boards[board].columns.at(-1);
  return last !== undefined && slugify(last) === columnSlug;
}

interface CardRef {
  board: BoardName;
  id: string;
}

// Shared by /place and /move, so the resolve-on-close rule has one home. Two copies would drift
// the moment one of them gained a condition.
async function place(
  ctx: AppCtx,
  { board, id }: CardRef,
  toColumnSlug: string,
  beforeId: string | null,
  reply: FastifyReply,
): Promise<unknown> {
  const { root, config } = ctx.session as { root: string; config: ProjectConfig };
  const card = await findCard(root, board, id, config);
  if (!card) return reply.code(404).send({ error: 'Card not found' });
  const placed = await placeCard(root, config, card, toColumnSlug, beforeId);
  if (placed === 'unknown-column') return reply.code(400).send({ error: 'Unknown column' });
  // Closing a card resolves its runs. Done on the move rather than in the watcher: writing run
  // records in response to filesystem events, inside the folder the watcher watches, is a loop —
  // so a card moved by an agent editing files directly still needs Dismiss.
  if (isClosingColumn(config, board, placed.columnSlug)) {
    await resolveCardRuns(root, board, placed.id, nowIso());
  }
  return placed;
}

export async function registerCardRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.post('/cards', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const input = req.body as CreateCardInput;
    // The board is checked before the mutation layer sees it, because everything downstream indexes
    // `config.boards[board]` and an unknown name dereferences undefined — a stack trace and a 500,
    // handed to the caller least able to interpret one. Decision 10 says the board is validated;
    // it was not.
    if (!BOARDS.includes(input?.board)) return reply.code(400).send({ error: 'Unknown board' });
    const card = await createCard(ctx.session.root, ctx.session.config, input, today());
    if (card === 'unknown-column') return reply.code(400).send({ error: 'Unknown column' });
    return card;
  });

  api.patch('/cards/:board/:id', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, id } = req.params as { board: BoardName; id: string };
    const card = await findCard(ctx.session.root, board, id, ctx.session.config);
    if (!card) return reply.code(404).send({ error: 'Card not found' });
    // Filtered, not cast: the cast said what the body ought to be and let through whatever it was.
    return updateCard(ctx.session.root, card, pickCardPatch(req.body));
  });

  api.get('/cards/:board/:id/raw', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, id } = req.params as { board: BoardName; id: string };
    const card = await findCard(ctx.session.root, board, id, ctx.session.config);
    if (!card) return reply.code(404).send({ error: 'Card not found' });
    return { raw: await readFile(card.filePath, 'utf8') };
  });

  api.put('/cards/:board/:id/raw', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, id } = req.params as { board: BoardName; id: string };
    const { raw } = req.body as { raw: string };
    const card = await findCard(ctx.session.root, board, id, ctx.session.config);
    if (!card) return reply.code(404).send({ error: 'Card not found' });
    await writeFile(card.filePath, raw, 'utf8');
    return { ok: true };
  });

  api.put('/cards/:board/:id/links', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, id } = req.params as { board: BoardName; id: string };
    const { links } = (req.body ?? {}) as { links?: string[] };
    // The complete list, so a missing one is a request to clear — but only when it is deliberate.
    // `undefined` reaching setCardLinks was a 500.
    if (!Array.isArray(links)) return reply.code(400).send({ error: 'links must be an array' });
    const card = await findCard(ctx.session.root, board, id, ctx.session.config);
    if (!card) return reply.code(404).send({ error: 'Card not found' });
    // A target whose file exists but cannot be read is refused rather than silently dropped: the
    // caller asked for a link to a card that IS there, and answering 200 would tell an agent its
    // child is attached when it is an orphan.
    const unreadable: string[] = [];
    const updated = await setCardLinks(ctx.session.root, ctx.session.config, card, links, unreadable);
    if (unreadable.length > 0) {
      return reply.code(409).send({ error: `cannot link to unreadable ${unreadable.join(', ')}` });
    }
    return updated;
  });

  // Position a card: within its column (reorder) or into another one, in a single call.
  // `beforeId: null` means the end of the column. Admin only — see /move below.
  api.post('/cards/:board/:id/place', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { toColumnSlug, beforeId } = req.body as { toColumnSlug: string; beforeId?: string | null };
    return place(ctx, req.params as CardRef, toColumnSlug, beforeId ?? null, reply);
  });

  // Move a card to another column, appended at the end. A separate door onto the same function
  // rather than a second implementation: /place exists for a person dragging a tile, and its
  // `beforeId` is a judgement about a board they can see. An agent has no basis for answering it,
  // and an endpoint that demands an answer invites an invented one.
  api.post('/cards/:board/:id/move', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { toColumnSlug } = req.body as { toColumnSlug: string };
    return place(ctx, req.params as CardRef, toColumnSlug, null, reply);
  });

  api.post('/cards/:board/:id/archive', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, id } = req.params as { board: BoardName; id: string };
    const card = await findCard(ctx.session.root, board, id, ctx.session.config);
    if (!card) return reply.code(404).send({ error: 'Card not found' });
    return archiveCard(ctx.session.root, card, nowIso());
  });

  // The archive is fetched on demand rather than pushed with every snapshot — see
  // buildSnapshot. `restoreTo` tells the UI where each card would land if restored now.
  api.get('/archive/:board', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board } = req.params as { board: BoardName };
    const problems: CardProblem[] = [];
    const cards = await readArchive(ctx.session.root, board, problems);
    // Hoisted: narrowing from ensureOpen does not reach inside the callback.
    const config = ctx.session.config;
    // `problems` is what the badge counts and this list cannot show. Sent so the drawer can account
    // for the difference rather than looking like it lost something.
    return { cards: cards.map((c) => ({ ...c, restoreTo: restoreTarget(config, c) })), problems };
  });

  api.post('/cards/:board/:id/restore', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, id } = req.params as { board: BoardName; id: string };
    const { toColumnSlug } = (req.body ?? {}) as { toColumnSlug?: string };
    const card = await findCard(ctx.session.root, board, id, ctx.session.config);
    if (!card) return reply.code(404).send({ error: 'Card not found' });
    if (card.columnSlug !== ARCHIVE_SLUG) return reply.code(400).send({ error: 'Card is not archived' });
    const restored = await restoreCard(ctx.session.root, ctx.session.config, card, toColumnSlug);
    if (restored === 'unknown-column') return reply.code(400).send({ error: 'Unknown column' });
    return restored;
  });
}
