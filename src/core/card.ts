import matter from 'gray-matter';
import type { Card, CardFrontmatter } from './types.js';

// Returns null for frontmatter that will not parse. A card file is hand-editable, so one bad
// quote is one card missing from its column — not a dead board. parseRun has taken this
// position since it was written; cards never did, and readBoard threw all the way to the UI.
export function parseCardContent(content: string): { data: CardFrontmatter; body: string } | null {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
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
      archived: d.archived,
      archivedFrom: d.archivedFrom,
    },
    body: parsed.content.trim(),
  };
}

export function toFrontmatter(card: Card): CardFrontmatter {
  const { id, title, description, order, tags, links, group, created, archived, archivedFrom } = card;
  return { id, title, description, order, tags, links, group, created, archived, archivedFrom };
}

export function serializeCard(fm: CardFrontmatter, body: string): string {
  const data: Record<string, unknown> = { id: fm.id, title: fm.title };
  if (fm.description !== undefined) data.description = fm.description;
  data.order = fm.order;
  data.tags = fm.tags;
  data.links = fm.links;
  if (fm.group !== undefined) data.group = fm.group;
  data.created = fm.created;
  // Emitted only while archived, so a live card's file is unchanged by this feature.
  if (fm.archived !== undefined) data.archived = fm.archived;
  if (fm.archivedFrom !== undefined) data.archivedFrom = fm.archivedFrom;
  return matter.stringify(`${body}\n`, data);
}
