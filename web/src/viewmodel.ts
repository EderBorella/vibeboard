import type { BoardName, Card, ProjectConfig } from './shared';

// Mirrors src/core/slug.ts — column folders on disk are slugified display names.
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Whether a drop should actually move the card. Two things are not moves: a card dropped on a
// different board (links cross boards, cards do not), and a card dropped exactly where it sits.
export function canPlace(card: Card | null, board: BoardName, beforeId: string | null): card is Card {
  if (!card || card.board !== board) return false;
  return beforeId !== card.id;
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

// The configured display name for a column slug — 'in-progress' back to 'In Progress'. Falls back
// to the slug itself when the column has been renamed out from under the card, which is a real
// state: the file keeps sitting in the old folder until something moves it.
export function columnLabel(config: ProjectConfig, board: BoardName, slug: string): string {
  return config.boards[board].columns.find((name) => slugify(name) === slug) ?? slug;
}

// Where a card sits, for the read-only view. An archived card's own column IS the archive folder,
// so the informative place is the column it was archived from — itself possibly renamed away.
export function cardPlace(config: ProjectConfig, card: Card): string {
  if (!card.archived) return columnLabel(config, card.board, card.columnSlug);
  return card.archivedFrom
    ? `Archived · from ${columnLabel(config, card.board, card.archivedFrom)}`
    : 'Archived';
}

// The cards a link list names, in the order the links are written. Ids that no longer resolve are
// dropped rather than rendered as ghosts: the other side may have been deleted outside the app.
export function linkedCards(all: Card[], ids: readonly string[]): Card[] {
  return ids.map((id) => all.find((c) => c.id === id)).filter((c): c is Card => c !== undefined);
}

// A list of values as one comma-separated line, and back. Blank entries are dropped, so a trailing
// comma while typing does not become an empty tag. Duplicates are left alone: tagCounts is what
// decides a card counts once per tag.
export function csv(values: string[]): string {
  return values.join(', ');
}

export function parseCsv(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface TagCount {
  tag: string;
  count: number;
}

// Every tag in use across the given cards, with how many cards carry it. A card counts once per
// tag however many times it repeats it — nothing stops `tags: bug, bug` reaching a file, and the
// number in the filter bar is a card count.
// Ordered by count descending, then alphabetically, so the bar does not reshuffle on every
// snapshot push.
export function tagCounts(cards: Card[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const c of cards) {
    for (const tag of new Set(c.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// Cards carrying EVERY active tag. Clicking a second tag therefore narrows the board rather than
// widening it, and an empty filter passes everything (`[].every` is true).
export function filterByTags(cards: Card[], active: readonly string[]): Card[] {
  return cards.filter((c) => active.every((tag) => c.tags.includes(tag)));
}

// The active tags that still exist on the board. A tag edited off the last card carrying it loses
// its chip, so leaving it active would filter cards away with no control left to undo it.
export function presentTags(active: readonly string[], present: TagCount[]): string[] {
  const names = new Set(present.map((p) => p.tag));
  return active.filter((t) => names.has(t));
}

// Add or remove one tag from the active filter, leaving the order of the rest alone.
export function toggleTag(active: readonly string[], tag: string): string[] {
  return active.includes(tag) ? active.filter((t) => t !== tag) : [...active, tag];
}

// One-line summary for a card tile: description if set, else the body, trimmed to `chars`.
export function miniature(card: Card, chars: number): string {
  const source = (card.description ?? card.body ?? '').trim();
  if (source.length <= chars) return source;
  return `${source.slice(0, chars - 1)}…`;
}
