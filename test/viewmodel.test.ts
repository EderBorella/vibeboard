import { describe, expect, it } from 'vitest';
import type { Card, ProjectConfig } from '../web/src/shared.js';
import { canPlace, cardsByColumn, columnSlugs, miniature, slugify } from '../web/src/viewmodel.js';

const config: ProjectConfig = {
  name: 'T',
  boards: {
    features: { columns: ['Backlog', 'Done'] },
    product: { columns: ['Backlog', 'In Progress', 'Done'] },
    engineering: { columns: ['Todo', 'Done'] },
  },
  miniatureChars: 10,
  idPadding: 3,
  keepChats: 20,
  contextBudget: 200_000,
  copilot: { backend: 'claude-code', backends: {} },
};

function card(partial: Partial<Card>): Card {
  return {
    id: 'E-001',
    title: 'x',
    order: 0,
    tags: [],
    links: [],
    created: '2026-07-23',
    board: 'engineering',
    columnSlug: 'todo',
    body: '',
    filePath: '/x.md',
    ...partial,
  };
}

describe('columnSlugs', () => {
  it('slugifies display names in order, matching core slugify', () => {
    expect(columnSlugs(config, 'product')).toEqual(['backlog', 'in-progress', 'done']);
  });
});

describe('cardsByColumn', () => {
  it('groups cards under every column slug, empty columns included, sorted by order', () => {
    const cards = [
      card({ id: 'E-002', columnSlug: 'todo', order: 20 }),
      card({ id: 'E-001', columnSlug: 'todo', order: 10 }),
    ];
    const grouped = cardsByColumn(cards, ['todo', 'done']);
    expect(Object.keys(grouped)).toEqual(['todo', 'done']);
    expect(grouped.todo.map((c) => c.id)).toEqual(['E-001', 'E-002']);
    expect(grouped.done).toEqual([]);
  });
});

describe('miniature', () => {
  it('prefers description over body', () => {
    expect(miniature(card({ description: 'short', body: 'body text here' }), 50)).toBe('short');
  });

  it('truncates and appends an ellipsis only when longer than the limit', () => {
    expect(miniature(card({ description: 'exactly-ten' }), 20)).toBe('exactly-ten');
    expect(miniature(card({ description: 'this is way too long to fit' }), 10)).toBe('this is w…');
  });

  it('returns empty string when neither description nor body is present', () => {
    expect(miniature(card({ description: undefined, body: '' }), 10)).toBe('');
  });
});

describe('canPlace', () => {
  const card = (over: Partial<Card> = {}): Card => ({ id: 'E-001', board: 'engineering', ...over }) as Card;

  it('refuses a drop with nothing being dragged', () => {
    expect(canPlace(null, 'engineering', null)).toBe(false);
  });

  it('refuses a drop onto a different board', () => {
    // Links cross boards; cards do not.
    expect(canPlace(card(), 'product', null)).toBe(false);
    expect(canPlace(card(), 'engineering', null)).toBe(true);
  });

  it('refuses a drop exactly where the card already sits', () => {
    expect(canPlace(card(), 'engineering', 'E-001')).toBe(false);
    expect(canPlace(card(), 'engineering', 'E-002')).toBe(true);
  });
});

describe('slugify', () => {
  it.each([
    ['  Trim Me  ', 'trim-me'],
    ['In Progress', 'in-progress'],
    ['a  b', 'a-b'],
    ['A--B', 'a-b'],
    ['--edges--', 'edges'],
    ['-', ''],
    ['!!!', ''],
    // Non-ASCII is a separator, not silently dropped.
    ['Ünïcode', 'n-code'],
    ['MiXeD 123', 'mixed-123'],
  ])('slugs %p to %p', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('cardsByColumn', () => {
  const c = (id: string, columnSlug: string, order: number): Card => ({
    id,
    columnSlug,
    order,
    title: id,
    board: 'product',
    tags: [],
    links: [],
    created: '2026-07-25',
    body: '',
    filePath: `/tmp/${id}.md`,
  });

  it('groups into the given columns, sorted by order, ignoring unknown columns', () => {
    const grouped = cardsByColumn(
      [c('a', 'todo', 20), c('b', 'todo', 10), c('c', 'done', 5), c('d', 'nonexistent', 1)],
      ['todo', 'done'],
    );
    expect(Object.keys(grouped)).toEqual(['todo', 'done']);
    expect(grouped.todo.map((x) => x.id)).toEqual(['b', 'a']);
    expect(grouped.done.map((x) => x.id)).toEqual(['c']);
  });

  it('gives every named column an empty array even with no cards at all', () => {
    expect(cardsByColumn([], ['todo', 'done'])).toEqual({ todo: [], done: [] });
  });
});

describe('miniature', () => {
  const c = (over: Partial<Card>): Card => ({
    id: 'P-1',
    title: 't',
    board: 'product',
    columnSlug: 'todo',
    order: 10,
    tags: [],
    links: [],
    created: '2026-07-25',
    body: '',
    filePath: '/tmp/P-1.md',
    ...over,
  });

  it('prefers the description, falls back to the body, then to empty', () => {
    expect(miniature(c({ description: 'desc', body: 'body' }), 50)).toBe('desc');
    expect(miniature(c({ body: 'body' }), 50)).toBe('body');
    expect(miniature(c({}), 50)).toBe('');
  });

  it('trims the source before measuring it', () => {
    expect(miniature(c({ description: '   padded   ' }), 50)).toBe('padded');
  });

  it('returns a source of exactly the limit untouched, and truncates one longer', () => {
    expect(miniature(c({ description: 'abcde' }), 5)).toBe('abcde');
    expect(miniature(c({ description: 'abcdef' }), 5)).toBe('abcd…');
  });
});
