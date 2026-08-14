import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeCard } from '../src/core/card.js';
import { boardRel } from '../src/core/layout.js';
import type { Suggestion } from '../src/core/suggestions.js';
import type { BoardName, CardFrontmatter } from '../src/core/types.js';
import { buildSnapshot } from '../src/server/boards/snapshot.js';
import { scaffoldProject } from '../src/store/project/scaffold.js';
import { writeSuggestion } from '../src/store/suggestion-store.js';
import { tempDir } from './helpers.js';

const TODAY = '2026-07-23';

// Straight onto disk rather than through createCard, so each test states the ids, the columns and the
// links it is about — the three things the derivation reads.
async function putCard(
  root: string,
  board: BoardName,
  columnSlug: string,
  fm: Partial<CardFrontmatter> & { id: string },
): Promise<void> {
  const dir = join(root, boardRel(board, columnSlug));
  await mkdir(dir, { recursive: true });
  const full: CardFrontmatter = {
    title: fm.id,
    order: 10,
    tags: [],
    links: [],
    created: TODAY,
    ...fm,
  };
  await writeFile(join(dir, `${fm.id}.md`), serializeCard(full, ''), 'utf8');
}

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

// Decision 46: the status a person reads off a card is computed from what is under it, and it is
// computed HERE rather than per tile — the board re-renders on every file change, and a badge that
// arrives a request later is a badge nobody sees. Ids rather than a boolean, so the tile can name them.
describe('the derived status on the snapshot', () => {
  async function empty(): Promise<string> {
    const root = await tempDir();
    await scaffoldProject(root, { name: 'S', mode: 'brownfield', today: '2026-08-02' });
    return root;
  }

  it('names the blocked task under a story and under its feature', async () => {
    const root = await empty();
    await putCard(root, 'features', 'done', { id: 'F-001', links: ['P-001'] });
    await putCard(root, 'product', 'done', { id: 'P-001', links: ['F-001', 'E-001'] });
    await putCard(root, 'engineering', 'blocked', { id: 'E-001', links: ['P-001'] });
    const snapshot = await buildSnapshot(root);
    expect(snapshot.carryingAProblem).toEqual({ 'P-001': ['E-001'], 'F-001': ['E-001'] });
  });

  it('is empty for a clean board', async () => {
    const root = await empty();
    await putCard(root, 'product', 'done', { id: 'P-001', links: ['E-001'] });
    await putCard(root, 'engineering', 'done', { id: 'E-001', links: ['P-001'] });
    // `{}` and NOT absent, which would read as unknown rather than as nothing to report.
    expect((await buildSnapshot(root)).carryingAProblem).toEqual({});
  });

  it('ignores an archived blocked task', async () => {
    const root = await empty();
    await putCard(root, 'product', 'done', { id: 'P-001', links: ['E-001'] });
    // Archived by its FIELD while its file still sits in the blocked folder — the half a restore
    // writes. An archived card neither blocks nor satisfies anything, so the story is clean.
    await putCard(root, 'engineering', 'blocked', {
      id: 'E-001',
      links: ['P-001'],
      archived: '2026-08-02T10:00:00.000Z',
    });
    expect((await buildSnapshot(root)).carryingAProblem).toEqual({});
  });

  it('omits a card with nothing blocked under it rather than listing an empty array', async () => {
    const root = await empty();
    await putCard(root, 'product', 'done', { id: 'P-001', links: ['E-001'] });
    await putCard(root, 'engineering', 'blocked', { id: 'E-001', links: ['P-001'] });
    // A second story with nothing wrong under it, and a task of its own so it is not childless.
    await putCard(root, 'product', 'done', { id: 'P-002', links: ['E-002'] });
    await putCard(root, 'engineering', 'done', { id: 'E-002', links: ['P-002'] });
    const { carryingAProblem } = await buildSnapshot(root);
    expect(Object.keys(carryingAProblem)).toEqual(['P-001']);
    // An empty array is truthy in the browser, so a tile reading the map would badge every card.
    expect(carryingAProblem['P-002']).toBeUndefined();
  });
});
