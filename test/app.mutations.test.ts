import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectSession } from '../src/server/boards/session.js';
import { boardColumnSlugs } from '../src/store/cards/board.js';
import { defaultConfig } from '../src/store/project/config.js';
import { openTestProject, testApp } from './helpers.js';

// The scaffold writes the default config, so this is the column the board reads. A card created in
// any other folder is not on the board, and the patch and place steps below would 404 on it.
const [ENG_COLUMN] = boardColumnSlugs(defaultConfig('Mut'), 'engineering');

// Only the "no project open" test builds a session by hand — it must NOT have a project.
let bare: ProjectSession | undefined;

afterEach(async () => {
  await bare?.close();
  bare = undefined;
});

describe('app mutation routes', () => {
  it('creates, patches, places, and archives a card through HTTP', async () => {
    const { app } = await openTestProject({ name: 'Mut' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'engineering', columnSlug: ENG_COLUMN, title: 'Via API' },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    expect(id).toBe('E-002'); // E-001 is the sample card

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/cards/engineering/${id}`,
      payload: { title: 'Renamed via API' },
    });
    expect(patched.json().title).toBe('Renamed via API');

    // `place` with beforeId: null is "move to the end of that column" — the same job the
    // old /move route did, plus the order renumbering the board actually needs.
    const moved = await app.inject({
      method: 'POST',
      url: `/api/cards/engineering/${id}/place`,
      payload: { toColumnSlug: 'in-progress', beforeId: null },
    });
    expect(moved.json().columnSlug).toBe('in-progress');

    await app.inject({ method: 'POST', url: `/api/cards/engineering/${id}/archive` });
    const state = await app.inject({ method: 'GET', url: '/api/state' });
    expect(state.json().snapshot.boards.engineering.find((c: { id: string }) => c.id === id)).toBeUndefined();
  });

  // `break-down` is now told to set `group` on every card it creates, so that one group is one vertical —
  // a feature, its user stories and their tasks. That instruction is worth nothing unless the create path
  // actually keeps the value, and nothing exercised it: `group` was tested at the frontmatter and patch
  // layers only, so a create that silently dropped it would have left every spine unlabelled.
  it('keeps the group a card is created with, so a vertical stays labelled', async () => {
    const { app } = await openTestProject({ name: 'Mut' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'engineering', columnSlug: ENG_COLUMN, title: 'Add --json', group: 'F-002' },
    });
    expect(created.json().group).toBe('F-002');

    // On disk as well as in the answer: the board is read back from these files, so a group the response
    // carried and the file did not would vanish on the next reload.
    expect(await readFile(created.json().filePath, 'utf8')).toContain('group: F-002');

    const state = await app.inject({ method: 'GET', url: '/api/state' });
    const card = state.json().snapshot.boards.engineering.find((c: { id: string }) => c.id === 'E-002');
    expect(card.group).toBe('F-002');
  });

  it('returns 404 for a missing card', async () => {
    const { app } = await openTestProject({ name: 'Mut' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/cards/product/P-999',
      payload: { title: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when mutating with no project open', async () => {
    bare = new ProjectSession();
    const app = testApp(bare);
    const res = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'product', columnSlug: 'todo', title: 'x' },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});
