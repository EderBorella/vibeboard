import { describe, expect, it } from 'vitest';
import { readBoard } from '../src/core/board.js';
import { readConfig } from '../src/core/config.js';
import { findCard } from '../src/core/find.js';
import { boardOfId, setCardLinks } from '../src/core/links.js';
import { createCard } from '../src/core/mutations.js';
import { scaffoldProject } from '../src/core/scaffold.js';
import type { ProjectConfig } from '../src/core/types.js';
import { tempDir } from './helpers.js';

const TODAY = '2026-07-23';

async function fixture(): Promise<{ root: string; config: ProjectConfig }> {
  const root = await tempDir();
  await scaffoldProject(root, { name: 'links', mode: 'greenfield', today: TODAY });
  const config = await readConfig(root);
  return { root, config };
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
    const a = await createCard(root, config, { board: 'product', columnSlug: 'todo', title: 'A' }, TODAY);
    const b = await createCard(root, config, { board: 'product', columnSlug: 'todo', title: 'B' }, TODAY);

    await setCardLinks(root, config, a, [b.id]);

    const product = await readBoard(root, 'product', config);
    expect(product.find((c) => c.id === a.id)!.links).toContain(b.id);
    expect(product.find((c) => c.id === b.id)!.links).toContain(a.id); // reverse side written
  });

  it('links across boards (engineering <-> product) both ways', async () => {
    const { root, config } = await fixture();
    const e = await createCard(root, config, { board: 'engineering', columnSlug: 'todo', title: 'E' }, TODAY);
    const p = await createCard(root, config, { board: 'product', columnSlug: 'todo', title: 'P' }, TODAY);

    await setCardLinks(root, config, p, [e.id]); // link initiated from the product side

    const freshE = await findCard(root, 'engineering', e.id, config);
    const freshP = await findCard(root, 'product', p.id, config);
    expect(freshP!.links).toContain(e.id);
    expect(freshE!.links).toContain(p.id);
  });

  it('removes a link from both sides when it is no longer desired', async () => {
    const { root, config } = await fixture();
    const a = await createCard(root, config, { board: 'engineering', columnSlug: 'todo', title: 'A' }, TODAY);
    const b = await createCard(root, config, { board: 'engineering', columnSlug: 'todo', title: 'B' }, TODAY);
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
    const a = await createCard(root, config, { board: 'product', columnSlug: 'todo', title: 'A' }, TODAY);
    await setCardLinks(root, config, a, [a.id, 'E-999']);
    const fresh = await findCard(root, 'product', a.id, config);
    expect(fresh!.links).toEqual([]);
  });
});
