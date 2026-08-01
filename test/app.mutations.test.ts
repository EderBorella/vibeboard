import { afterEach, describe, expect, it } from 'vitest';
import { boardColumnSlugs } from '../src/core/board.js';
import { defaultConfig } from '../src/core/config.js';
import { buildApp } from '../src/server/app.js';
import { ProjectSession } from '../src/server/session.js';
import { openTestProject } from './helpers.js';

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
    const app = buildApp(bare);
    const res = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'product', columnSlug: 'todo', title: 'x' },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});
