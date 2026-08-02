import { describe, expect, it } from 'vitest';
import { readBoard } from '../src/core/board.js';
import { readConfig } from '../src/core/config.js';
import { type CreateCardInput, createCard, placeCard } from '../src/core/mutations.js';
import { scaffoldProject } from '../src/core/scaffold.js';
import type { Card, ProjectConfig } from '../src/core/types.js';
import { cardFrom, tempDir } from './helpers.js';

const TODAY = '2026-07-25';

// Every column named below is one the scaffolded config configures, so `'unknown-column'` would
// mean the fixture is wrong rather than the behaviour under test.
const create = async (root: string, config: ProjectConfig, input: CreateCardInput): Promise<Card> =>
  cardFrom(await createCard(root, config, input, TODAY));

const place = async (
  root: string,
  config: ProjectConfig,
  card: Card,
  toColumnSlug: string,
  beforeId: string | null,
): Promise<Card> => cardFrom(await placeCard(root, config, card, toColumnSlug, beforeId));

// A project with product/todo holding three cards in a known order.
async function seeded(): Promise<{ root: string; config: ProjectConfig; cards: Card[] }> {
  const root = await tempDir();
  await scaffoldProject(root, { name: 'Ord', mode: 'brownfield', today: TODAY }); // no sample cards
  const config = await readConfig(root);
  const cards: Card[] = [];
  for (const title of ['first', 'second', 'third']) {
    cards.push(await create(root, config, { board: 'product', columnSlug: 'todo', title }));
  }
  return { root, config, cards };
}

const titlesIn = async (root: string, config: ProjectConfig, slug: string): Promise<string[]> =>
  (await readBoard(root, 'product', config)).filter((c) => c.columnSlug === slug).map((c) => c.title);

describe('createCard — ordering and defaults', () => {
  it('numbers each column from the first step, independently of its neighbours', async () => {
    const { root, config } = await seeded(); // todo already holds three cards at 10/20/30
    const review = await create(root, config, { board: 'product', columnSlug: 'backlog', title: 'r' });
    // A max order taken across the whole board rather than the column would start this at 40.
    expect(review.order).toBe(10);
  });

  it('continues from the highest order already in that column', async () => {
    const { root, config } = await seeded();
    const fourth = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'f' });
    expect(fourth.order).toBe(40);
  });

  it('defaults the optional fields rather than leaving them undefined', async () => {
    const { root, config } = await seeded();
    const card = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'bare' });
    expect(card.tags).toEqual([]);
    expect(card.links).toEqual([]);
    expect(card.body).toBe('');

    // And they survive the round trip to disk as empty rather than missing.
    const [reread] = (await readBoard(root, 'product', config)).filter((c) => c.id === card.id);
    expect(reread.tags).toEqual([]);
    expect(reread.links).toEqual([]);
  });
});

