import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardColumnSlugs, readBoard } from '../src/core/board.js';
import { readConfig } from '../src/core/config.js';
import { findCard } from '../src/core/find.js';
import { boardRel } from '../src/core/layout.js';
import { boardOfId, createLinkedCard, setCardLinks } from '../src/core/links.js';
import { type CreateCardInput, createCard } from '../src/core/mutations.js';
import { scaffoldProject } from '../src/core/scaffold.js';
import type { Card, ProjectConfig } from '../src/core/types.js';
import { cardFrom, tempDir } from './helpers.js';

const TODAY = '2026-07-23';

// Every fixture below names a configured column, so `'unknown-column'` would mean the fixture is
// wrong rather than the linking behaviour under test.
const create = async (root: string, config: ProjectConfig, input: CreateCardInput): Promise<Card> =>
  cardFrom(await createCard(root, config, input, TODAY));

// `engColumn` is engineering's first column, read off the project's own config: a card created in
// a folder no column maps to is not on the board, so setCardLinks could not resolve it and every
// link assertion would be about a card that isn't there.
async function fixture(): Promise<{ root: string; config: ProjectConfig; engColumn: string }> {
  const root = await tempDir();
  await scaffoldProject(root, { name: 'links', mode: 'greenfield', today: TODAY });
  const config = await readConfig(root);
  return { root, config, engColumn: boardColumnSlugs(config, 'engineering')[0] };
}

describe('boardOfId', () => {
  it('maps id prefixes to boards', () => {
    expect(boardOfId('F-001')).toBe('features');
    expect(boardOfId('P-003')).toBe('product');
    expect(boardOfId('E-012')).toBe('engineering');
  });
});

describe('setCardLinks (symmetric)', () => {
  it('links two product cards on both sides', async () => {
    const { root, config } = await fixture();
    const a = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'A' });
    const b = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'B' });

    await setCardLinks(root, config, a, [b.id]);

    const product = await readBoard(root, 'product', config);
    expect(product.find((c) => c.id === a.id)!.links).toContain(b.id);
    expect(product.find((c) => c.id === b.id)!.links).toContain(a.id); // reverse side written
  });

  it('links across boards (engineering <-> product) both ways', async () => {
    const { root, config, engColumn } = await fixture();
    const e = await create(root, config, { board: 'engineering', columnSlug: engColumn, title: 'E' });
    const p = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'P' });

    await setCardLinks(root, config, p, [e.id]); // link initiated from the product side

    const freshE = await findCard(root, 'engineering', e.id, config);
    const freshP = await findCard(root, 'product', p.id, config);
    expect(freshP!.links).toContain(e.id);
    expect(freshE!.links).toContain(p.id);
  });

  it('removes a link from both sides when it is no longer desired', async () => {
    const { root, config, engColumn } = await fixture();
    const a = await create(root, config, { board: 'engineering', columnSlug: engColumn, title: 'A' });
    const b = await create(root, config, { board: 'engineering', columnSlug: engColumn, title: 'B' });
    await setCardLinks(root, config, a, [b.id]);

    // now clear A's links
    const freshA = await findCard(root, 'engineering', a.id, config);
    await setCardLinks(root, config, freshA!, []);

    const eng = await readBoard(root, 'engineering', config);
    expect(eng.find((c) => c.id === a.id)!.links).not.toContain(b.id);
    expect(eng.find((c) => c.id === b.id)!.links).not.toContain(a.id); // reverse cleared too
  });

  it('ignores self-links and non-live target ids', async () => {
    const { root, config } = await fixture();
    const a = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'A' });
    await setCardLinks(root, config, a, [a.id, 'E-999']);
    const fresh = await findCard(root, 'product', a.id, config);
    expect(fresh!.links).toEqual([]);
  });

  // The reconcile loop decides per card between add, remove and leave alone. Each of the three
  // outcomes needs its own witness, or a mixed-up condition still satisfies the others.
  it('leaves a card that should keep its link untouched', async () => {
    const { root, config } = await fixture();
    const a = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'A' });
    const b = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'B' });
    await setCardLinks(root, config, a, [b.id]);

    // Re-setting the same link must not strip the back-reference it already holds.
    const freshA = await findCard(root, 'product', a.id, config);
    await setCardLinks(root, config, freshA!, [b.id]);
    expect((await findCard(root, 'product', b.id, config))!.links).toContain(a.id);
  });

  it('does not touch a card that is neither linked nor desired', async () => {
    const { root, config } = await fixture();
    const a = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'A' });
    const b = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'B' });
    const bystander = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'C' });

    await setCardLinks(root, config, a, [b.id]);
    expect((await findCard(root, 'product', bystander.id, config))!.links).toEqual([]);
  });

  // Removing a back-reference must remove exactly that one. If the card losing it holds no other
  // link, dropping the single id and dropping everything look identical — so the shared target
  // here deliberately holds two.
  it('removes only this card own back-reference, leaving the target other links', async () => {
    const { root, config, engColumn } = await fixture();
    const a = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'A' });
    const b = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'B' });
    const shared = await create(root, config, {
      board: 'engineering',
      columnSlug: engColumn,
      title: 'shared',
    });

    await setCardLinks(root, config, a, [shared.id]);
    await setCardLinks(root, config, b, [shared.id]);
    expect((await findCard(root, 'engineering', shared.id, config))!.links).toEqual(
      expect.arrayContaining([a.id, b.id]),
    );

    // A drops its link; B's must survive on `shared`.
    const freshA = await findCard(root, 'product', a.id, config);
    await setCardLinks(root, config, freshA!, []);
    expect((await findCard(root, 'engineering', shared.id, config))!.links).toEqual([b.id]);
  });
});

