import { describe, it, expect } from 'vitest';
import { tempDir } from './helpers.js';
import { scaffoldProject } from '../src/core/scaffold.js';
import { readConfig } from '../src/core/config.js';
import { readBoard } from '../src/core/board.js';
import { archiveCard } from '../src/core/mutations.js';
import { findCard } from '../src/core/find.js';

const TODAY = '2026-07-23';
const NOW = '2026-07-23T10:00:00.000Z';

describe('findCard', () => {
  it('finds a live card by id', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'F', mode: 'greenfield', today: TODAY });
    const config = await readConfig(root);
    const found = await findCard(root, 'product', 'P-001', config);
    expect(found?.id).toBe('P-001');
  });

  it('returns undefined for a missing id', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'F', mode: 'greenfield', today: TODAY });
    const config = await readConfig(root);
    expect(await findCard(root, 'product', 'P-999', config)).toBeUndefined();
  });

  it('finds an archived card', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'F', mode: 'greenfield', today: TODAY });
    const config = await readConfig(root);
    const [card] = await readBoard(root, 'engineering', config);
    await archiveCard(root, card, NOW);
    const found = await findCard(root, 'engineering', card.id, config);
    expect(found?.id).toBe(card.id);
    expect(found?.columnSlug).toBe('archive');
  });
});
