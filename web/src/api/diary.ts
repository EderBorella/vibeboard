// --- The diary ---------------------------------------------------------------------------------------
// Mirrors src/core/diary.ts. An array rather than a bare union so test/mirror.test.ts can assert it: slice
// D shipped six hand-mirrored types with no guard, and one of them gained a member mid-slice.

import type { BoardName } from '../shared';
import { post, request } from './http';

export const DIARY_KINDS = ['run', 'checkup', 'lifecycle', 'note'] as const;
export type DiaryKind = (typeof DIARY_KINDS)[number];

export interface DiaryEntry {
  at: string;
  kind: DiaryKind;
  text: string;
  iteration?: number;
  card?: string;
  board?: BoardName;
  skill?: string;
  outcome?: string;
}

export async function listDiary(): Promise<DiaryEntry[]> {
  const res = await request('/api/log', {}, { fallback: 'Failed to read this project’s log' });
  return (await res.json()).entries as DiaryEntry[];
}

// Everything except `at`, which is the server's — a caller choosing its own timestamps could write an
// event into the past and change what the sequence says happened.
// Through `post`, which sets content-type. Hand-rolled, it sent none and Fastify answered 415 —
// invisible for as long as it lasted because every test of this function mocks the module itself,
// so the request never met a real server.
export async function addDiaryEntry(entry: Omit<DiaryEntry, 'at'>): Promise<DiaryEntry> {
  return (await post<{ entry: DiaryEntry }>('/api/log', entry)).entry;
}
