import { describe, it, expect } from 'vitest';
import { tempDir } from './helpers.js';
import { scaffoldProject } from '../src/core/scaffold.js';
import { buildSnapshot } from '../src/server/snapshot.js';

const TODAY = '2026-07-23';

describe('buildSnapshot', () => {
  it('returns project name and all three boards with the sample cards', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Snap', mode: 'greenfield', today: TODAY });
    const snap = await buildSnapshot(root);
    expect(snap.name).toBe('Snap');
    expect(snap.root).toBe(root);
    expect(snap.boards.features.length).toBeGreaterThan(0);
    expect(snap.boards.product.length).toBeGreaterThan(0);
    expect(snap.boards.engineering[0].links).toContain(snap.boards.product[0].id);
  });

  it('symmetrically links the sample product card to the feature and the engineering card', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'Snap', mode: 'greenfield', today: TODAY });
    const snap = await buildSnapshot(root);
    const feature = snap.boards.features[0];
    const product = snap.boards.product[0];
    const engineering = snap.boards.engineering[0];
    expect(product.links).toEqual(expect.arrayContaining([feature.id, engineering.id]));
    expect(feature.links).toContain(product.id); // reverse side written
  });
});
