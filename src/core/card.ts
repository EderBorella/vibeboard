import matter from 'gray-matter';
import type { Card, CardFrontmatter } from './types.js';

// Returns null for frontmatter that will not parse. A card file is hand-editable, so one bad
// quote is one card missing from its column — not a dead board. parseRun has taken this
// position since it was written; cards never did, and readBoard threw all the way to the UI.
export function parseCardContent(content: string): { data: CardFrontmatter; body: string } | null {
  let parsed: matter.GrayMatterFile<string>;
  try {
    // The options object is not optional, however empty it looks: called with one argument
    // gray-matter caches by input string, and after a throw it caches an EMPTY result — so the
    // second card with the same broken content parses "successfully" as `{}` and becomes a card
    // with no id at all. Passing options bypasses the cache. Verified both ways.
    parsed = matter(content, { language: 'yaml' });
  } catch {
    return null;
  }
  const d = parsed.data as Partial<CardFrontmatter>;
  return {
    data: {
      id: d.id ?? '',
      title: d.title ?? '',
      description: d.description,
      order: typeof d.order === 'number' ? d.order : 0,
      tags: Array.isArray(d.tags) ? d.tags : [],
      links: Array.isArray(d.links) ? d.links : [],
      group: d.group,
      created: d.created ?? '',
      // `=== true`, not truthy: `setup: "no"` is a string, and a card whose author meant the opposite
      // must not become the project's barrier.
      setup: d.setup === true ? true : undefined,
      archived: d.archived,
      archivedFrom: d.archivedFrom,
    },
    body: parsed.content.trim(),
  };
}

export function toFrontmatter(card: Card): CardFrontmatter {
  const { id, title, description, order, tags, links, group, created, setup, archived, archivedFrom } = card;
  return { id, title, description, order, tags, links, group, created, setup, archived, archivedFrom };
}

export function serializeCard(fm: CardFrontmatter, body: string): string {
  const data: Record<string, unknown> = { id: fm.id, title: fm.title };
  if (fm.description !== undefined) data.description = fm.description;
  data.order = fm.order;
  data.tags = fm.tags;
  data.links = fm.links;
  if (fm.group !== undefined) data.group = fm.group;
  data.created = fm.created;
  // Only when true: `setup: false` on every card in the project would be noise on every file.
  if (fm.setup === true) data.setup = true;
  // Emitted only while archived, so a live card's file is unchanged by this feature.
  if (fm.archived !== undefined) data.archived = fm.archived;
  if (fm.archivedFrom !== undefined) data.archivedFrom = fm.archivedFrom;
  return matter.stringify(`${body}\n`, data);
}

// The only fields a PATCH may set. `updateCard` spreads whatever it is handed — which is right for
// the internal callers that set `order` during a placement — so the filtering belongs where
// untrusted input arrives.
//
// What is deliberately NOT here, and why each one matters:
//   id           a card's id is its identity; the board, its links and its run records are keyed on it
//   order        placement is a drag, decided by a person looking at the board (/place)
//   archived     archiving is a scope of its own; setting the key by hand strands the card
//   links        symmetric, so they go through the links endpoint that writes the far side too
//   setup        the project-level barrier — a work agent able to flag its own card would make its
//                own subtree the only eligible work in the project
export type CardPatch = Pick<CardFrontmatter, 'title' | 'description' | 'tags' | 'group'> & { body?: string };

// Rejected fields come back rather than being dropped, so the route can refuse instead of answering
// 200 over a card it did not change. An agent that sends `tags: "urgent"` — a plausible mistake, since
// the prose says "tags" and the frontmatter key is a list — was told it succeeded and had no reason to
// retry. The doctrine here is that a 403 is informative and a silent success is not.
export interface PickedPatch {
  patch: Partial<CardPatch>;
  rejected: string[];
}

// `String(t)` used to coerce, which is the wrong tool: `tags: [1, {x:2}, null]` became
// `["1", "[object Object]", "null"]` and those went into the card's frontmatter and onto the board.
// Non-strings are dropped and reported.
function pickTags(value: unknown, rejected: string[]): string[] | undefined {
  if (!Array.isArray(value)) {
    rejected.push('tags');
    return undefined;
  }
  const strings = value.filter((t): t is string => typeof t === 'string');
  if (strings.length !== value.length) rejected.push('tags');
  return strings;
}

export function pickCardPatch(body: unknown): PickedPatch {
  const o = (body ?? {}) as Record<string, unknown>;
  const patch: Partial<CardPatch> = {};
  const rejected: string[] = [];
  for (const key of ['title', 'description', 'group', 'body'] as const) {
    if (o[key] === undefined) continue;
    if (typeof o[key] === 'string') patch[key] = o[key] as string;
    else rejected.push(key);
  }
  if (o.tags !== undefined) {
    const tags = pickTags(o.tags, rejected);
    if (tags) patch.tags = tags;
  }
  return { patch, rejected };
}