// RULING 65, in the data layer. `createCard` took a `links` field and wrote it into the new card's frontmatter
// itself — one side of a symmetric relation, and the side neither `childrenOf` nor `parentOf` reads.
describe('createLinkedCard', () => {
  it('writes the far side, so the new card is a child rather than an orphan', async () => {
    const { root, config } = await fixture();
    const parent = await create(root, config, { board: 'features', columnSlug: 'backlog', title: 'F' });

    const made = await createLinkedCard(
      root,
      config,
      { board: 'product', columnSlug: 'todo', title: 'A story' },
      [parent.id],
      TODAY,
    );

    const child = cardFrom(made as Card | 'unknown-column');
    expect(child.links).toEqual([parent.id]);
    // THE HALF THAT WAS MISSING, and the one the hierarchy is derived from.
    const cards = await readBoard(root, 'features', config);
    expect(cards.find((c) => c.id === parent.id)?.links).toContain(child.id);
  });

  it('refuses a second parent, and leaves no card behind when it does', async () => {
    // The far-side check, which is the one the create path can actually trip: the back-reference this writes
    // lands on cards that already have a parent of their own.
    const { root, config, engColumn } = await fixture();
    const story = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'P' });
    const task = await create(root, config, { board: 'engineering', columnSlug: engColumn, title: 'E' });
    await setCardLinks(root, config, story, [task.id]);

    const spentBefore = (await readBoard(root, 'product', config)).length;
    const refused = await createLinkedCard(
      root,
      config,
      { board: 'product', columnSlug: 'todo', title: 'A second parent' },
      [task.id],
      TODAY,
    );

    expect(refused).toMatchObject({ problem: expect.stringContaining('would give it two') });
    // Taken back off the board: a refused create must not leave a card standing with none of its links.
    expect((await readBoard(root, 'product', config)).length).toBe(spentBefore);
    expect((await findCard(root, 'engineering', task.id, config))?.links).toEqual([story.id]);
  });

  it('leaves the check to the caller when the project allows many parents', async () => {
    const { root, config, engColumn } = await fixture();
    const story = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'P' });
    const task = await create(root, config, { board: 'engineering', columnSlug: engColumn, title: 'E' });
    await setCardLinks(root, config, story, [task.id]);

    const made = await createLinkedCard(
      root,
      config,
      { board: 'product', columnSlug: 'todo', title: 'Also its parent' },
      [task.id],
      TODAY,
      false,
    );

    expect(cardFrom(made as Card | 'unknown-column').links).toEqual([task.id]);
  });

  it('creates nothing at all when the column is not on the board', async () => {
    const { root, config } = await fixture();
    expect(
      await createLinkedCard(
        root,
        config,
        { board: 'product', columnSlug: 'not-a-column', title: 'Phantom' },
        ['F-001'],
        TODAY,
      ),
    ).toBe('unknown-column');
  });
});

// Dropping an id that names no card is the documented contract. Dropping one whose FILE is sitting
// right there is a different fact, and the two were indistinguishable — break-down could link a
// child, be told it succeeded, and leave an orphan.
describe('a link target that exists but cannot be read', () => {
  it('is reported, not silently dropped', async () => {
    const { root, config, engColumn } = await fixture();
    const a = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'A' });
    await writeFile(
      join(root, boardRel('engineering', engColumn, 'E-050.md')),
      '---\ntitle: "broken\n---\nx\n',
      'utf8',
    );

    const unreadable: string[] = [];
    const updated = await setCardLinks(root, config, a, ['E-050'], unreadable);

    expect(unreadable).toEqual(['E-050']);
    expect(updated.links).toEqual([]); // still not linked — the report is the point
  });

  it('says nothing about an id that names no file at all', async () => {
    // The existing contract: a genuinely unknown id is ignored, and must not start reporting.
    const { root, config } = await fixture();
    const a = await create(root, config, { board: 'product', columnSlug: 'todo', title: 'A' });

    const unreadable: string[] = [];
    await setCardLinks(root, config, a, ['E-999'], unreadable);

    expect(unreadable).toEqual([]);
  });
});
