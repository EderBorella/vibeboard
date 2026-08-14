import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { readBoard } from '../../core/board.js';
import { entryColumn } from '../../core/entry-column.js';
import { setCardLinks } from '../../core/links.js';
import { createCard, updateCard } from '../../core/mutations.js';
import { followUpCount, openFollowUp } from '../../core/setup-feature.js';
import { SUGGESTION_STATES, type Suggestion } from '../../core/suggestions.js';
import { type BoardName, type Card, oneOf, type ProjectConfig } from '../../core/types.js';
import { type AppCtx, ensureOpen, nowIso, today } from '../route-context.js';
import {
  isSafeId,
  listSuggestions,
  readSuggestion,
  setSuggestionState,
  writeSuggestion,
} from '../suggestion-store.js';

// Agent Suggestions over HTTP.
//
// Filing is uncapped, deliberately: capping the write to solve a read problem discards findings
// silently, which is the opposite of what this channel is for.
//
// No websocket broadcast on write. The board already refreshes from the watcher — the suggestions
// folder is not in `isIgnored`, so filing one rebuilds the snapshot and the badge with it — and a
// second channel nothing listened on just fired the same refresh twice.
//
// A `work` agent may file and may NOT read the list. Reading every open problem in the project is
// how a run scoped to one card talks itself into fixing five, which is the scope spiral the design
// exists to prevent. The checkup reads them; a work agent only adds.

const isState = oneOf(SUGGESTION_STATES);

// THE TWO LEVELS A SUGGESTION MAY BECOME, and a task is deliberately not one of them (decision 49). It
// looked like the most useful and it is the one that cannot work: a task needs a story to belong to, so
// carding one either makes the user hunt for a parent or creates an orphan the machine never walks to.
const LEVELS = ['feature', 'story'] as const;
type Level = (typeof LEVELS)[number];
const isLevel = oneOf(LEVELS);

function levelProblem(value: unknown): string | undefined {
  if (value === 'task') {
    return 'A suggestion cannot become a task: a task needs a story to belong to, and one carded on its own is work no phase picks up. Card it as a story — a suggestion small enough to be a single task is a story with one criterion, and break-down produces that task from it.';
  }
  if (!isLevel(value)) return `level must be one of ${LEVELS.join(', ')}`;
  return undefined;
}

// A refusal naming the board, for the one thing this endpoint cannot work around: a board whose first
// column is terminal or blocked has nowhere for a new card to enter, and creating one there would stand
// it as a live card in the column `complete` reads as positive evidence.
function noEntry(board: BoardName): string {
  return `A card cannot be created on ${board}: a new card enters a board at its first column, and that board's first column is one nothing can continue from. Reorder that board's columns in Settings.`;
}

// Everything refusable about the REQUEST, answered before anything is created and in the order that
// keeps each refusal cheap.
async function mayBeCarded(
  root: string,
  id: string,
  level: unknown,
): Promise<{ code: number; error: string } | { suggestion: Suggestion }> {
  // Before the store is touched at all: Fastify decodes `%2f`, so an unchecked id here read a file
  // outside the folder.
  if (!isSafeId(id)) return { code: 400, error: 'Bad suggestion id' };
  const badLevel = levelProblem(level);
  if (badLevel) return { code: 400, error: badLevel };
  const suggestion = await readSuggestion(root, id);
  if (!suggestion) return { code: 404, error: 'No such suggestion' };
  // 409 rather than 400: the request is well formed, and it is the suggestion's state that makes it
  // wrong. A second card for one finding is two records of the same work.
  if (suggestion.state !== 'active') {
    return {
      code: 409,
      error: `That suggestion is already ${suggestion.state}${suggestion.became ? `, as ${suggestion.became}` : ''}.`,
    };
  }
  return { suggestion };
}

// HOW TO TAKE BACK A WRITE THAT ALREADY HAPPENED. Every reason to REFUSE is considered before the first
// create (see `cardFrom`), and no check can see a write that THROWS — so each write records how to undo
// itself and a failure runs the ledger in reverse before answering. Without it, one unwritable folder left
// a flagged follow-up standing on the board with no story under it, which decision 50 forbids and which the
// next tick picks up as a feature to break down: a model spent on boilerplate nobody asked for.
type Undo = () => Promise<void>;

// Reverse order, and a failing step is swallowed: a compensation that threw would replace the original
// failure's sentence with its own, and it has nothing to add — the disk that refused the write is the disk
// refusing to unwind it.
async function undoAll(steps: Undo[]): Promise<void> {
  for (const step of steps.reverse()) {
    try {
      await step();
    } catch {
      // Nothing to say here that the sentence below does not already say.
    }
  }
}