describe('placeCard — reordering inside a column', () => {
  it('moves a card to the top when placed before the first', async () => {
    const { root, config, cards } = await seeded();
    expect(await titlesIn(root, config, 'todo')).toEqual(['first', 'second', 'third']);

    await place(root, config, cards[2], 'todo', cards[0].id); // third before first
    expect(await titlesIn(root, config, 'todo')).toEqual(['third', 'first', 'second']);
  });

  it('moves a card down when placed before a later card', async () => {
    const { root, config, cards } = await seeded();
    await place(root, config, cards[0], 'todo', cards[2].id); // first before third
    expect(await titlesIn(root, config, 'todo')).toEqual(['second', 'first', 'third']);
  });

  it('sends a card to the end when no beforeId is given', async () => {
    const { root, config, cards } = await seeded();
    await place(root, config, cards[0], 'todo', null);
    expect(await titlesIn(root, config, 'todo')).toEqual(['second', 'third', 'first']);
  });

  it('renumbers with even gaps so later inserts stay cheap', async () => {
    const { root, config, cards } = await seeded();
    await place(root, config, cards[2], 'todo', cards[0].id);
    const orders = (await readBoard(root, 'product', config))
      .filter((c) => c.columnSlug === 'todo')
      .map((c) => c.order);
    expect(orders).toEqual([10, 20, 30]);
  });

  it('keeps ids and titles intact — reordering never rewrites identity', async () => {
    const { root, config, cards } = await seeded();
    await place(root, config, cards[1], 'todo', cards[0].id);
    const live = (await readBoard(root, 'product', config)).filter((c) => c.columnSlug === 'todo');
    expect(live.map((c) => c.id).sort()).toEqual(cards.map((c) => c.id).sort());
  });

  // The caller answers the HTTP request from the returned card, so its order must be the final
  // one — not the order it had on the way in.
  it('returns the card carrying its new order', async () => {
    const { root, config, cards } = await seeded();
    const moved = await place(root, config, cards[2], 'todo', cards[0].id); // third to the top
    expect(moved.order).toBe(10);
    expect(moved.id).toBe(cards[2].id);

    const end = await place(root, config, moved, 'todo', null); // and back to the end
    expect(end.order).toBe(30);
  });

  // "Before itself" only means "stay put" within the same column. Dragged into a different one it
  // is a real move, and short-circuiting on the id alone would silently drop the card.
  it('still moves a card given its own id as the target in another column', async () => {
    const { root, config, cards } = await seeded();
    const moved = await place(root, config, cards[1], 'backlog', cards[1].id);
    expect(moved.columnSlug).toBe('backlog');
    expect(await titlesIn(root, config, 'backlog')).toEqual(['second']);
    expect(await titlesIn(root, config, 'todo')).toEqual(['first', 'third']);
  });

  it('assigns every card in the column its exact order after an insert at the top', async () => {
    const { root, config, cards } = await seeded();
    await place(root, config, cards[2], 'todo', cards[0].id);
    const live = (await readBoard(root, 'product', config)).filter((c) => c.columnSlug === 'todo');
    // Title and order together: a sequence built from the wrong card set can land the right
    // titles on the wrong numbers.
    expect(live.map((c) => [c.title, c.order])).toEqual([
      ['third', 10],
      ['first', 20],
      ['second', 30],
    ]);
  });

  it('is a no-op when placed before itself, returning the card unchanged', async () => {
    const { root, config, cards } = await seeded();
    const same = await place(root, config, cards[1], 'todo', cards[1].id);
    expect(same).toEqual(cards[1]);
    expect(await titlesIn(root, config, 'todo')).toEqual(['first', 'second', 'third']);
  });

  it('tolerates a beforeId that is not in the column (treats it as the end)', async () => {
    const { root, config, cards } = await seeded();
    await place(root, config, cards[0], 'todo', 'P-999');
    expect(await titlesIn(root, config, 'todo')).toEqual(['second', 'third', 'first']);
  });
});

describe('placeCard — across columns', () => {
  it('moves the file to the new column at the requested position', async () => {
    const { root, config, cards } = await seeded();
    const target = await create(root, config, { board: 'product', columnSlug: 'done', title: 'shipped' });

    const moved = await place(root, config, cards[0], 'done', target.id); // before 'shipped'
    expect(moved.columnSlug).toBe('done');
    expect(moved.filePath).toContain('/done/');

    expect(await titlesIn(root, config, 'done')).toEqual(['first', 'shipped']);
    expect(await titlesIn(root, config, 'todo')).toEqual(['second', 'third']);
  });

  it('appends to an empty column', async () => {
    const { root, config, cards } = await seeded();
    await place(root, config, cards[1], 'in-progress', null);
    expect(await titlesIn(root, config, 'in-progress')).toEqual(['second']);
    expect(await titlesIn(root, config, 'todo')).toEqual(['first', 'third']);
  });

  it('leaves other columns untouched', async () => {
    const { root, config, cards } = await seeded();
    const other = await create(root, config, { board: 'product', columnSlug: 'backlog', title: 'later' });
    await place(root, config, cards[0], 'done', null);
    const backlog = (await readBoard(root, 'product', config)).filter((c) => c.columnSlug === 'backlog');
    expect(backlog.map((c) => c.order)).toEqual([other.order]);
  });

  // Orders are per-column, so a sequence built from the whole board instead of the one column
  // still looks right often enough to pass. Asserting both columns together closes that: four
  // cards would be numbered 10/20/30/40, and whichever card takes the 40 breaks one of these.
  it('renumbers only the column being reordered', async () => {
    const { root, config, cards } = await seeded();
    const other = await create(root, config, { board: 'product', columnSlug: 'backlog', title: 'later' });

    await place(root, config, cards[2], 'todo', cards[0].id); // reorder within todo only
    const live = await readBoard(root, 'product', config);
    expect(live.filter((c) => c.columnSlug === 'todo').map((c) => c.order)).toEqual([10, 20, 30]);
    expect(live.filter((c) => c.columnSlug === 'backlog').map((c) => c.order)).toEqual([other.order]);
  });
});
