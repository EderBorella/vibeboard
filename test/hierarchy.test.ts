import { describe, expect, it } from 'vitest';
import { parentBoardOf, secondParentProblem } from '../src/core/hierarchy.js';
import type { BoardName, Card } from '../src/core/types.js';

const card = (id: string, board: BoardName, links: string[] = []): Card => ({
  id,
  title: id,
  order: 10,
  tags: [],
  links,
  created: '2026-08-02',
  board,
  columnSlug: 'backlog',
  body: '',
  filePath: `/tmp/${id}.md`,
});

const all = [
  card('F-001', 'features'),
  card('F-002', 'features'),
  card('P-001', 'product'),
  card('P-002', 'product'),
  card('E-001', 'engineering'),
];

describe('one parent per card', () => {
  it('knows which board is a card’s parent, and that features has none', () => {
    expect(parentBoardOf('engineering')).toBe('product');
    expect(parentBoardOf('product')).toBe('features');
    expect(parentBoardOf('features')).toBeUndefined();
  });

  it('refuses a second parent, naming both', () => {
    expect(secondParentProblem(card('P-003', 'product'), ['F-001', 'F-002'], all)).toBe(
      'P-003 would have two parents on the features board: F-001 and F-002. The hierarchy auto-pilot rolls up is derived from links, so a card has one.',
    );
  });

  it('judges the whole list, not the edge being added', () => {
    // The endpoint receives the complete set, so a replacement can introduce a second parent without
    // adding anything to what was there before.
    const existing = card('E-002', 'engineering', ['P-001']);
    expect(secondParentProblem(existing, ['P-002'], all)).toBeNull();
    expect(secondParentProblem(existing, ['P-001', 'P-002'], all)).not.toBeNull();
  });

  it('allows one parent, siblings, and children', () => {
    expect(secondParentProblem(card('P-003', 'product'), ['F-001', 'E-001'], all)).toBeNull();
    // Two siblings on its own board is not a hierarchy claim at all.
    expect(secondParentProblem(card('P-003', 'product'), ['P-001', 'P-002'], all)).toBeNull();
    // A feature has no parent board, so nothing it links to can be one.
    expect(secondParentProblem(card('F-003', 'features'), ['F-001', 'F-002'], all)).toBeNull();
  });

  // A dangling link is a different problem with its own answer at the endpoint; reporting it here
  // would give one mistake two messages.
  it('is silent about ids that name no card', () => {
    expect(secondParentProblem(card('P-003', 'product'), ['F-404', 'F-405'], all)).toBeNull();
    expect(secondParentProblem(card('P-003', 'product'), ['F-001', 'F-404'], all)).toBeNull();
  });

  it('counts the same parent listed twice as one parent', () => {
    // Refusing it would be a refusal naming one card as both halves of the conflict, which the caller
    // could not act on.
    expect(secondParentProblem(card('P-003', 'product'), ['F-001', 'F-001'], all)).toBeNull();
  });
});
