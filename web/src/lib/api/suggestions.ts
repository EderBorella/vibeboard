// --- What agents filed -------------------------------------------------------------------------------
// The rules were already right and nothing rendered them (decision 48): the endpoints existed, and a
// finding nobody can reach is lost in every sense that matters.

import type { Card, Suggestion, SuggestionLevel, SuggestionState } from '../shared';
import { patch, post, request } from './http';

export async function listSuggestions(state?: SuggestionState): Promise<Suggestion[]> {
  const query = state ? `?state=${state}` : '';
  const res = await request(`/api/suggestions${query}`, {}, { fallback: 'Failed to read what agents filed' });
  return (await res.json()).suggestions as Suggestion[];
}

// Triage: `active` → `actioned` or `dismissed`, and back. The reason belongs to a dismissal — it is what
// stops a later checkup re-raising the same thing — and the server keeps it for that state alone.
export async function patchSuggestion(
  id: string,
  state: SuggestionState,
  reason?: string,
): Promise<Suggestion> {
  const body = reason === undefined ? { state } : { state, reason };
  return (await patch<{ suggestion: Suggestion }>(`/api/suggestions/${id}`, body)).suggestion;
}

// ONE call, because the server holds the invariant: it finds the open follow-up feature or makes one,
// creates the story under it and retires the suggestion, all of it or none. Three calls from here could
// fail between any two and leave an orphan story on the product board.
export async function cardSuggestion(
  id: string,
  level: SuggestionLevel,
): Promise<{ card: Card; suggestion: Suggestion }> {
  return post<{ card: Card; suggestion: Suggestion }>(`/api/suggestions/${id}/card`, { level });
}
