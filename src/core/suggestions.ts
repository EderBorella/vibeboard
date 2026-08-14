import matter from 'gray-matter';
import { asText } from './parse.js';
import { type BoardName, oneOf } from './types.js';

// Agent Suggestions: a durable side-channel for what an agent discovers but must not act on.
//
// The agent does the part its card asks for, files the remainder, and the loop continues. Nothing
// blocks, and nothing is lost — which is why an unreadable state degrades to `active` rather than
// dropping the file. Losing a finding is the one outcome this decision exists to prevent.
//
// Uncapped on purpose. An earlier draft refused a third suggestion per run, which capped the WRITE
// to solve a READ problem. An agent with seventeen findings is telling you its card was scoped
// wrongly, and that is a break-down defect worth seeing rather than noise worth suppressing.

export const SUGGESTION_STATES = ['active', 'actioned', 'dismissed'] as const;
export type SuggestionState = (typeof SUGGESTION_STATES)[number];

export interface Suggestion {
  id: string; // sortable stamp, also the filename
  state: SuggestionState;
  created: string; // ISO
  title: string;
  run?: string; // the run that filed it
  card?: string; // the card it was filed from
  board?: BoardName;
  // Why it was rejected. Two states would have lost this, and "we looked at it and said no" is the
  // part a later checkup needs in order not to re-raise the same thing.
  reason?: string;
  // The card it BECAME when it was carded (decision 49). It cannot reuse `card` above, which already
  // means the card it was filed FROM — one field for both would make "which card is this about"
  // unanswerable.
  became?: string;
  body: string;
}

// The field set as data, so a mirror test can compare the web copy with this one and a round-trip test
// can assert the parser carries every field. An interface has no runtime keys.
export const SUGGESTION_KEYS = [
  'id',
  'state',
  'created',
  'title',
  'run',
  'card',
  'board',
  'reason',
  'became',
  'body',
] as const;

// `never` when every field is listed; otherwise this line fails to compile and names the one missed.
type UnlistedSuggestionField = Exclude<keyof Suggestion, (typeof SUGGESTION_KEYS)[number]>;
const _everySuggestionFieldIsListed: UnlistedSuggestionField extends never ? true : UnlistedSuggestionField =
  true;
void _everySuggestionFieldIsListed;

const isState = oneOf(SUGGESTION_STATES);

// Returns null for anything that is not a suggestion — the folder is ordinary disk, and a stray
// note in it must not become a phantom entry in the checkup's queue.
export function parseSuggestion(content: string): Suggestion | null {
  let parsed: matter.GrayMatterFile<string>;
  try {
    // The options object is not optional, however empty it looks. Called with one argument,
    // gray-matter caches by input string and caches an EMPTY result after a throw, so the second
    // malformed file parses "successfully" as `{}`. See the comment at card.ts:4.
    parsed = matter(content, { language: 'yaml' });
  } catch {
    return null;
  }
  const d = parsed.data as Record<string, unknown>;
  const id = asText(d.id);
  const title = asText(d.title);
  if (!id || !title) return null;

  return {
    id,
    title,
    // An unrecognised state means somebody still has to look at this. Dropping the file, or
    // treating it as handled, would discard a finding on the strength of a typo.
    state: isState(d.state) ? d.state : 'active',
    created: asText(d.created) ?? '',
    ...(asText(d.run) ? { run: asText(d.run) } : {}),
    ...(asText(d.card) ? { card: asText(d.card) } : {}),
    ...(asText(d.board) ? { board: asText(d.board) as BoardName } : {}),
    ...(asText(d.reason) ? { reason: asText(d.reason) } : {}),
    ...(asText(d.became) ? { became: asText(d.became) } : {}),
    body: parsed.content.trim(),
  };
}

export function serializeSuggestion(s: Suggestion): string {
  const { body, ...data } = s;
  return matter.stringify(`${body}\n`, data);
}
