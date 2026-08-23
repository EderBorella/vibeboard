import { describe, expect, it } from 'vitest';
import type { Card, ProjectConfig } from '../web/src/lib/shared.js';
import {
  canPlace,
  cardPlace,
  cardsByColumn,
  columnLabel,
  columnSlugs,
  csv,
  filterByTags,
  linkedCards,
  miniature,
  parseCsv,
  presentTags,
  slugify,
  tagCounts,
  toggleTag,
} from '../web/src/lib/viewmodel.js';

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
  maxConcurrentRuns: 3,
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

describe('tagCounts', () => {
  it('counts cards per tag, most-used first', () => {
    const cards = [
      card({ id: 'E-1', tags: ['bug', 'ui'] }),
      card({ id: 'E-2', tags: ['bug', 'api'] }),
      card({ id: 'E-3', tags: ['bug'] }),
      card({ id: 'E-4', tags: ['ui'] }),
    ];
    // Exact array: the ORDER is the contract the filter bar depends on, not the membership.
    expect(tagCounts(cards)).toEqual([
      { tag: 'bug', count: 3 },
      { tag: 'ui', count: 2 },
      { tag: 'api', count: 1 },
    ]);
  });

  it('ranks by count before name: a bigger late-alphabet tag outranks a smaller early one', () => {
    const cards = [card({ tags: ['zeta'] }), card({ tags: ['zeta'] }), card({ tags: ['alpha'] })];
    expect(tagCounts(cards)).toEqual([
      { tag: 'zeta', count: 2 },
      { tag: 'alpha', count: 1 },
    ]);
  });

  it('breaks a genuine tie alphabetically, whatever order the tags were written in', () => {
    // Equal counts, inserted in reverse-alphabetical order, so insertion order and the
    // required order disagree — the only fixture shape the name tiebreak is reachable from.
    const cards = [card({ tags: ['zeta', 'mid', 'alpha'] })];
    expect(tagCounts(cards)).toEqual([
      { tag: 'alpha', count: 1 },
      { tag: 'mid', count: 1 },
      { tag: 'zeta', count: 1 },
    ]);
  });

  it('counts a card once per tag even when the card repeats it', () => {
    expect(tagCounts([card({ tags: ['bug', 'bug'] })])).toEqual([{ tag: 'bug', count: 1 }]);
  });

  it('is empty when nothing is tagged', () => {
    expect(tagCounts([card({ tags: [] }), card({ tags: [] })])).toEqual([]);
    expect(tagCounts([])).toEqual([]);
  });
});

describe('filterByTags', () => {
  const bugUi = card({ id: 'E-1', tags: ['bug', 'ui'] });
  const bug = card({ id: 'E-2', tags: ['bug'] });
  const none = card({ id: 'E-3', tags: [] });
  const cards = [bugUi, bug, none];

  it('passes every card when no tag is active', () => {
    expect(filterByTags(cards, [])).toEqual(cards);
  });

  it('keeps only the cards carrying the active tag', () => {
    expect(filterByTags(cards, ['bug']).map((c) => c.id)).toEqual(['E-1', 'E-2']);
  });

  it('requires ALL active tags, not any of them', () => {
    // The distinguishing case for AND vs OR: E-2 carries one of the two and must drop out.
    expect(filterByTags(cards, ['bug', 'ui']).map((c) => c.id)).toEqual(['E-1']);
  });

  it('yields nothing for a tag no card carries', () => {
    expect(filterByTags(cards, ['nope'])).toEqual([]);
  });

  it('leaves the input untouched', () => {
    filterByTags(cards, ['bug']);
    expect(cards.map((c) => c.id)).toEqual(['E-1', 'E-2', 'E-3']);
  });
});

describe('toggleTag', () => {
  it('appends a tag that is not active', () => {
    expect(toggleTag(['bug'], 'ui')).toEqual(['bug', 'ui']);
  });

  it('removes a tag that is active, keeping the order of the rest', () => {
    expect(toggleTag(['bug', 'ui', 'api'], 'ui')).toEqual(['bug', 'api']);
  });

  it('does not mutate the array it is given', () => {
    const active = ['bug'];
    expect(toggleTag(active, 'bug')).toEqual([]);
    expect(active).toEqual(['bug']);
  });
});

