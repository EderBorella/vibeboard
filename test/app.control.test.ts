import { describe, expect, it } from 'vitest';
import { openTestProject } from './helpers.js';

describe('/api/control', () => {
  it('lists instruction files including the scaffolded INSTRUCTIONS.md', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });
    const res = await app.inject({ method: 'GET', url: '/api/control/files' });
    expect(res.statusCode).toBe(200);
    const groups = res.json().groups as Array<{ key: string; files: Array<{ path: string }> }>;
    const instructions = groups.find((g) => g.key === 'instructions')!;
    expect(instructions.files.map((f) => f.path)).toEqual(
      expect.arrayContaining(['INSTRUCTIONS.md', 'CLAUDE.md', 'AGENTS.md', 'VIBEBOARD.md']),
    );
  });

  it('creates, reads back, and rejects an out-of-bounds write', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });
    const put = await app.inject({
      method: 'PUT',
      url: '/api/control/file',
      payload: { path: 'docs/notes.md', content: '# Notes' },
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({ method: 'GET', url: '/api/control/file?path=docs/notes.md' });
    expect(get.json().content).toBe('# Notes');

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/control/file',
      payload: { path: '../evil.md', content: 'x' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('round-trips the resources registry', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });
    await app.inject({
      method: 'PUT',
      url: '/api/control/resources',
      payload: { links: [{ title: 'Ref', url: 'https://x.dev' }] },
    });
    const res = await app.inject({ method: 'GET', url: '/api/control/resources' });
    expect(res.json().links).toEqual([{ title: 'Ref', url: 'https://x.dev' }]);
  });
});
