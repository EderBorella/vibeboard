// A card: creating one, editing its frontmatter or its file, where it sits, and the archive it leaves
// to and comes back from.

import type { ArchivedCard, BoardName, Card, CardFrontmatterPatch } from '../shared';
import { patch, post, request } from './http';

interface CreateCardBody {
  board: BoardName;
  columnSlug: string;
  title: string;
  description?: string;
  tags?: string[];
  links?: string[];
  group?: string;
  body?: string;
}

export function createCard(input: CreateCardBody): Promise<Card> {
  return post('/api/cards', input);
}

export function patchCard(board: BoardName, id: string, patchBody: CardFrontmatterPatch): Promise<unknown> {
  return patch(`/api/cards/${board}/${id}`, patchBody);
}

export async function getRaw(board: BoardName, id: string): Promise<string> {
  const res = await request(`/api/cards/${board}/${id}/raw`, {}, { fallback: 'Failed to load card file' });
  return (await res.json()).raw as string;
}

export async function putRaw(board: BoardName, id: string, raw: string): Promise<void> {
  await request(
    `/api/cards/${board}/${id}/raw`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw }) },
    { fallback: 'Failed to save card file' },
  );
}

// Symmetric link reconcile — updates both sides. The single path for link changes.
export async function setLinks(board: BoardName, id: string, links: string[]): Promise<void> {
  await request(
    `/api/cards/${board}/${id}/links`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ links }) },
    { fallback: 'Failed to update links' },
  );
}

// Position a card within a column, or move it into another one, in a single call. `beforeId`
// is the card to insert in front of; null means the end. The server renumbers `order`.
export function placeCard(
  board: BoardName,
  id: string,
  toColumnSlug: string,
  beforeId: string | null,
): Promise<unknown> {
  return post(`/api/cards/${board}/${id}/place`, { toColumnSlug, beforeId });
}

export function archiveCard(board: BoardName, id: string): Promise<unknown> {
  return post(`/api/cards/${board}/${id}/archive`, {});
}

// Fetched on demand: the archive only grows, so it rides outside the snapshot. The snapshot's
// archivedCounts tell the UI when this is worth calling again.
export async function listArchive(board: BoardName): Promise<ArchivedCard[]> {
  const res = await request(`/api/archive/${board}`, {}, { fallback: 'Failed to load the archive' });
  return (await res.json()).cards as ArchivedCard[];
}

// Omit toColumnSlug to land in the column the card was archived from (or the board's first
// column, if that one no longer exists).
export function restoreCard(board: BoardName, id: string, toColumnSlug?: string): Promise<Card> {
  return post<Card>(`/api/cards/${board}/${id}/restore`, toColumnSlug ? { toColumnSlug } : {});
}
