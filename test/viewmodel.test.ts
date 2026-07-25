import { describe, it, expect } from 'vitest';
import { columnSlugs, cardsByColumn, miniature } from '../web/src/viewmodel.js';
import type { Card, ProjectConfig } from '../web/src/shared.js';

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
  copilot: { backend: 'claude-code' },
};

function card(partial: Partial<Card>): Card {
  return {
    id: 'E-001', title: 'x', order: 0, tags: [], links: [], created: '2026-07-23',
    board: 'engineering', columnSlug: 'todo', body: '', filePath: '/x.md', ...partial,
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
