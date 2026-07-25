import { describe, expect, it } from 'vitest';
import { openTestProject } from './helpers.js';

describe('raw card editing', () => {
  it('reads a card file and writes it back verbatim', async () => {
    const { app } = await openTestProject({ name: 'Raw' });

    const raw = await app.inject({ method: 'GET', url: '/api/cards/engineering/E-001/raw' });
    expect(raw.statusCode).toBe(200);
    expect(raw.json().raw).toContain('id: E-001');

    const edited = `${raw.json().raw}\n\nAppended by raw editor.`;
    const put = await app.inject({
      method: 'PUT',
      url: '/api/cards/engineering/E-001/raw',
      payload: { raw: edited },
    });
    expect(put.json().ok).toBe(true);

    const state = await app.inject({ method: 'GET', url: '/api/state' });
    const card = state.json().snapshot.boards.engineering.find((c: { id: string }) => c.id === 'E-001');
    expect(card.body).toContain('Appended by raw editor.');
  });

  it('returns 404 for raw read of a missing card', async () => {
    const { app } = await openTestProject({ name: 'Raw' });
    const res = await app.inject({ method: 'GET', url: '/api/cards/engineering/E-999/raw' });
    expect(res.statusCode).toBe(404);
  });
});
