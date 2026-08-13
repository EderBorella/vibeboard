import { describe, expect, it } from 'vitest';
import { derivePosition, type Position, type PositionResult } from '../src/core/position.js';
import type { BoardName, Card } from '../src/core/types.js';

// A fixture too thin to distinguish two outcomes tests neither, so every helper takes an order and a
// link list: the backlog queue is ranked by (order, then id) and the hierarchy is read off links.
function card(board: BoardName, id: string, columnSlug: string, over: Partial<Card> = {}): Card {
  return {
    id,
    title: id,
    order: 10,
    tags: [],
    links: [],
    created: '2026-08-13',
    board,
    columnSlug,
    body: '',
    filePath: `/tmp/${id}.md`,
    ...over,
  };
}

const f = (id: string, columnSlug: string, over: Partial<Card> = {}): Card =>
  card('features', id, columnSlug, over);
const p = (id: string, columnSlug: string, over: Partial<Card> = {}): Card =>
  card('product', id, columnSlug, over);
const t = (id: string, columnSlug: string, over: Partial<Card> = {}): Card =>
  card('engineering', id, columnSlug, over);

// Narrows to the position, so a fixture that refused says which test is wrong rather than throwing a
// property access at the reader.
function only(result: PositionResult): Position {
  if (!('position' in result)) throw new Error(`expected a position, got ${JSON.stringify(result)}`);
  return result.position;
}

function problemOf(result: PositionResult): string {
  if (!('problem' in result)) throw new Error(`expected a problem, got ${JSON.stringify(result)}`);
  return result.problem;
}

describe('derivePosition', () => {
  it('takes the one feature in todo as current', () => {
    const cards = [f('F-001', 'done'), f('F-002', 'todo'), f('F-003', 'backlog')];
    expect(only(derivePosition(cards)).feature.id).toBe('F-002');
  });

  it('takes the one feature in in-progress as current', () => {
    const cards = [f('F-001', 'done'), f('F-002', 'in-progress'), f('F-003', 'backlog')];
    expect(only(derivePosition(cards)).feature.id).toBe('F-002');
  });

  it('takes the first backlog feature by order when none is open', () => {
    const cards = [f('F-003', 'backlog', { order: 10 }), f('F-002', 'backlog', { order: 20 })];
    expect(only(derivePosition(cards)).feature.id).toBe('F-003');
  });

  it('breaks an equal order by id, and only by id', () => {
    const cards = [f('F-005', 'backlog', { order: 10 }), f('F-002', 'backlog', { order: 10 })];
    expect(only(derivePosition(cards)).feature.id).toBe('F-002');
  });

  it('prefers an open feature over an earlier one in the backlog', () => {
    const cards = [f('F-001', 'backlog', { order: 10 }), f('F-005', 'in-progress', { order: 50 })];
    expect(only(derivePosition(cards)).feature.id).toBe('F-005');
  });

  // THE INVARIANT. A refusal, never a tie-break: picking one silently abandons the other's work.
  it('refuses two open features and names both', () => {
    const result = derivePosition([f('F-002', 'todo'), f('F-005', 'in-progress')]);
    expect(result).toHaveProperty('problem');
    const problem = problemOf(result);
    expect(problem).toContain('F-002');
    expect(problem).toContain('F-005');
    // A refusal about a condition the reader cannot act on is worse than the condition.
    expect(problem).toContain('Move one back to Backlog');
  });

  it('refuses two open stories of the current feature, naming the feature', () => {
    const cards = [
      f('F-001', 'in-progress', { links: ['P-002', 'P-005'] }),
      p('P-002', 'todo', { links: ['F-001'] }),
      p('P-005', 'in-progress', { links: ['F-001'] }),
    ];
    const problem = problemOf(derivePosition(cards));
    expect(problem).toContain('P-002');
    expect(problem).toContain('P-005');
    expect(problem).toContain('F-001');
    expect(problem).toContain('Move one back to Backlog');
  });

  // Scoped to THIS feature: another feature's open story is not this position's problem, and refusing
  // over it would stop a healthy board.
  it('ignores an open story belonging to a different feature', () => {
    const cards = [
      f('F-001', 'todo', { links: ['P-001'] }),
      p('P-001', 'backlog', { links: ['F-001'] }),
      f('F-002', 'backlog', { order: 20, links: ['P-002', 'P-003'] }),
      p('P-002', 'todo', { links: ['F-002'] }),
      p('P-003', 'in-progress', { links: ['F-002'] }),
    ];
    const position = only(derivePosition(cards));
    expect(position.feature.id).toBe('F-001');
    expect(position.story?.id).toBe('P-001');
  });

  it('is empty when no feature exists at all', () => {
    expect(derivePosition([])).toEqual({ empty: true });
  });

  it('is empty when every feature is terminal', () => {
    const cards = [f('F-001', 'done'), f('F-002', 'done'), f('F-003', 'done')];
    expect(derivePosition(cards)).toEqual({ empty: true });
  });

  // Archived neither blocks nor satisfies (src/core/hierarchy.ts:31-35).
  it('ignores an archived feature that would otherwise be open', () => {
    const cards = [f('F-002', 'todo'), { ...f('F-005', 'in-progress'), archived: '2026-08-13T00:00:00Z' }];
    expect(only(derivePosition(cards)).feature.id).toBe('F-002');
  });

  it('ignores an archived story that would otherwise be the second open one', () => {
    const cards = [
      f('F-001', 'in-progress', { links: ['P-001', 'P-002'] }),
      p('P-001', 'todo', { links: ['F-001'] }),
      { ...p('P-002', 'in-progress', { links: ['F-001'] }), archived: '2026-08-13T00:00:00Z' },
    ];
    const position = only(derivePosition(cards));
    expect(position.story?.id).toBe('P-001');
    expect(position.stories.map((c) => c.id)).toEqual(['P-001']);
  });

  it('reads stories and tasks from the parent side of the links', () => {
    // F-001 links P-001; P-001 links E-001, and neither child links back. `childrenOf` reads the
    // PARENT's list (src/core/hierarchy.ts:58-66), and this pins that the position agrees with it.
    const cards = [
      f('F-001', 'in-progress', { links: ['P-001'] }),
      p('P-001', 'in-progress'),
      t('E-001', 'backlog'),
    ];
    const position = only(derivePosition(cards));
    expect(position.stories.map((c) => c.id)).toEqual(['P-001']);
    expect(position.story?.id).toBe('P-001');
    expect(position.tasks.map((c) => c.id)).toEqual([]);

    const linked = [
      f('F-001', 'in-progress', { links: ['P-001'] }),
      p('P-001', 'in-progress', { links: ['E-001'] }),
      t('E-001', 'backlog'),
    ];
    expect(only(derivePosition(linked)).tasks.map((c) => c.id)).toEqual(['E-001']);
  });

  it('gives no story when the feature has none, and no tasks with no story', () => {
    const position = only(derivePosition([f('F-001', 'todo')]));
    expect(position.story).toBeUndefined();
    expect(position.stories).toEqual([]);
    expect(position.tasks).toEqual([]);
  });

  it('keeps a settled story in stories while taking the backlog one as current', () => {
    // A fixture of one cannot tell "every story" from "the current story".
    const cards = [
      f('F-001', 'in-progress', { links: ['P-001', 'P-002'] }),
      p('P-001', 'done', { order: 10 }),
      p('P-002', 'backlog', { order: 20 }),
    ];
    const position = only(derivePosition(cards));
    expect(position.story?.id).toBe('P-002');
    expect(position.stories.map((c) => c.id)).toEqual(['P-001', 'P-002']);
  });
});