describe('presentTags', () => {
  const present = [
    { tag: 'bug', count: 2 },
    { tag: 'ui', count: 1 },
  ];

  it('keeps the active tags that still exist, in their order', () => {
    expect(presentTags(['ui', 'bug'], present)).toEqual(['ui', 'bug']);
  });

  it('drops an active tag no card carries any more', () => {
    // The card holding 'stale' was edited or archived: its chip is gone from the bar, so keeping
    // it active would filter the boards with nothing left to click.
    expect(presentTags(['bug', 'stale'], present)).toEqual(['bug']);
  });

  it('drops everything when the board has no tags left', () => {
    expect(presentTags(['bug'], [])).toEqual([]);
  });
});

describe('columnLabel', () => {
  it('recovers the configured display name from a slug', () => {
    expect(columnLabel(config, 'product', 'in-progress')).toBe('In Progress');
    expect(columnLabel(config, 'product', 'backlog')).toBe('Backlog');
  });

  it('resolves per board, not across them', () => {
    // 'todo' is a column of engineering only; product must not borrow it.
    expect(columnLabel(config, 'engineering', 'todo')).toBe('Todo');
    expect(columnLabel(config, 'product', 'todo')).toBe('todo');
  });

  it('falls back to the slug when the column was renamed away', () => {
    // The card's file keeps sitting in the old folder until something moves it, so this is a
    // state the view has to render, not an impossible one.
    expect(columnLabel(config, 'features', 'shipped')).toBe('shipped');
  });
});

describe('cardPlace', () => {
  it('is the column display name for a live card', () => {
    expect(cardPlace(config, card({ board: 'product', columnSlug: 'in-progress' }))).toBe('In Progress');
  });

  it('names the column an archived card came from, not the archive folder it sits in', () => {
    const archived = card({
      board: 'product',
      columnSlug: 'archive',
      archived: '2026-07-26T10:00:00.000Z',
      archivedFrom: 'in-progress',
    });
    expect(cardPlace(config, archived)).toBe('Archived · from In Progress');
  });

  it('says only Archived when the origin was never recorded', () => {
    // Hand-archived files can carry `archived` without `archivedFrom`; 'Archived · from archive'
    // would be worse than saying less.
    expect(cardPlace(config, card({ columnSlug: 'archive', archived: '2026-07-26T10:00:00.000Z' }))).toBe(
      'Archived',
    );
  });
});

describe('linkedCards', () => {
  const a = card({ id: 'E-001' });
  const b = card({ id: 'P-002', board: 'product' });
  const all = [a, b];

  it('resolves ids in the order the links are written, not board order', () => {
    expect(linkedCards(all, ['P-002', 'E-001']).map((c) => c.id)).toEqual(['P-002', 'E-001']);
  });

  it('drops an id nothing resolves, keeping the rest', () => {
    // A card deleted outside the app leaves its id behind in the other side's links.
    expect(linkedCards(all, ['E-001', 'GONE-9']).map((c) => c.id)).toEqual(['E-001']);
  });

  it('is empty for no links and for links nothing matches', () => {
    expect(linkedCards(all, [])).toEqual([]);
    expect(linkedCards(all, ['GONE-9'])).toEqual([]);
  });
});

describe('csv and parseCsv', () => {
  it('joins with a comma and a space, and splits back to the same list', () => {
    expect(csv(['ui', 'bug'])).toBe('ui, bug');
    expect(parseCsv('ui, bug')).toEqual(['ui', 'bug']);
  });

  it('drops blank entries, so a trailing comma while typing is not an empty tag', () => {
    expect(parseCsv('ui, , bug,')).toEqual(['ui', 'bug']);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('   ')).toEqual([]);
  });

  it('trims each entry but keeps duplicates', () => {
    // tagCounts is what decides a card counts once per tag; this is just the text format.
    expect(parseCsv('  ui ,bug,  ui ')).toEqual(['ui', 'bug', 'ui']);
  });

  it('renders an empty list as an empty line', () => {
    expect(csv([])).toBe('');
  });
});
