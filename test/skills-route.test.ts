import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { ProjectSession } from '../src/server/session.js';
import { openTestProject } from './helpers.js';

describe('GET /api/skills', () => {
  it('serves the seeded skills of an open project', async () => {
    const { app } = await openTestProject();
    const res = await app.inject({ method: 'GET', url: '/api/skills' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { skills: { slug: string }[]; invalid: unknown[] };
    expect(body.skills.map((s) => s.slug)).toContain('execute');
    expect(body.invalid).toEqual([]);
  });

  it('reports an invalid skill separately rather than hiding it entirely', async () => {
    const { app, root } = await openTestProject();
    await mkdir(join(root, '.claude', 'skills', 'broken'), { recursive: true });
    await writeFile(
      join(root, '.claude', 'skills', 'broken', 'SKILL.md'),
      '---\nname: Broken\n---\nx\n',
      'utf8',
    );
    const body = (await app.inject({ method: 'GET', url: '/api/skills' })).json() as {
      skills: { slug: string }[];
      invalid: { slug: string; path: string; reason: string }[];
    };
    expect(body.skills.map((s) => s.slug)).not.toContain('broken');
    expect(body.invalid).toEqual([
      { slug: 'broken', path: '.claude/skills/broken/SKILL.md', reason: 'needs a description' },
    ]);
  });

  it('reads from disk per request, so a skill written now is served now', async () => {
    // No cache: the user or an agent can write a SKILL.md at any moment, and a stale rail is
    // worse than a readdir.
    const { app, root } = await openTestProject();
    const before = (await app.inject({ method: 'GET', url: '/api/skills' })).json() as {
      skills: { slug: string }[];
    };
    await mkdir(join(root, '.claude', 'skills', 'fresh'), { recursive: true });
    await writeFile(
      join(root, '.claude', 'skills', 'fresh', 'SKILL.md'),
      '---\nname: Fresh\ndescription: brand new\n---\nDo it.\n',
      'utf8',
    );
    const after = (await app.inject({ method: 'GET', url: '/api/skills' })).json() as {
      skills: { slug: string }[];
    };
    expect(before.skills.map((s) => s.slug)).not.toContain('fresh');
    expect(after.skills.map((s) => s.slug)).toContain('fresh');
  });

  it('refuses with 409 when no project is open', async () => {
    const app = buildApp(new ProjectSession());
    const res = await app.inject({ method: 'GET', url: '/api/skills' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'No project open' });
    await app.close();
  });
});
