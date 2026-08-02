import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { SUGGESTION_STATES, type Suggestion, type SuggestionState } from '../../core/suggestions.js';
import { type AppCtx, ensureOpen, nowIso } from '../route-context.js';
import { isSafeId, listSuggestions, setSuggestionState, writeSuggestion } from '../suggestion-store.js';

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

function isState(value: unknown): value is SuggestionState {
  return typeof value === 'string' && (SUGGESTION_STATES as readonly string[]).includes(value);
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
    const updated = await setSuggestionState(ctx.session.root, id, state, reason?.trim());
    if (!updated) return reply.code(404).send({ error: 'No such suggestion' });
    return { suggestion: updated };
  });
}
