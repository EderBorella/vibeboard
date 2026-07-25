import { describe, it, expect } from 'vitest';
import { openTestProject } from './helpers.js';

describe('PUT /cards/:board/:id/links', () => {
  it('links a product card to the sample engineering card on both sides', async () => {
    const { app } = await openTestProject({ name: 'L' });
    // sample cards: P-001 (product), E-001 (engineering, already links P-001)
    const created = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: { board: 'product', columnSlug: 'todo', title: 'Second product' },
    });
    const p2 = created.json().id; // P-002

    const res = await app.inject({
      method: 'PUT',
      url: `/api/cards/product/${p2}/links`,
      payload: { links: ['E-001'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().links).toContain('E-001');

    const state = await app.inject({ method: 'GET', url: '/api/state' });
    const snap = state.json().snapshot;
    const e1 = snap.boards.engineering.find((c: { id: string }) => c.id === 'E-001');
    expect(e1.links).toContain(p2); // reverse side updated
  });

  it('404 for a missing card', async () => {
    const { app } = await openTestProject({ name: 'L' });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/cards/product/P-999/links',
      payload: { links: [] },
    });
    expect(res.statusCode).toBe(404);
  });
});
