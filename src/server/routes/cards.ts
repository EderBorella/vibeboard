import { readFile, writeFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { boardColumnSlugs, type CardProblem, readArchive, readBoard } from '../../core/board.js';
import { FORBIDDEN_PATCH_KEYS, forbiddenPatchSentence, pickCardPatch } from '../../core/card.js';
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
import { phaseForRun } from '../../core/phases.js';
import { slugify } from '../../core/slug.js';
import { BOARDS, type BoardName, type CardFrontmatter, type ProjectConfig } from '../../core/types.js';
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
// THE BASIS IS THE PHASE, NOT THE COLUMN (ruling 56). A run may create a card only on the board its phase's
// `creates` names, and `phaseForRun` needs the run's own board as well as its skill: `break-down` is TWO
// phases with different `creates`, so a story's break-down resolved on the skill alone would carry the
// authority to create features.
//
// THE LOOP THE OLD RULE CLOSED IS CLOSED BY THE MACHINE. It asked which column dispatches which skill, and
// under this machine a column dispatches nothing — so the question has no answer, while `feature-breakdown` is
// now chosen from the position rather than from a column and cannot be re-entered by a card appearing in one.
//
// It fires for a hand dispatch too, and deliberately: a skill no phase names creates nothing, because there is
// no `creates` to infer for it and inventing one would be guessing on the caller's behalf.
function wrongBoardForRun(
  config: ProjectConfig,
  cred: { board?: BoardName; skill?: string },
  input: CreateCardInput,
): string | undefined {
  if (!cred.skill) return undefined;
  const creates = phaseForRun(cred.skill, cred.board)?.creates;
  // A phase with no `creates`, and a skill no phase names, may create nothing. The work it found is real; it
  // is just not a card this run gets to make, so the refusal names the surface that exists for it.
  if (creates === undefined) {
    return `A ${cred.skill} run may not create cards: that phase's product is its own work, and a card it made would be work no phase picks up. Anything real you found that does not belong to this card goes to POST /api/suggestions instead.`;
  }
  if (creates !== input.board) {
    return `A ${cred.skill} run on ${cred.board ?? 'the project'} may create cards on ${creates} only, not on ${input.board}: which board a run may create on is decided by its phase. ${whereItGoes(config, creates)}`;
  }
  return undefined;
}

// The remediation sentence, DERIVED rather than assumed. It used to name a route's `next` — where the run's own
// card goes when it passes, which is not where a NEW card belongs — and a review enumerated the default table
// to show what that advised: a column with no route (the card parked for ever), two TERMINAL ones (and
// `complete` reads a live card in a terminal column as its positive evidence, so a compliant agent could
// manufacture a false success), and one that handed a new card straight to a verifier.
//
// With no `next` there is nothing to derive: a new card enters at the top of its board, which is the same
// column `entryColumn` stamps. Naming it twice would be two answers to one question.
function whereItGoes(config: ProjectConfig, board: BoardName): string {
  const entry = entryColumn(config, board);
  return entry === undefined
    ? `A new card enters that board at its first column, and that board's first column is one nothing can continue from — fix its column order in Settings.`
    : `Create it in ${board}/${entry} instead — that is where a new card enters that board.`;
}

// WHERE A BOARD IS ENTERED: its first column, POSITIONALLY, and `undefined` rather than a fallback when that
// column is one nothing can continue from. The loop stamps `todo` itself when it starts a break-down (decision
// 37 superseded), so `backlog` — the top of the board — is where a created card belongs.
//
// "Every board opens with a Backlog" is a SCAFFOLDER DEFAULT, not an invariant: columns can be renamed and
// reordered, and a review pointed out that on a board whose first column happened to be terminal this stamp
// would put every child card exactly where it exists to stop one going — standing as a live card in a
// terminal column, which is the positive evidence `complete` reads. Refused rather than worked around,
// because there is no other column a card can be said to enter at.
//
// `Array.isArray` and the string compare because `autopilot` is parsed YAML: a hand-edited block arrives as
// whatever was in the file, and reading a member off it is a 500 handed to the caller least able to interpret
// one.
// EXPORTED for the suggestions route, which cards a finding onto features or product and needs the same
// answer. One home rather than two: a second copy is how one path refuses a terminal first column and
// the other quietly creates a card in it.
export function entryColumn(config: ProjectConfig, board: BoardName): string | undefined {
  const slug = boardColumnSlugs(config, board)[0];
  if (slug === undefined) return undefined;
  const terminal = config.autopilot?.terminal?.[board];
  if (Array.isArray(terminal) && terminal.includes(slug)) return undefined;
  // Engineering's alone, like `isBlockedColumn`: a card is put in `blocked` when it has exhausted its
  // attempts, so a new one created there is work nothing will ever pick up.
  if (board === 'engineering' && config.autopilot?.blockedColumn === slug) return undefined;
  return slug;
}

// What the server decides about a card a run is creating, or why it will not create one: the column it enters,
// the vertical it belongs to, and which run made it. RULING 58 and RULING 61 both land here, beside the group —
// which is already where "a value the caller supplies is a value the caller can get wrong" is acted on.
//
// THE VERTICAL is the id of the feature at the top of it, stamped for the reason every other field on a run
// record is stamped: a value the caller supplies is a value the caller can get wrong, and one mistyped group
// silently splits a vertical in two. It is the group of the card the run is ABOUT — that card's own group, or
// its id when it IS the feature — so a level down inherits its parent's vertical and a checkup's sibling stays
// in the same one it was created beside (ruling 61).
//
// AND THE COLUMN IT ENTERS AT, which is the second thing the first hand-run got wrong. `break-down` created
// its three user stories in `product/in-progress` — a column with no route then, whose only way out was a
// rollup, and a childless card never rolled up. Three real stories, correctly written and correctly linked,
// parked where nothing could ever move them; the loop's next honest answer would have been to stop `stalled`.
//
// So a card a run creates enters its board's FIRST column, whatever the caller asked for: entering the pipeline
// at the top is what a new card means, and any other column skips the phases before it. The scaffolder already
// relies on the same fact — "every board opens with a Backlog" — because an agent told to use "the right
// column" and given none reached for `backlog` and created a folder no column mapped to.
//
// Stamped rather than refused, because unlike the board rule above there is nothing wrong with the CARD: the
// work is real, the link is right, and only the column was a guess. Refusing would throw away a good card and
// one of three attempts.
async function stampForRun(
  ctx: AppCtx,
  cred: { board?: BoardName; card?: string; skill?: string; run?: string },
  input: CreateCardInput,
): Promise<{ patch: Partial<CreateCardInput> } | { error: string }> {
  const { root, config } = ctx.session as { root: string; config: ProjectConfig };
  // RULING 58: which run made this card, from the credential the server minted — never from the body, and on
  // every card a run creates, the bootstrap's features included. It is what makes "has this already been
  // done?" answerable from the board with nothing to trust.
  const creator = { createdBy: cred.run };
  // THE COLUMN IS STAMPED FOR EVERY RUN, THE BOOTSTRAP INCLUDED, and that is a correction. The skip below used
  // to cover the entry column as well, on the grounds that the bootstrap's features are a same-board create —
  // and it is ruling 61's own failure left standing for the one caller the rule it replaced deliberately
  // excused. Unstamped, five features created into `features/done` read as: the board grew, so `createdNothing`
  // passes; `stampSetup` finds no feature in `backlog` and withholds the flag; the next tick derives an empty
  // position, `unfinished` is empty and a live card sits in a terminal column — `complete`, on a project where
  // nothing was built.
  const entry = entryColumn(config, input.board);
  if (entry === undefined) {
    const first = boardColumnSlugs(config, input.board)[0];
    return {
      error: `A run cannot create a card on ${input.board}: a new card enters a board at its first column, and that board opens with ${first === undefined ? 'no column at all' : `"${first}"`}, which nothing can continue from. Reorder that board's columns in Settings.`,
    };
  }
  // WHAT THE BOOTSTRAP IS STILL EXCUSED IS THE GROUP, and only that: a project run is about no card, so there
  // is no parent to take a vertical from — the features it derives are the tops of their own verticals.
  if (cred.skill !== undefined && phaseForRun(cred.skill, cred.board)?.name === 'bootstrap') {
    return { patch: { ...creator, columnSlug: entry } };
  }
  const parent = cred.card ? await findCard(root, cred.board ?? input.board, cred.card, config) : undefined;
  return {
    patch: {
      ...creator,
      columnSlug: entry,
      // ALWAYS decided here, `undefined` included. No parent found is not an error — the run's card may have
      // been archived under it, and refusing real work over a label would be the wrong trade — but the card
      // then has NO group rather than whatever the agent sent. A review found the agent's own value surviving
      // this branch, which is the one thing the stamp exists to prevent: a vertical labelled by a guess.
      //
      // The group of the card the run is ABOUT, not that card's parent's (ruling 61): a checkup's sibling
      // belongs to the same vertical as the card it was created beside.
      group: parent ? (parent.group ?? parent.id) : undefined,
    },
  };
}

// The two flags and nothing else. `false` CLEARS rather than being rejected: `serializeCard` emits either
// key only when true, so turning one off is the same write as never having set it.
//
// A body with neither is a 400, not a 200: a request that changed nothing would tell the loop its stamp
// landed, and the bootstrap's exit is the one deterministic act decision 44 rests on.
const FLAGS = ['setup', 'followUp'] as const;

function pickFlags(body: unknown): { patch: Partial<CardFrontmatter>; error?: string } {
  const o = (body ?? {}) as Record<string, unknown>;
  const unknown = Object.keys(o).filter((k) => !(FLAGS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    return { patch: {}, error: `Cannot set ${unknown.join(', ')} here: this route sets setup and followUp.` };
  }
  const patch: Partial<CardFrontmatter> = {};
  for (const key of FLAGS) {
    if (o[key] === undefined) continue;
    if (typeof o[key] !== 'boolean') return { patch: {}, error: `${key} must be true or false.` };
    patch[key] = o[key] === true ? true : undefined;
  }
  if (!FLAGS.some((k) => k in patch)) {
    return { patch: {}, error: 'Set setup or followUp: a request that sets neither would change nothing.' };
  }
  return { patch };
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
    // A run is held to the lifecycle; a person at the browser is not.
    //
    // THE BOARD IS JUDGED BEFORE THE STAMP, which is a change of order: the refusal used to read the column
    // the agent guessed, so the stamp had to correct it first. It now reads the board alone, and asking which
    // board a run may write to before working out where on it the card goes is the order that cannot produce a
    // sentence about the wrong board.
    let effective = input;
    if (req.credential?.run) {
      // 409 rather than 400: the request is well formed, and it is the project's lifecycle that makes it wrong.
      const wrong = wrongBoardForRun(ctx.session.config, req.credential, input);
      if (wrong) return reply.code(409).send({ error: wrong });
      const stamped = await stampForRun(ctx, req.credential, input);
      if ('error' in stamped) return reply.code(409).send({ error: stamped.error });
      // The stamp wins over anything the caller sent, like every other field the server knows better than the
      // agent does.
      effective = { ...input, ...stamped.patch };
    }
    const card = await createCard(ctx.session.root, ctx.session.config, effective, today());
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
    //
    // TWO CLAUSES, because there are two reasons to refuse and one sentence could only be right about
    // one of them: shape for a field this endpoint takes, and authority for a field it does not. Telling
    // a caller that `setup` was "expected a string" sends it to fix the wrong thing.
    if (rejected.length > 0) {
      const forbidden = rejected.filter((k) => FORBIDDEN_PATCH_KEYS.includes(k));
      const mistyped = rejected.filter((k) => !FORBIDDEN_PATCH_KEYS.includes(k));
      const parts = [
        mistyped.length > 0
          ? `Cannot set ${mistyped.join(', ')}: expected a string, or a list of strings for tags`
          : undefined,
        forbidden.length > 0 ? forbiddenPatchSentence(forbidden) : undefined,
      ].filter((p): p is string => p !== undefined);
      return reply.code(400).send({ error: parts.join('. ') });
    }
    return updateCard(ctx.session.root, card, patch);
  });

  // The `service`-only write path decision 44 needs. A route of its own rather than widening PATCH: the
  // PATCH allow-list is what stops a work agent flagging its own card, and a body-dependent exception to
  // it would be a new category of thing the scope table cannot express.
  api.post('/cards/:board/:id/flags', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { board, id } = req.params as { board: BoardName; id: string };
    const card = await findCard(ctx.session.root, board, id, ctx.session.config);
    if (!card) return reply.code(404).send({ error: 'Card not found' });
    const { patch, error } = pickFlags(req.body);
    if (error) return reply.code(400).send({ error });
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
