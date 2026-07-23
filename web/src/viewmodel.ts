import type { BoardName, Card, ProjectConfig } from './shared';

// Mirrors src/core/slug.ts — column folders on disk are slugified display names.
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function columnSlugs(config: ProjectConfig, board: BoardName): string[] {
  return config.boards[board].columns.map(slugify);
}

// Group cards under each column slug (empty columns preserved), sorted by manual order.
export function cardsByColumn(cards: Card[], slugs: string[]): Record<string, Card[]> {
  const grouped: Record<string, Card[]> = {};
  for (const slug of slugs) grouped[slug] = [];
  for (const c of cards) {
    if (grouped[c.columnSlug]) grouped[c.columnSlug].push(c);
  }
  for (const slug of slugs) grouped[slug].sort((a, b) => a.order - b.order);
  return grouped;
}

// One-line summary for a card tile: description if set, else the body, trimmed to `chars`.
export function miniature(card: Card, chars: number): string {
  const source = (card.description ?? card.body ?? '').trim();
  if (source.length <= chars) return source;
  return `${source.slice(0, chars - 1)}…`;
}
