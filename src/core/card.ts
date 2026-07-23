import matter from 'gray-matter';
import type { Card, CardFrontmatter } from './types.js';

export function parseCardContent(content: string): { data: CardFrontmatter; body: string } {
  const parsed = matter(content);
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
    },
    body: parsed.content.trim(),
  };
}

export function toFrontmatter(card: Card): CardFrontmatter {
  const { id, title, description, order, tags, links, group, created } = card;
  return { id, title, description, order, tags, links, group, created };
}

export function serializeCard(fm: CardFrontmatter, body: string): string {
  const data: Record<string, unknown> = { id: fm.id, title: fm.title };
  if (fm.description !== undefined) data.description = fm.description;
  data.order = fm.order;
  data.tags = fm.tags;
  data.links = fm.links;
  if (fm.group !== undefined) data.group = fm.group;
  data.created = fm.created;
  return matter.stringify(`${body}\n`, data);
}
