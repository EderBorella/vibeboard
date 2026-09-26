import { describe, expect, it } from 'vitest';
import { boardAroundFor } from '../src/core/board-around.js';
import { ARCHIVE_SLUG } from '../src/core/layout.js';
import type { BoardName, Card } from '../src/core/types.js';

// THE SLICE OF THE BOARD A PHASE WOULD OTHERWISE FETCH (decision 90). Two features, three stories under the
// first, tasks under two of them, and one archived story — archived cards are not on the board.
const card = (id: string, board: BoardName, links: string[] = [], columnSlug = 'backlog'): Card => ({
  id,
  title: `${id} title`,
  order: 10,
  tags: [],
  links,
  created: '2026-09-26',
  board,
  columnSlug,
  body: '',
  filePath: `/tmp/${id}.md`,
});

const board = [
  card('F-001', 'features', ['P-001', 'P-002', 'P-003', 'P-009']),
  card('F-002', 'features'),
  card('P-001', 'product', ['F-001', 'E-001', 'E-002'], 'done'),
  card('P-002', 'product', ['F-001', 'E-003']),
  card('P-003', 'product', ['F-001']),
  card('P-009', 'product', ['F-001'], ARCHIVE_SLUG),
  card('E-001', 'engineering', ['P-001'], 'done'),
  card('E-002', 'engineering', ['P-001'], 'done'),
  card('E-003', 'engineering', ['P-002']),
];
const at = (id: string): Card => board.find((c) => c.id === id) as Card;
const ids = (cards: Card[] | undefined): string[] | undefined => cards?.map((c) => c.id);

describe('the board around a card', () => {
  it('gives a story break-down its feature, the stories beside it with their tasks, and its own tasks', () => {
    const around = boardAroundFor('story-breakdown', at('P-002'), board);
    expect(around?.parent?.id).toBe('F-001');
    // The archived P-009 is not beside it: an archived card is not on the board.
    expect(around?.siblings.map((s) => [s.card.id, ids(s.children)])).toEqual([
      ['P-001', ['E-001', 'E-002']],
      ['P-003', []],
    ]);
    expect(ids(around?.children)).toEqual(['E-003']);
  });

  it('gives a feature break-down the other features and its own stories', () => {
    const around = boardAroundFor('feature-breakdown', at('F-001'), board);
    expect(around?.parent).toBeUndefined();
    expect(around?.siblings.map((s) => [s.card.id, ids(s.children)])).toEqual([['F-002', []]]);
    expect(ids(around?.children)).toEqual(['P-001', 'P-002', 'P-003']);
  });

  // Its prompt already lists every story under it, with its column and how its last run ended.
  it('gives the feature checkup the other features but not its stories again', () => {
    const around = boardAroundFor('feature-checkup', at('F-001'), board);
    expect(around?.siblings.map((s) => s.card.id)).toEqual(['F-002']);
    expect(around && 'children' in around).toBe(false);
  });

  it.each([['story-implement'], ['story-review'], ['story-fix'], ['bootstrap']] as const)(
    'gives %s nothing, because nothing tells it to go and read the board',
    (phase) => {
      expect(boardAroundFor(phase, at('P-002'), board)).toBeUndefined();
    },
  );

  it('gives a run no phase claims nothing', () => {
    expect(boardAroundFor(undefined, at('P-002'), board)).toBeUndefined();
  });
});
