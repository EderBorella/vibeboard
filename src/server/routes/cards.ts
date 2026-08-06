import { readFile, writeFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { type CardProblem, readArchive, readBoard } from '../../core/board.js';
import { pickCardPatch } from '../../core/card.js';
import { findCard } from '../../core/find.js';
import { oneParentProblem } from '../../core/hierarchy.js';
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

// WHERE A RUN MAY CREATE A CARD, and what vertical the card belongs to. Both answered here, in the endpoint,
// because decision 10 makes endpoints the only write path — so this is the one place that cannot be talked
// out of by a prompt.
//
// THE LOOP THIS CLOSES, from the first hand-run: `derive-features` created five feature cards in
// `features/backlog` — the column whose own route dispatches `derive-features`. Each was then dispatched
// `derive-features` in turn, reported "nothing needed to be created", was passed by the critic, and ADVANCED
// FOR DOING NOTHING. Two iterations per card, for ever, on a board that grows as it goes. The skill was told
// where to put them; a skill instruction is a request, and this is the rule.
//
// Stated as a general property rather than as a special case for one skill: **a run may not create a card in
// a column that dispatches the skill the run is doing.** Any such card is work the phase makes for itself.
//
// It fires for a hand dispatch too, and deliberately: the loop is the same one whoever pressed the button.
function wrongColumnForRun(
  config: ProjectConfig,
  cred: { board?: BoardName; skill?: string },
  input: CreateCardInput,
): string | undefined {
  const routes = config.autopilot?.routes;
  // A project with no lifecycle has no phases to make work for themselves. `Array.isArray` because
  // `autopilot` is parsed YAML, and a hand-edited block reaches here as whatever was in the file.
  if (!Array.isArray(routes) || !cred.skill) return undefined;
  const loop = routes.find(
    (r) => r.board === input.board && r.column === input.columnSlug && r.skill === cred.skill,
  );
  if (!loop) return undefined;
  return `A ${cred.skill} run may not create a card in ${input.board}/${input.columnSlug}: that column dispatches ${cred.skill}, so the card you just made would be sent straight back through the phase that made it. Create it in ${input.board}/${loop.next} instead — that is where such a card goes next.`;
}

// The vertical a run's new card belongs to: the id of the feature at the top of it. Stamped by the server
// rather than asked of the agent, for the reason every other field on a run record is stamped — a value the
// caller supplies is a value the caller can get wrong, and one mistyped group silently splits a vertical in
// two.
//
// The rule reads off the boards: a card created on a DIFFERENT board from the run's own card is a level down
// (a feature's user story, a story's task), so it inherits its parent's vertical — the parent's own group, or
// the parent's id when the parent IS the feature. A card created on the SAME board is a sibling, not a child:
// that is `derive-features` making features, and a feature is the root of its own vertical rather than part of
// another one.
async function verticalFor(
  ctx: AppCtx,
  cred: { board?: BoardName; card?: string },
  input: CreateCardInput,
): Promise<string | undefined> {
  const { root, config } = ctx.session as { root: string; config: ProjectConfig };
  if (!cred.board || !cred.card || cred.board === input.board) return undefined;
  const parent = await findCard(root, cred.board, cred.card, config);
  // No parent found is not an error here: the run's card may have been archived under it. The card is still
  // created — refusing real work over a missing label would be the wrong trade — it simply has no group.
  return parent ? (parent.group ?? parent.id) : undefined;
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
    // A run is held to the lifecycle; a person at the browser is not. 409 rather than 400: the request is
    // well formed, and it is the project's state that makes it wrong.
    if (req.credential?.run) {
      const wrong = wrongColumnForRun(ctx.session.config, req.credential, input);
      if (wrong) return reply.code(409).send({ error: wrong });
    }
    const group = req.credential?.run ? await verticalFor(ctx, req.credential, input) : undefined;
    const card = await createCard(
      ctx.session.root,
      ctx.session.config,
      // The stamp wins over anything the caller sent, like every other field the server knows better than
      // the agent does.
      group === undefined ? input : { ...input, group },
      today(),
    );
    if (card === 'unknown-column') return reply.code(400).send({ error: 'Unknown column' });
    return card;
  });

  api.patch('/cards/:board/:id', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, id } = req.params as { board: BoardName; id: string };
    const card = await findCard(ctx.session.root, board, id, ctx.session.config);
    if (!card) return reply.code(404).send({ error: 'Card not found' });
    // Filtered, not cast: the cast said what the body ought to be and let through whatever it was.
    const { patch, rejected } = pickCardPatch(req.body);
    // A wrong-typed field is refused, not dropped. Answering 200 over a card that did not change tells
    // the caller — very often an agent — that it succeeded, so it never tries the other spelling.
    if (rejected.length > 0) {
      return reply.code(400).send({
        error: `Cannot set ${rejected.join(', ')}: expected a string, or a list of strings for tags`,
      });
    }
    return updateCard(ctx.session.root, card, patch);
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

    // Always for a run credential: rollup derives the hierarchy from links, and an agent has no way
    // to know which of two links a person meant as "see also". For the browser and the copilot it is
    // the project's choice — many-to-many is legitimate when someone means it, and only rollup cannot
    // survive it.
    const enforceOneParent =
      req.credential?.scope !== 'admin' || ctx.session.config.enforceOneParent === true;
    if (enforceOneParent) {
      // Hoisted: `ensureOpen` narrows the session, and that narrowing does not survive into the
      // closure below.
      const { root, config } = ctx.session;
      const everyCard = (await Promise.all(BOARDS.map((b) => readBoard(root, b, config)))).flat();
      // Both directions: the payload writes the back-reference onto every target too, so checking
      // only the card in the URL left the parent side open.
      const problem = oneParentProblem(card, links, everyCard);
      if (problem) return reply.code(400).send({ error: problem });
    }

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
