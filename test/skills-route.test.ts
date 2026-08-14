import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { skillRel } from '../src/core/layout.js';
import { ProjectSession } from '../src/server/boards/session.js';
import { openTestProject, testApp } from './helpers.js';

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
    await mkdir(join(root, skillRel('broken')), { recursive: true });
    await writeFile(join(root, skillRel('broken', 'SKILL.md')), '---\nname: Broken\n---\nx\n', 'utf8');
    const body = (await app.inject({ method: 'GET', url: '/api/skills' })).json() as {
      skills: { slug: string }[];
      invalid: { slug: string; path: string; reason: string }[];
    };
    expect(body.skills.map((s) => s.slug)).not.toContain('broken');
    expect(body.invalid).toEqual([
      { slug: 'broken', path: skillRel('broken', 'SKILL.md'), reason: 'needs a description' },
    ]);
  });

  it('reads from disk per request, so a skill written now is served now', async () => {
    // No cache: the user or an agent can write a SKILL.md at any moment, and a stale rail is
    // worse than a readdir.
    const { app, root } = await openTestProject();
    const before = (await app.inject({ method: 'GET', url: '/api/skills' })).json() as {
      skills: { slug: string }[];
    };
    await mkdir(join(root, skillRel('fresh')), { recursive: true });
    await writeFile(
      join(root, skillRel('fresh', 'SKILL.md')),
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
    const app = testApp(new ProjectSession());
    const res = await app.inject({ method: 'GET', url: '/api/skills' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'No project open' });
    await app.close();
  });
});

describe('PUT /api/skills/:slug', () => {
  it('writes a skill from its fields and answers with the catalogue', async () => {
    const { app } = await openTestProject();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/skills/execute',
      payload: {
        name: 'Execute',
        description: 'Implement it',
        boards: ['engineering'],
        // 'review' is configured on engineering — the scope has to validate, or this lands in
        // `invalid` and the test below is the one being exercised instead.
        columns: ['review'],
        prompt: 'Do the work.',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { skills: { slug: string; description: string; columns: string[] }[] };
    const written = body.skills.find((s) => s.slug === 'execute');
    expect(written?.description).toBe('Implement it');
    expect(written?.columns).toEqual(['review']);
  });

  it('creates a skill that did not exist', async () => {
    const { app, root } = await openTestProject();
    await app.inject({
      method: 'PUT',
      url: '/api/skills/brand-new',
      payload: { name: 'Brand new', description: 'D', boards: [], columns: [], prompt: 'P' },
    });
    const { readFile } = await import('node:fs/promises');
    const onDisk = await readFile(join(root, skillRel('brand-new', 'SKILL.md')), 'utf8');
    expect(onDisk).toBe('---\nname: Brand new\ndescription: D\n---\nP\n');
  });

  it('reports a column that does not exist as invalid, rather than pretending it saved clean', async () => {
    // The fields alone cannot know this: 'review' exists on engineering but not on product.
    const { app } = await openTestProject();
    const body = (
      await app.inject({
        method: 'PUT',
        url: '/api/skills/execute',
        payload: {
          name: 'Execute',
          description: 'D',
          boards: ['product'],
          columns: ['review'],
          prompt: 'P',
        },
      })
    ).json() as { skills: { slug: string }[]; invalid: { slug: string; reason: string }[] };
    expect(body.skills.map((s) => s.slug)).not.toContain('execute');
    expect(body.invalid).toEqual([
      { slug: 'execute', path: skillRel('execute', 'SKILL.md'), reason: 'unknown column "review"' },
    ]);
  });

  it.each([
    [{ description: 'D', prompt: 'P' }, 'A skill needs a name'],
    [{ name: 'N', prompt: 'P' }, 'A skill needs a description'],
    [{ name: 'N', description: 'D' }, 'A skill needs a prompt'],
    [{ name: 'N', description: 'D', prompt: 'P', boards: ['nope'] }, 'Unknown board "nope"'],
  ])('refuses %j', async (payload, error) => {
    const { app } = await openTestProject();
    const res = await app.inject({ method: 'PUT', url: '/api/skills/execute', payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error });
  });

  it('cannot be talked into writing outside the skills folder', async () => {
    // The slug goes through the control-file sandbox, so traversal is refused rather than sanitised.
    const { app } = await openTestProject();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/skills/${encodeURIComponent('../../..')}`,
      payload: { name: 'N', description: 'D', boards: [], columns: [], prompt: 'P' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Path not allowed' });
  });

  it('refuses with 409 when no project is open', async () => {
    const app = testApp(new ProjectSession());
    const res = await app.inject({ method: 'PUT', url: '/api/skills/x', payload: {} });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});
