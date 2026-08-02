import { describe, expect, it } from 'vitest';
import {
  farSideParentProblem,
  oneParentProblem,
  parentBoardOf,
  secondParentProblem,
} from '../src/core/hierarchy.js';
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

// Links are symmetric: writing one card's list writes the back-reference onto every target. So the
// rule has to hold on the FAR side too — checking only the card being edited made it advisory for
// exactly the callers it was written to constrain.
describe('the parent side', () => {
  const withParent = [...all, card('E-001', 'engineering', ['P-001'])];

  it('refuses adopting a child that already has a parent', () => {
    // P-002 gains no parent of its own here, so the child-side check passes it.
    expect(secondParentProblem(card('P-002', 'product'), ['E-001'], withParent)).toBeNull();
    expect(farSideParentProblem(card('P-002', 'product'), ['E-001'], withParent)).toBe(
      'E-001 already has a parent on the product board (P-001), so linking it to P-002 would give it two. The hierarchy auto-pilot rolls up is derived from links, so a card has one.',
    );
  });

  it('closes the features→product direction, where the child-side check returns early', () => {
    // parentBoardOf('features') is undefined, so secondParentProblem never looks at anything.
    const withFeatureParent = [...all, card('P-003', 'product', ['F-001'])];
    expect(secondParentProblem(card('F-002', 'features'), ['P-003'], withFeatureParent)).toBeNull();
    expect(farSideParentProblem(card('F-002', 'features'), ['P-003'], withFeatureParent)).toContain(
      'P-003 already has a parent on the features board (F-001)',
    );
  });

  it('allows re-linking a child this card already owns, so an idempotent write is not refused', () => {
    expect(farSideParentProblem(card('P-001', 'product'), ['E-001'], withParent)).toBeNull();
  });

  it('says nothing about targets on boards this card is not the parent of', () => {
    // A sibling link and a link UP to its own parent are neither of them adoptions.
    expect(farSideParentProblem(card('P-002', 'product'), ['P-001', 'F-001'], withParent)).toBeNull();
  });

  it('is silent about a target that does not exist', () => {
    expect(farSideParentProblem(card('P-002', 'product'), ['E-404'], withParent)).toBeNull();
  });

  it('oneParentProblem catches either side', () => {
    expect(oneParentProblem(card('P-003', 'product'), ['F-001', 'F-002'], all)).toContain('two parents');
    expect(oneParentProblem(card('P-002', 'product'), ['E-001'], withParent)).toContain(
      'already has a parent',
    );
    expect(oneParentProblem(card('P-002', 'product'), ['F-001'], withParent)).toBeNull();
  });
});
