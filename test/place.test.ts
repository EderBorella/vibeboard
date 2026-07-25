import { describe, it, expect } from 'vitest';
import { tempDir } from './helpers.js';
import { scaffoldProject } from '../src/core/scaffold.js';
import { readConfig } from '../src/core/config.js';
import { readBoard } from '../src/core/board.js';
import { createCard, placeCard } from '../src/core/mutations.js';
import type { Card, ProjectConfig } from '../src/core/types.js';

const TODAY = '2026-07-25';

// A project with product/todo holding three cards in a known order.
async function seeded(): Promise<{ root: string; config: ProjectConfig; cards: Card[] }> {
  const root = await tempDir();
  await scaffoldProject(root, { name: 'Ord', mode: 'brownfield', today: TODAY }); // no sample cards
  const config = await readConfig(root);
  const cards: Card[] = [];
  for (const title of ['first', 'second', 'third']) {
    cards.push(await createCard(root, config, { board: 'product', columnSlug: 'todo', title }, TODAY));
  }
  return { root, config, cards };
}

const titlesIn = async (root: string, config: ProjectConfig, slug: string): Promise<string[]> =>
  (await readBoard(root, 'product', config)).filter((c) => c.columnSlug === slug).map((c) => c.title);

describe('placeCard — reordering inside a column', () => {
  it('moves a card to the top when placed before the first', async () => {
    const { root, config, cards } = await seeded();
    expect(await titlesIn(root, config, 'todo')).toEqual(['first', 'second', 'third']);

    await placeCard(root, config, cards[2], 'todo', cards[0].id); // third before first
    expect(await titlesIn(root, config, 'todo')).toEqual(['third', 'first', 'second']);
  });

  it('moves a card down when placed before a later card', async () => {
    const { root, config, cards } = await seeded();
    await placeCard(root, config, cards[0], 'todo', cards[2].id); // first before third
    expect(await titlesIn(root, config, 'todo')).toEqual(['second', 'first', 'third']);
  });

  it('sends a card to the end when no beforeId is given', async () => {
    const { root, config, cards } = await seeded();
    await placeCard(root, config, cards[0], 'todo', null);
    expect(await titlesIn(root, config, 'todo')).toEqual(['second', 'third', 'first']);
  });

  it('renumbers with even gaps so later inserts stay cheap', async () => {
    const { root, config, cards } = await seeded();
    await placeCard(root, config, cards[2], 'todo', cards[0].id);
    const orders = (await readBoard(root, 'product', config))
      .filter((c) => c.columnSlug === 'todo')
      .map((c) => c.order);
    expect(orders).toEqual([10, 20, 30]);
  });

  it('keeps ids and titles intact — reordering never rewrites identity', async () => {
    const { root, config, cards } = await seeded();
    await placeCard(root, config, cards[1], 'todo', cards[0].id);
    const live = (await readBoard(root, 'product', config)).filter((c) => c.columnSlug === 'todo');
    expect(live.map((c) => c.id).sort()).toEqual(cards.map((c) => c.id).sort());
  });

  it('is a no-op when placed before itself', async () => {
    const { root, config, cards } = await seeded();
    await placeCard(root, config, cards[1], 'todo', cards[1].id);
    expect(await titlesIn(root, config, 'todo')).toEqual(['first', 'second', 'third']);
  });

  it('tolerates a beforeId that is not in the column (treats it as the end)', async () => {
    const { root, config, cards } = await seeded();
    await placeCard(root, config, cards[0], 'todo', 'P-999');
    expect(await titlesIn(root, config, 'todo')).toEqual(['second', 'third', 'first']);
  });
});

describe('placeCard — across columns', () => {
  it('moves the file to the new column at the requested position', async () => {
    const { root, config, cards } = await seeded();
    const target = await createCard(
      root,
      config,
      { board: 'product', columnSlug: 'done', title: 'shipped' },
      TODAY,
    );

    const moved = await placeCard(root, config, cards[0], 'done', target.id); // before 'shipped'
    expect(moved.columnSlug).toBe('done');
    expect(moved.filePath).toContain('/done/');

    expect(await titlesIn(root, config, 'done')).toEqual(['first', 'shipped']);
    expect(await titlesIn(root, config, 'todo')).toEqual(['second', 'third']);
  });

  it('appends to an empty column', async () => {
    const { root, config, cards } = await seeded();
    await placeCard(root, config, cards[1], 'in-progress', null);
    expect(await titlesIn(root, config, 'in-progress')).toEqual(['second']);
    expect(await titlesIn(root, config, 'todo')).toEqual(['first', 'third']);
  });

  it('leaves other columns untouched', async () => {
    const { root, config, cards } = await seeded();
    const other = await createCard(
      root,
      config,
      { board: 'product', columnSlug: 'backlog', title: 'later' },
      TODAY,
    );
    await placeCard(root, config, cards[0], 'done', null);
    const backlog = (await readBoard(root, 'product', config)).filter((c) => c.columnSlug === 'backlog');
    expect(backlog.map((c) => c.order)).toEqual([other.order]);
  });
});
