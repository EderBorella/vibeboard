import { describe, expect, it } from 'vitest';
import { countLive, createdNothing } from '../src/core/created.js';
import type { BoardName, Card } from '../src/core/types.js';

function card(board: BoardName, id: string, over: Partial<Card> = {}): Card {
  return {
    id,
    title: id,
    order: 10,
    tags: [],
    links: [],
    created: '2026-08-13',
    board,
    columnSlug: 'backlog',
    body: '',
    filePath: `/tmp/${id}.md`,
    ...over,
  };
}

describe('createdNothing', () => {
  it('is true when the board is the same size afterwards', () => expect(createdNothing(5, 5)).toBe(true));
  it('is false when a card appeared', () => expect(createdNothing(5, 6)).toBe(false));
  // A card ARCHIVED during the run must not read as a creation that did not happen, and must not turn a
  // real creation into nothing either.
  it('is true when the count went down', () => expect(createdNothing(5, 4)).toBe(true));
  it('is false when several cards appeared', () => expect(createdNothing(0, 5)).toBe(false));
});

describe('countLive', () => {
  it('sums all three boards', () => {
    const boards = {
      features: [card('features', 'F-001'), card('features', 'F-002')],
      product: [card('product', 'P-001')],
      engineering: [card('engineering', 'E-001'), card('engineering', 'E-002'), card('engineering', 'E-003')],
    };
    expect(countLive(boards)).toBe(6);
  });

  it('counts a board the snapshot omitted as zero rather than throwing', () => {
    // A fetch that returned a partial snapshot must not take the loop down: the answer it feeds is
    // "did a card appear", and throwing there would end the run rather than the tick.
    const partial = { features: [card('features', 'F-001')] } as Record<BoardName, Card[]>;
    expect(countLive(partial)).toBe(1);
    expect(countLive({} as Record<BoardName, Card[]>)).toBe(0);
  });

  // Archived neither blocks nor satisfies, here as everywhere: a run that archived one card and created
  // one has not grown the board, and this is the reading that refuses rather than advancing.
  it('does not count an archived card', () => {
    const boards = {
      features: [card('features', 'F-001'), card('features', 'F-002', { archived: '2026-08-13T00:00:00Z' })],
      product: [],
      engineering: [],
    };
    expect(countLive(boards)).toBe(1);
  });
});
