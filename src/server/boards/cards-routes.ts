import { readFile, writeFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { FORBIDDEN_PATCH_KEYS, forbiddenPatchSentence, pickCardPatch } from '../../core/card.js';
import { entryColumn } from '../../core/entry-column.js';
import { findCard } from '../../core/find.js';
import { oneParentProblem, parentBoardOf, parentOf } from '../../core/hierarchy.js';
import { ARCHIVE_SLUG } from '../../core/layout.js';
import { actingPhase, MINI_SKILLS, phaseForRun } from '../../core/phases.js';
import {
  BOARDS,
  type BoardName,
  type Card,
  type CardFrontmatter,
  oneOf,
  type ProjectConfig,
} from '../../core/types.js';
import { boardColumnSlugs, type CardProblem, readArchive, readBoard } from '../../store/cards/board.js';
import { createLinkedCard, setCardLinks } from '../../store/cards/links.js';
import {
  archiveCard,
  type CreateCardInput,
  restoreCard,
  restoreTarget,
  updateCard,
} from '../../store/cards/mutations.js';
import { type AppCtx, ensureOpen, nowIso, today } from '../route-context.js';
import { moveCard } from './move.js';

interface CardRef {
  board: BoardName;
  id: string;
}

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
  const placed = await moveCard(root, config, card, toColumnSlug, beforeId);
  if (placed === 'unknown-column') return reply.code(400).send({ error: 'Unknown column' });
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
// no `creates` to infer for it and inventing one would be guessing on the caller's behalf. The one exception is
// the hand break-down, which borrows its board's break-down row (`actingPhase`, decision 96).
// A Mini project run: the loop's build or review, about no card (decision 102). A person's run of the same skill
// from a card is not one.
function isMiniRun(cred: { card?: string; skill?: string }): boolean {
  return cred.card === undefined && cred.skill !== undefined && MINI_SKILLS.includes(cred.skill);
}

function wrongBoardForRun(
  config: ProjectConfig,
  cred: { board?: BoardName; skill?: string },
  input: CreateCardInput,
): string | undefined {
  if (!cred.skill || isMiniRun(cred)) return undefined;
  const creates = actingPhase(cred.skill, cred.board)?.creates;
  // A phase with no `creates`, and any other skill no phase names, may create nothing. The work it found is real; it
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

// THE PARENT LINK IS THE SERVER'S TOO (ruling 65), and it is the fourth fact this endpoint asserts rather than
// accepts. `POST /api/cards` took a `links` field and wrote it straight into the new card's frontmatter, which
// is one side of a symmetric relation: `childrenOf` and `parentOf` both read the PARENT's list, so a
// child-side-only link is invisible in both directions. The server had the parent in hand on that very request
// — the stamp below loads it for the vertical — and stamped the group from it while not linking to it.
//
// THE PARENT IS THE CARD ON THE BOARD ABOVE WHAT THIS PHASE CREATES, in the run's vertical. "Link to the run's
// own card" is the version that looks right and silently does nothing: `story-review` creates SIBLINGS on its
// own board, whose parent is the feature, and a sibling linked to its sibling is nobody's child. So: the run's
// own card when it sits on that board (both break-downs, `feature-checkup`), the card above it when the phase
// creates on its own board (`story-review`), and none at all when the phase creates features — nothing sits
// above a feature.
//
// UNRESOLVABLE MEANS NO LINK AND NO REFUSAL, the trade the group already makes: the run's own card may have
// been archived under it, and refusing real work over a label is the wrong way round.
async function parentForRun(
  root: string,
  config: ProjectConfig,
  own: Card | undefined,
  creating: BoardName,
): Promise<string | undefined> {
  const above = parentBoardOf(creating);
  if (above === undefined || own === undefined) return undefined;
  if (own.board === above) return own.id;
  return parentOf(own, await readBoard(root, above, config))?.id;
}

// What the server decides about a card a run is creating, or why it will not create one: the column it enters,
// the vertical it belongs to, which run made it, and the parent it hangs off. RULING 58, RULING 61 and RULING
// 65 all land here, beside the group — which is already where "a value the caller supplies is a value the
// caller can get wrong" is acted on.
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
): Promise<{ patch: Partial<CreateCardInput>; links: string[] } | { error: string }> {
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
  // WHAT THE BOOTSTRAP IS STILL EXCUSED IS THE GROUP AND THE LINK, and only those: a project run is about no
  // card, so there is no parent to take a vertical from and none to hang off — the features it derives are the
  // tops of their own verticals.
  if (cred.skill !== undefined && phaseForRun(cred.skill, cred.board)?.name === 'bootstrap') {
    return { patch: { ...creator, columnSlug: entry }, links: [] };
  }
  // The card the run is ABOUT. Both facts below are read off it, and both are `undefined` when it cannot be
  // found rather than taken from the caller.
  const own = cred.card ? await findCard(root, cred.board ?? input.board, cred.card, config) : undefined;
  const parent = await parentForRun(root, config, own, input.board);
  return {
    patch: {
      ...creator,
      columnSlug: entry,
      // ALWAYS decided here, `undefined` included. No card found is not an error — the run's card may have
      // been archived under it, and refusing real work over a label would be the wrong trade — but the card
      // then has NO group rather than whatever the agent sent. A review found the agent's own value surviving
      // this branch, which is the one thing the stamp exists to prevent: a vertical labelled by a guess.
      //
      // The group of the card the run is ABOUT, not that card's parent's (ruling 61): a checkup's sibling
      // belongs to the same vertical as the card it was created beside.
      group: own ? (own.group ?? own.id) : undefined,
    },
    links: parent ? [parent] : [],
  };
}

// A RUN MAY NOT CREATE A SECOND CARD FOR ONE PIECE OF WORK, and this is ruling 58's correction. The
// `createdBy` stamp answers "has a RE-RUN already done this"; it says nothing about one run creating the same
// card twice in a single pass, which is what the first real run did — `E-001` and `E-002` both "Create
// package.json with metadata", while its own report claimed two tasks where the board had three. The loop was
// unharmed, because it counts the board rather than the report, but the duplicate then cost a full
// implement-and-review cycle on work that was already done. The ten-features incident was the same shape.
//
// AT THE ENDPOINT rather than in a prompt, for the reason every other rule here is: an agent that has lost
// track of its own work is exactly the agent that cannot be asked to remember.
//
// IT NAMES THE CARD THAT ALREADY HOLDS THE TITLE, because an agent told only "no" tries again — and the id is
// also the answer to what it should have found by reading the board first.
async function duplicateTitleForRun(ctx: AppCtx, input: CreateCardInput): Promise<string | undefined> {
  const { root, config } = ctx.session as { root: string; config: ProjectConfig };
  const wanted = comparableTitle(input.title);
  // An untitled card is a different fault and not this one's to report: matching every other untitled card
  // would refuse the second one for the wrong reason.
  if (wanted === '') return undefined;
  // LIVE CARDS IN ONE COLUMN. `readBoard` skips the archive, which is deliberate — a card must not collide
  // with its own history — and the column narrows it because a card advancing through the board would
  // otherwise collide with itself, and a genuinely different task may share a title with one elsewhere.
  const live = await readBoard(root, input.board, config);
  const holder = live.find((c) => c.columnSlug === input.columnSlug && comparableTitle(c.title) === wanted);
  if (!holder) return undefined;
  return `${holder.id} in ${input.board}/${input.columnSlug} is already titled "${holder.title}", so this would be a second card for one piece of work. If ${holder.id} is the card you meant, it is already made and there is nothing to create; if this is genuinely different work, say how in the title.`;
}

// Case and surrounding whitespace only. Not `slugify`, which also folds punctuation and would call two titles
// a person can tell apart the same one — and a refusal is expensive enough that it must not be a guess.
function comparableTitle(title: unknown): string {
  return typeof title === 'string' ? title.trim().toLowerCase() : '';
}

// What the credential says about the run doing the creating. The three rules above each read a subset of it.
type RunCredential = { board?: BoardName; card?: string; skill?: string; run?: string };

// EVERY LIFECYCLE RULE A CREATE MUST PASS, in the one order that works — and in a function of its own so the
// route stays a flat sequence, which is also what keeps its complexity where a nested chain of refusals put it.
//
// THE BOARD IS JUDGED BEFORE THE STAMP, which is a change of order: the refusal used to read the column the
// agent guessed, so the stamp had to correct it first. It now reads the board alone, and asking which board a
// run may write to before working out where on it the card goes is the order that cannot produce a sentence
// about the wrong board.
//
// AND THE TITLE IS JUDGED AFTER IT, for the mirror-image reason: the column the card actually enters is the one
// the stamp decided, so comparing against the column the agent asked for would look in a column the card was
// never going to land in — and a run could get its duplicate through by naming a different one.
async function lifecycleRulesForCreate(
  ctx: AppCtx,
  cred: RunCredential,
  input: CreateCardInput,
): Promise<{ effective: CreateCardInput; links: string[] } | { error: string }> {
  const { config } = ctx.session as { config: ProjectConfig };
  const wrong = wrongBoardForRun(config, cred, input);
  if (wrong) return { error: wrong };
  const stamped = await stampForRun(ctx, cred, input);
  if ('error' in stamped) return stamped;
  // The stamp wins over anything the caller sent, like every other field the server knows better than the
  // agent does.
  const effective = { ...input, ...stamped.patch };
  const duplicate = await duplicateTitleForRun(ctx, effective);
  return duplicate ? { error: duplicate } : { effective, links: stamped.links };
}

// The two flags and nothing else. `false` CLEARS rather than being rejected: `serializeCard` emits either
// key only when true, so turning one off is the same write as never having set it.
//
// A body with neither is a 400, not a 200: a request that changed nothing would tell the loop its stamp
// landed, and the bootstrap's exit is the one deterministic act decision 44 rests on.
const FLAGS = ['setup', 'followUp'] as const;
const isFlag = oneOf(FLAGS);

// WHAT THE BODY OF A CREATE MAY SAY, and `links` is a PERSON'S field alone (ruling 65). A `work` credential is
// confined to its own card for `PUT …/links`, so the only link a run may legitimately write is parent↔child —
// and this field is where that confinement leaked, into an asymmetric write nothing inspects. A run's parent
// link is now the server's to assert, so what a run sends here is not consulted; the field is off the
// catalogue the credential advertises (server/auth/auth.ts) in the same change, because a contract that still
// offers it keeps inviting the bug. The one exception is the loop's own create (`withLoopParent`).
type CreateCardBody = CreateCardInput & { links?: string[] };

// THE ONE FIELD ON A CREATE WHOSE TYPE IS CHECKED HERE, and it is checked because it is the only one the
// machine later executes something on the strength of (decision 85). The body is spread into the card, so
// `satisfiedBy: {cmd: 'npm test'}` was answered 200 and written into the frontmatter as a YAML map — under a
// key the frozen on-disk format says is `string | undefined`, and one `criterionCommand` calls `.trim()` on.
//
// REFUSED RATHER THAN DROPPED, which is the rule the PATCH route below already follows and the reason it
// gives: an agent told 200 over a field this endpoint discarded has no reason to try the other spelling, and
// a break-down that thinks it named the criterion has written a story nothing can skip.
//
// `null` IS A WRONG TYPE, not an absent field. It is what a JSON encoder emits for a value the agent did not
// have, so it is the one that arrives by accident — and `typeof null` is `'object'`, which is how a check
// written to exclude objects lets it through. `undefined` is the absent field, and the only one.
//
// AND THE PARAMETER IS `unknown` RATHER THAN `CreateCardBody`, which is the whole point: the route CASTS `req.body` to that type, so
// the declared `satisfiedBy?: string` is a claim about what should arrive rather than a fact about what did.
// Reading it through the declared type is how the field got here unexamined.
function wrongSatisfiedBy(body: unknown): string | undefined {
  const value = ((body ?? {}) as Record<string, unknown>).satisfiedBy;
  if (value === undefined || typeof value === 'string') return undefined;
  return 'Cannot set satisfiedBy: expected a string naming one of the gate commands this project declares in foundation/CODE-QUALITY.md, exactly as that document writes it.';
}

// Always for a run credential: the machine derives the hierarchy from links — the position it works from and
// the checkup that advances a parent once its children are settled — and an agent has no way to know which of
// two links a person meant as "see also". For the browser and the copilot it is the project's choice:
// many-to-many is legitimate when someone means it, and only the derived hierarchy cannot survive it.
//
// ONE HOME for the two writers that need it. The create path grew the same check (ruling 65), and two copies
// would drift into a project where a link the create refuses an edit allows.
function enforcesOneParent(config: ProjectConfig, scope?: string): boolean {
  return scope !== 'admin' || config.enforceOneParent === true;
}

function pickFlags(body: unknown): { patch: Partial<CardFrontmatter>; error?: string } {
  const o = (body ?? {}) as Record<string, unknown>;
  const unknown = Object.keys(o).filter((k) => !isFlag(k));
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

// THE ONE CREATE THAT NAMES ITS PARENT (decision 92). The loop's own credential writes each story's one task, and a
// run's parent is derived from the card it is about — the loop is about none, so the task would land unlinked and
// the story would still look empty. So the `service` scope may name one parent, only where none was derived, and
// only a live card on the board directly above: the parent a derivation would have produced, never a sibling or a
// card two boards up. The group comes from that parent, as it does for a break-down's tasks. A Mini build is the
// other caller with no card to derive from: it writes the whole board, stories under features and tasks under
// stories (decision 102).
async function withLoopParent(
  ctx: AppCtx,
  ruled: { effective: CreateCardInput; links: string[] } | { error: string },
  cred: { scope?: string; card?: string; skill?: string },
  asked: unknown,
): Promise<{ effective: CreateCardInput; links: string[] } | { error: string }> {
  const namesParent = cred.scope === 'service' || isMiniRun(cred);
  if ('error' in ruled || !namesParent || ruled.links.length > 0 || !Array.isArray(asked)) return ruled;
  const id = asked.find((one): one is string => typeof one === 'string');
  if (id === undefined) return ruled;
  const above = parentBoardOf(ruled.effective.board);
  const { root, config } = ctx.session as { root: string; config: ProjectConfig };
  const parent = above === undefined ? undefined : await findCard(root, above, id, config);
  if (!parent || parent.archived) {
    return {
      error: `A new ${ruled.effective.board} card may hang only off a live card on the board above it, and ${id} is not one.`,
    };
  }
  return { effective: { ...ruled.effective, group: parent.group ?? parent.id }, links: [parent.id] };
}

// THE WHOLE OF A CREATE, in a function of its own for the same reason `lifecycleRulesForCreate` is one: the route
// stays a flat sequence of "ask, then answer", and the sequence is where every refusal's ORDER lives.
async function createForRequest(
  ctx: AppCtx,
  cred: (RunCredential & { scope?: string }) | undefined,
  body: CreateCardBody,
): Promise<{ card: Card } | { code: number; error: string }> {
  // SEPARATED at the door: `links` is the person's field, and everything else is the card. A run's copy of it goes
  // no further than `withLoopParent`, which honours it for the loop alone; for every other run the server writes
  // the link itself.
  const { links: asked, ...input } = body;
  // The board is checked before the mutation layer sees it, because everything downstream indexes
  // `config.boards[board]` and an unknown name dereferences undefined — a stack trace and a 500, handed to the
  // caller least able to interpret one. Decision 10 says the board is validated; it was not.
  if (!BOARDS.includes(input.board)) return { code: 400, error: 'Unknown board' };
  // BEFORE THE LIFECYCLE RULES AND FOR EVERY CALLER, because this is the shape of the on-disk format rather
  // than a rule about who may create what: a person at the browser writing a map here would produce exactly
  // the same unreadable card as a run would.
  const mistyped = wrongSatisfiedBy(body);
  if (mistyped) return { code: 400, error: mistyped };
  // A run is held to the lifecycle; a person at the browser is not.
  const ruled = cred?.run
    ? await withLoopParent(ctx, await lifecycleRulesForCreate(ctx, cred, input), cred, asked)
    : { effective: input, links: Array.isArray(asked) ? asked : [] };
  // 409 rather than 400: the request is well formed, and it is the project's lifecycle that makes it wrong.
  if ('error' in ruled) return { code: 409, error: ruled.error };
  const { root, config } = ctx.session as { root: string; config: ProjectConfig };
  const card = await createLinkedCard(
    root,
    config,
    ruled.effective,
    ruled.links,
    today(),
    enforcesOneParent(config, cred?.scope),
  );
  if (card === 'unknown-column') return { code: 400, error: 'Unknown column' };
  // 400 and the same sentence the links route answers with: what is wrong is the shape of the hierarchy, not the
  // lifecycle. Reached by a run only through the loop's named parent, which `withLoopParent` has already confined
  // to the board above.
  if ('problem' in card) return { code: 400, error: card.problem };
  return { card };
}

export async function registerCardRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.post('/cards', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const made = await createForRequest(ctx, req.credential, (req.body ?? {}) as CreateCardBody);
    return 'error' in made ? reply.code(made.code).send({ error: made.error }) : made.card;
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

    if (enforcesOneParent(ctx.session.config, req.credential?.scope)) {
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