// NO HOST PATH AND NO STACK. An unhandled throw here answered a raw 500 whose body was
// `EACCES: permission denied, open '<the server's own filesystem>'` — nothing the reader can act on, and
// the project's paths handed to the browser. It also has to say the finding survived, because that is the
// one thing this whole channel exists to guarantee.
const PARTIAL_WRITE =
  'Carding that suggestion failed part way through. Everything it had created has been removed and the suggestion is still open, so nothing was lost — check the project folder is writable and try again.';

// ONE ENDPOINT, NOT THREE CALLS (decision 50), and this is the half that writes: find the open follow-up
// or make one, create the story under it, link both sides.
//
// EVERY REASON TO REFUSE IS CONSIDERED BEFORE ANYTHING IS WRITTEN — both entry columns for a story, not
// just the story's. The follow-up is the create that comes first, so a refusal discovered afterwards
// would leave a feature nobody asked for standing on the board: the between-two-calls failure this
// endpoint exists to prevent, reintroduced inside it.
async function cardFrom(
  root: string,
  config: ProjectConfig,
  level: Level,
  suggestion: Suggestion,
  // Appended to, never read here: what to undo is known where the write happens, and running it is the
  // caller's job because the last write of all — retiring the suggestion — is outside this function.
  undo: Undo[],
): Promise<{ card: Card } | { error: string }> {
  const made = { title: suggestion.title, body: suggestion.body };
  if (level === 'feature') {
    const entry = entryColumn(config, 'features');
    if (entry === undefined) return { error: noEntry('features') };
    const card = await createCard(root, config, { ...made, board: 'features', columnSlug: entry }, today());
    // Features are the top level, so there is no parent to link and no dialog to ask about one.
    if (card === 'unknown-column') return { error: noEntry('features') };
    undo.push(() => rm(card.filePath, { force: true }));
    return { card };
  }

  const storyEntry = entryColumn(config, 'product');
  if (storyEntry === undefined) return { error: noEntry('product') };
  const features = await readBoard(root, 'features', config);
  const terminal = config.autopilot?.terminal ?? ({} as Record<BoardName, string[]>);
  let follow = openFollowUp(features, terminal);
  if (!follow) {
    const featureEntry = entryColumn(config, 'features');
    if (featureEntry === undefined) return { error: noEntry('features') };
    const wave = followUpCount(features) + 1;
    const created = await createCard(
      root,
      config,
      {
        board: 'features',
        columnSlug: featureEntry,
        title: `Follow-up ${wave}`,
        body: 'Work that arrived after the first pass. Stories carded out of suggestions hang off this feature until its checkup closes it.',
      },
      today(),
    );
    if (created === 'unknown-column') return { error: noEntry('features') };
    // Recorded BEFORE the flag is written, because that write can fail too: an unflagged follow-up is one
    // `openFollowUp` cannot see, so the next attempt would make a second.
    undo.push(() => rm(created.filePath, { force: true }));
    // The flag is what makes "the open follow-up" a fact rather than a guess from a title.
    follow = await updateCard(root, created, { followUp: true });
  }

  // `setCardLinks` writes BOTH sides, so taking the story back means putting the parent's list back with
  // it — otherwise the follow-up keeps a link to a file that is gone.
  const parent = follow;
  const parentLinks = parent.links;
  undo.push(async () => {
    await updateCard(root, parent, { links: parentLinks });
  });

  const story = await createCard(
    root,
    config,
    { ...made, board: 'product', columnSlug: storyEntry },
    today(),
  );
  if (story === 'unknown-column') return { error: noEntry('product') };
  undo.push(() => rm(story.filePath, { force: true }));
  // SYMMETRIC, through the one writer that does both sides: the hierarchy is derived from the PARENT's
  // links, so a story that merely names its feature is a story the machine never walks to.
  return { card: await setCardLinks(root, config, story, [follow.id]) };
}

