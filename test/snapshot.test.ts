import { describe, expect, it } from 'vitest';
import { scaffoldProject } from '../src/core/scaffold.js';
import type { Suggestion } from '../src/core/suggestions.js';
import { buildSnapshot } from '../src/server/snapshot.js';
import { writeSuggestion } from '../src/server/suggestion-store.js';
import { tempDir } from './helpers.js';

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

describe('open suggestions on the snapshot', () => {
  it('tallies the ACTIVE ones per card, and ignores the rest', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'S', mode: 'brownfield', today: '2026-08-02' });
    const s = (id: string, over: Partial<Suggestion>): Suggestion => ({
      id,
      state: 'active',
      created: 'now',
      title: id,
      body: '',
      ...over,
    });
    // Two on one card, so the tally is a count rather than a flag.
    await writeSuggestion(root, s('1', { card: 'E-001' }));
    await writeSuggestion(root, s('2', { card: 'E-001' }));
    await writeSuggestion(root, s('3', { card: 'E-002' }));
    // Neither of these may appear: a dealt-with finding must not keep a card looking unfinished.
    await writeSuggestion(root, s('4', { card: 'E-002', state: 'dismissed' }));
    await writeSuggestion(root, s('5', { card: 'E-003', state: 'actioned' }));
    // And one filed with no card at all — a project-level finding, which belongs to no tile.
    await writeSuggestion(root, s('6', {}));

    const snapshot = await buildSnapshot(root);
    expect(snapshot.openSuggestions).toEqual({ 'E-001': 2, 'E-002': 1 });
  });

  it('is an empty map, not undefined, on a project with none', async () => {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'S', mode: 'brownfield', today: '2026-08-02' });
    expect((await buildSnapshot(root)).openSuggestions).toEqual({});
  });
});
