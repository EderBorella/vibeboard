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
      // A STRING OR NOTHING, which is what makes a card carrying junk inert rather than dangerous: the
      // create endpoint writes what an agent sent, and `criterionCommand` compares this against the gates
      // the project declares. A non-string reads as absent and the story is broken down as it always was.
      satisfiedBy: typeof d.satisfiedBy === 'string' ? d.satisfiedBy : undefined,
      // `=== true`, not truthy: `setup: "no"` is a string, and a card whose author meant the opposite
      // must not become the project's barrier.
      setup: d.setup === true ? true : undefined,
      // `=== true` for the same reason as setup: `followUp: "no"` is a string, and a card whose author
      // meant the opposite must not become the one open follow-up.
      followUp: d.followUp === true ? true : undefined,
      createdBy: typeof d.createdBy === 'string' ? d.createdBy : undefined,
      archived: d.archived,
      archivedFrom: d.archivedFrom,
    },
    body: parsed.content.trim(),
  };
}

export function toFrontmatter(card: Card): CardFrontmatter {
  const { id, title, description, order, tags, links, group, created } = card;
  const { satisfiedBy, setup, followUp, createdBy, archived, archivedFrom } = card;
  return {
    id,
    title,
    description,
    order,
    tags,
    links,
    group,
    created,
    satisfiedBy,
    setup,
    followUp,
    createdBy,
    archived,
    archivedFrom,
  };
}

export function serializeCard(fm: CardFrontmatter, body: string): string {
  const data: Record<string, unknown> = { id: fm.id, title: fm.title };
  if (fm.description !== undefined) data.description = fm.description;
  data.order = fm.order;
  data.tags = fm.tags;
  data.links = fm.links;
  if (fm.group !== undefined) data.group = fm.group;
  data.created = fm.created;
  // Only when a card names one, like every other optional key here: a project written before decision 85
  // has no card carrying this, and emitting an empty one would rewrite every file on the board to say
  // nothing.
  if (fm.satisfiedBy !== undefined) data.satisfiedBy = fm.satisfiedBy;
  // Only when true: `setup: false` on every card in the project would be noise on every file. Same for
  // `followUp` — and it is what makes clearing either flag work, since the key simply leaves the file.
  if (fm.setup === true) data.setup = true;
  if (fm.followUp === true) data.followUp = true;
  // Written whenever a run created the card, which is most of them once auto-pilot is driving.
  if (fm.createdBy !== undefined) data.createdBy = fm.createdBy;
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
type CardPatch = Pick<CardFrontmatter, 'title' | 'description' | 'tags' | 'group'> & { body?: string };

// Rejected fields come back rather than being dropped, so the route can refuse instead of answering
// 200 over a card it did not change. An agent that sends `tags: "urgent"` — a plausible mistake, since
// the prose says "tags" and the frontmatter key is a list — was told it succeeded and had no reason to
// retry. The doctrine here is that a 403 is informative and a silent success is not.
interface PickedPatch {
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

// WHO OWNS EACH FIELD A PATCH MAY NOT SET, grouped by the answer. It used to be that an unknown key was
// silently ignored, so `rejected` stayed empty for these and the endpoint answered 200 over a card it had
// not changed — an agent that sent `setup: true` was told it succeeded and had no reason to retry. Refused
// by name instead, which is a real improvement independent of the flags route.
const PATCH_OWNERS: readonly { keys: readonly string[]; owner: string }[] = [
  { keys: ['setup', 'followUp'], owner: 'set by auto-pilot' },
  { keys: ['createdBy'], owner: 'stamped by this endpoint' },
  // WRITTEN WITH THE CARD AND NOT AFTER IT (decision 85). A break-down names the criterion as it writes the
  // story; changing it later would change what a machine may close the card on without changing the card's
  // one acceptance criterion. Refused BY NAME rather than dropped, for the reason the whole table exists:
  // an agent told 200 over a field the endpoint discarded has no reason to try the other spelling.
  { keys: ['satisfiedBy'], owner: 'written when the card is created' },
  // Each has its own path: placement is a drag, links are symmetric and go through the links endpoint
  // that writes the far side, archiving is a scope of its own, and an id is a card's identity.
  { keys: ['id', 'order', 'links', 'archived', 'archivedFrom', 'created'], owner: 'not editable here' },
];

// Derived from the table, so the list and the reason for it cannot drift apart.
export const FORBIDDEN_PATCH_KEYS: readonly string[] = PATCH_OWNERS.flatMap((g) => g.keys);

const andList = (keys: string[]): string =>
  keys.length < 2 ? keys.join('') : `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]}`;

// Only the clauses the caller earned. A refusal that misdescribes itself sends the caller to fix the
// wrong thing, which is why this is not one sentence about every field there is.
export function forbiddenPatchSentence(keys: string[]): string {
  const clauses = PATCH_OWNERS.map(({ keys: group, owner }) => {
    const hit = keys.filter((k) => group.includes(k));
    if (hit.length === 0) return undefined;
    return `${andList(hit)} ${hit.length === 1 ? 'is' : 'are'} ${owner}`;
  }).filter((c): c is string => c !== undefined);
  return `Cannot set ${keys.join(', ')}: ${clauses.join('; ')}.`;
}

export function pickCardPatch(body: unknown): PickedPatch {
  const o = (body ?? {}) as Record<string, unknown>;
  const patch: Partial<CardPatch> = {};
  const rejected: string[] = [];
  // By name and whatever their type, because the complaint is about authority rather than shape.
  for (const key of FORBIDDEN_PATCH_KEYS) {
    if (o[key] !== undefined) rejected.push(key);
  }
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
