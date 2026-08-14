import type { FastifyInstance } from 'fastify';
import { boundText, DIARY_KINDS, type DiaryEntry } from '../../core/diary.js';
import { asText } from '../../core/parse.js';
import { isBoard, oneOf } from '../../core/types.js';
import { appendEntry, readDiary } from '../diary-store.js';
import { type AppCtx, ensureOpen, nowIso } from '../route-context.js';

// The diary over HTTP, and the only way in.
//
// `POST` is the `service` scope alone. Both working scopes are absent from the table deliberately: a run
// already reports a one-line summary that auto-pilot appends after the dispatch, so an agent writing here
// would be a second path to the same fact — and the AppArmor profile denies the file itself, so this
// endpoint is what exists instead.
//
// `GET` is in no scope at all, admin-only by absence, like triaging a suggestion. Nothing an agent does
// needs the project's narrative, and an agent reading how the last ten runs went is an agent reasoning
// about the loop that is running it.
//
// There is no `PATCH` and no `DELETE`, and that absence is the whole enforcement of append-only.

const isKind = oneOf(DIARY_KINDS);

// A whole number of dispatches, or nothing. `Number('three')` is NaN, which would reach the format as
// `iteration NaN` and read back as an event nobody can place in the sequence.
function asIteration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

// Everything about the entry that is optional. Extracted from the handler rather than spread inline: five
// conditional fields there took it past the complexity ceiling, and the decision each one makes is the
// same, so stating it once in a table reads better than five spreads anyway.
//
// A field survives only if it is the shape it claims to be, and is DROPPED rather than rejected: an entry
// is worth keeping when one of its details arrived malformed, and losing the narrative line to salvage a
// detail would be the wrong way round.
function details(body: Record<string, unknown>): Partial<DiaryEntry> {
  const out: Partial<DiaryEntry> = {};
  const iteration = asIteration(body.iteration);
  if (iteration !== undefined) out.iteration = iteration;
  const card = asText(body.card);
  if (card) out.card = card;
  if (isBoard(body.board)) out.board = body.board;
  const skill = asText(body.skill);
  if (skill) out.skill = skill;
  const outcome = asText(body.outcome);
  if (outcome) out.outcome = outcome;
  return out;
}

export async function registerDiaryRoutes(api: FastifyInstance, ctx: AppCtx): Promise<void> {
  api.post('/log', async (req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    const body = (req.body ?? {}) as Record<string, unknown>;

    // `typeof` throughout rather than `?.trim()`: this is agent-reachable input on a run credential, and
    // `{"text": 123}` must be a 400 rather than a TypeError inside a 500. Same finding as POST /suggestions.
    const text = asText(body.text);
    if (!text) return reply.code(400).send({ error: 'A diary entry needs something to say' });
    if (!isKind(body.kind)) {
      return reply.code(400).send({ error: `kind must be one of ${DIARY_KINDS.join(', ')}` });
    }

    const entry: DiaryEntry = {
      // The SERVER's clock, never the payload's. A caller choosing its own timestamps could write an event
      // into the past and change what the sequence says happened — and the sequence is what the checkup
      // reads to decide whether the project is circling.
      at: nowIso(),
      kind: body.kind,
      // Bounded HERE, where the entry that is written, returned and broadcast is built — one object, so
      // the three cannot disagree. Bounding inside the serializer would put the short line on disk and
      // the long one in the reply.
      text: boundText(text),
      ...details(body),
    };
    await appendEntry(ctx.session.root, entry);
    // AFTER the write, never before. `PROJECT-LOG.md` is in `isIgnored`, so a chatty diary cannot churn the
    // board — which also means there is no snapshot rebuild for this to ride on the way filing a suggestion
    // does, and without a push of its own a second tab shows a stale narrative until it is reloaded. Before
    // the write, a failed append would announce an entry that is not on disk.
    ctx.broadcast({ type: 'diary:entry', entry });
    return { entry };
  });

  api.get('/log', async (_req, reply) => {
    if (!ensureOpen(ctx.session, reply)) return;
    // Oldest first, as written. The UI reverses it for display; a reader of the file wants it forwards.
    return { entries: await readDiary(ctx.session.root) };
  });
}