// ALL OF IT OR NONE, which is what makes this one endpoint rather than three calls (decision 50). Two of the
// ways it can fail are invisible to every check above: a write that throws, and a suggestion that cannot be
// re-read after it was retired.
async function cardAndRetire(
  root: string,
  config: ProjectConfig,
  level: Level,
  // The id from the URL, not the one in the record: they are the same in every file this server writes, but
  // a hand-edited one where they disagree is read by filename and must be written back the same way.
  id: string,
  suggestion: Suggestion,
): Promise<{ card: Card; suggestion: Suggestion } | { code: number; error: string }> {
  const undo: Undo[] = [];
  try {
    const made = await cardFrom(root, config, level, suggestion, undo);
    if ('error' in made) {
      // A refusal cannot currently arrive after a create — both entry columns are answered first — but
      // "all of it or none" must not depend on that staying true.
      await undoAll(undo);
      return { code: 409, error: made.error };
    }
    const updated = await setSuggestionState(root, id, 'actioned', { became: made.card.id });
    // `null` IS a partial failure, and it used to answer 200 with `suggestion: null`: the card exists, the
    // suggestion is still `active` — so one finding could be carded twice — and the browser reads `.id` off
    // it and throws a TypeError dressed as the server's refusal. Thrown rather than returned so there is one
    // compensation path for every way this can end badly.
    if (!updated) throw new Error('the suggestion could not be re-read after it was retired');
    return { card: made.card, suggestion: updated };
  } catch {
    // The error itself is deliberately not read. It is an ENOENT or an EACCES naming a path on the server,
    // and the sentence a person needs does not vary by which write it was.
    //
    // This is also the answer for the losers of a concurrent carding: three at once currently answer
    // [200, 500, 500], because the one-open-follow-up invariant fails closed on the id allocator's `wx`
    // flag — the two that lose that race created nothing, so their ledgers are empty and the sentence is
    // the whole of what they owe.
    await undoAll(undo);
    return { code: 500, error: PARTIAL_WRITE };
  }
}

export async function registerSuggestionRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.post('/suggestions', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const body = (req.body ?? {}) as { title?: unknown; body?: unknown };
    // `typeof`, not `?.trim()`: this is agent-reachable input on a `work` credential, and
    // `{"title": 123}` threw a TypeError before the 400 below could answer it.
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    // A suggestion with no title is a finding nobody can triage from a list, which is the only way
    // anyone will ever see it.
    if (!title) return reply.code(400).send({ error: 'A suggestion needs a title' });

    const cred = req.credential;
    const suggestion: Suggestion = {
      // randomUUID, not Math.random().toString(36).slice(2, 6) — that is 0 to 4 characters, '' for
      // 0, so two same-millisecond posts overwrote each other. Silently destroying a finding is the
      // one outcome this channel exists to prevent.
      id: `${nowIso().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
      state: 'active',
      created: nowIso(),
      title,
      // From the CREDENTIAL, never the payload. A run naming a different card is a run rewriting
      // whose problem this is; the credential is the only account of who is calling that the
      // caller cannot edit.
      ...(cred?.run ? { run: cred.run } : {}),
      ...(cred?.card ? { card: cred.card } : {}),
      // No `board` from the payload. A Credential carries none, so it could only have come from the
      // caller — which made the comment above ("from the CREDENTIAL, never the payload") false for
      // one field in three. Nothing reads it yet, and the checkup can derive it from the card id.
      body: typeof body.body === 'string' ? body.body.trim() : '',
    };
    await writeSuggestion(ctx.session.root, suggestion);
    return { id: suggestion.id };
  });

  api.get('/suggestions', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { state } = req.query as { state?: string };
    // An unrecognised state returns everything rather than nothing: a filter typo that silently
    // answers "no open suggestions" is how the checkup concludes a project is clean.
    return { suggestions: await listSuggestions(ctx.session.root, isState(state) ? state : undefined) };
  });

  // Triage is the human's, and the checkup's in slice C — never a work agent's. Absent from the
  // scope table, so it is admin-only without anyone having to remember to deny it.
  api.patch('/suggestions/:id', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { id } = req.params as { id: string };
    // Fastify decodes `%2f`, so an unchecked id here read a file outside the folder and returned
    // its contents in the response body.
    if (!isSafeId(id)) return reply.code(400).send({ error: 'Bad suggestion id' });
    const { state, reason } = (req.body ?? {}) as { state?: string; reason?: string };
    if (!isState(state))
      return reply.code(400).send({ error: `state must be one of ${SUGGESTION_STATES.join(', ')}` });
    const updated = await setSuggestionState(ctx.session.root, id, state, { reason: reason?.trim() });
    if (!updated) return reply.code(404).send({ error: 'No such suggestion' });
    return { suggestion: updated };
  });

  // MAKE A CARD OUT OF A FINDING. Admin only by absence from the scope table, like triage above: nothing
  // is ever dispatched from a suggestion, and deciding that one is real work is a person's call.
  //
  // The suggestion is retired LAST, after the card exists. Marking it first and then failing would lose
  // the finding — which is the one outcome this whole channel exists to prevent.
  api.post('/suggestions/:id/card', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const { root, config } = ctx.session;
    const { id } = req.params as { id: string };
    const { level } = (req.body ?? {}) as { level?: unknown };
    const ready = await mayBeCarded(root, id, level);
    if ('error' in ready) return reply.code(ready.code).send({ error: ready.error });
    const done = await cardAndRetire(root, config, level as Level, id, ready.suggestion);
    if ('error' in done) return reply.code(done.code).send({ error: done.error });
    return { card: done.card, suggestion: done.suggestion };
  });
}
