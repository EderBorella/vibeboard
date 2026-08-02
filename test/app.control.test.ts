import { afterEach, describe, expect, it } from 'vitest';
import {
  CONFIG_DIR,
  CONFIG_FILE,
  CONVENTIONS_FILE,
  DOCS_DIR,
  INSTRUCTIONS_FILE,
  POINTER_FILES,
  skillRel,
} from '../src/core/layout.js';
import { ProjectSession } from '../src/server/session.js';
import { openTestProject, testApp } from './helpers.js';

const [CLAUDE_MD, AGENTS_MD] = POINTER_FILES;

// Only the "no project open" test builds a session by hand — it must NOT have a project.
let bare: ProjectSession | undefined;

afterEach(async () => {
  await bare?.close();
  bare = undefined;
});

describe('/api/control', () => {
  it('lists instruction files including the scaffolded INSTRUCTIONS.md', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });
    const res = await app.inject({ method: 'GET', url: '/api/control/files' });
    expect(res.statusCode).toBe(200);
    const groups = res.json().groups as Array<{ key: string; files: Array<{ path: string }> }>;
    const instructions = groups.find((g) => g.key === 'instructions')!;
    expect(instructions.files.map((f) => f.path)).toEqual(
      expect.arrayContaining([INSTRUCTIONS_FILE, CLAUDE_MD, AGENTS_MD, CONVENTIONS_FILE]),
    );
  });

  it('creates, reads back, and rejects an out-of-bounds write', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });
    const put = await app.inject({
      method: 'PUT',
      url: '/api/control/file',
      payload: { path: `${DOCS_DIR}/notes.md`, content: '# Notes' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ ok: true });

    const get = await app.inject({
      method: 'GET',
      url: `/api/control/file?path=${encodeURIComponent(`${DOCS_DIR}/notes.md`)}`,
    });
    expect(get.json().content).toBe('# Notes');

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/control/file',
      payload: { path: '../evil.md', content: 'x' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'Path not allowed' });
  });

  it('treats a missing content field as an empty file rather than writing undefined', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });
    const put = await app.inject({
      method: 'PUT',
      url: '/api/control/file',
      payload: { path: `${DOCS_DIR}/blank.md` },
    });
    expect(put.json()).toEqual({ ok: true });

    const get = await app.inject({
      method: 'GET',
      url: `/api/control/file?path=${encodeURIComponent(`${DOCS_DIR}/blank.md`)}`,
    });
    expect(get.json().content).toBe('');
  });

  it('refuses to read a path outside the control plane', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });
    // config.yaml is inside .vibeboard/, which categoryOf() excludes deliberately.
    const res = await app.inject({
      method: 'GET',
      url: `/api/control/file?path=${encodeURIComponent(`${CONFIG_DIR}/${CONFIG_FILE}`)}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Path not allowed' });
  });

  it('round-trips the resources registry', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });
    const put = await app.inject({
      method: 'PUT',
      url: '/api/control/resources',
      payload: { links: [{ title: 'Ref', url: 'https://x.dev' }] },
    });
    expect(put.json()).toEqual({ ok: true });
    const res = await app.inject({ method: 'GET', url: '/api/control/resources' });
    expect(res.json().links).toEqual([{ title: 'Ref', url: 'https://x.dev' }]);
  });

  // A body with no `links` clears the registry instead of failing. Note that the `?? []` fallback
  // is an equivalent mutant — cleanLink drops any non-object, so a non-empty default yields the
  // same empty list. Mutation testing cannot kill it; the behaviour is still worth pinning.
  it('clears the registry when the body carries no links', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });
    await app.inject({
      method: 'PUT',
      url: '/api/control/resources',
      payload: { links: [{ title: 'Ref', url: 'https://x.dev' }] },
    });

    const put = await app.inject({ method: 'PUT', url: '/api/control/resources', payload: {} });
    expect(put.json()).toEqual({ ok: true });
    const res = await app.inject({ method: 'GET', url: '/api/control/resources' });
    expect(res.json().links).toEqual([]);
  });
});

describe('/api/control/create', () => {
  it('creates a doc under a default, collision-free name', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });

    const first = await app.inject({
      method: 'POST',
      url: '/api/control/create',
      payload: { category: 'docs' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({
      path: `${DOCS_DIR}/new-doc.md`,
      name: 'new-doc.md',
      category: 'docs',
      managed: false,
      deletable: true,
    });

    // Clicking + again must not collide: "New doc" -> "New doc 2".
    const second = await app.inject({
      method: 'POST',
      url: '/api/control/create',
      payload: { category: 'docs' },
    });
    expect(second.json().path).toBe(`${DOCS_DIR}/new-doc-2.md`);
  });

  it('creates a skill as a folder holding SKILL.md, with starter frontmatter', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/control/create',
      payload: { category: 'skills' },
    });
    expect(res.json()).toMatchObject({ path: skillRel('new-skill', 'SKILL.md'), name: 'new-skill' });

    const body = await app.inject({
      method: 'GET',
      url: `/api/control/file?path=${encodeURIComponent(skillRel('new-skill', 'SKILL.md'))}`,
    });
    expect(body.json().content).toContain('name: new-skill');
  });

  it('refuses a category that cannot be created in', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });
    // The four instruction files are fixed — there is no "new instruction".
    const res = await app.inject({
      method: 'POST',
      url: '/api/control/create',
      payload: { category: 'instructions' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Cannot create in that category' });
  });
});

describe('/api/control/rename', () => {
  it('renames a doc, slugging the display name', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });
    await app.inject({ method: 'POST', url: '/api/control/create', payload: { category: 'docs' } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/control/rename',
      payload: { path: `${DOCS_DIR}/new-doc.md`, name: 'Design notes' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ path: `${DOCS_DIR}/design-notes.md`, name: 'design-notes.md' });

    const gone = await app.inject({ method: 'GET', url: '/api/control/files' });
    const docs = gone.json().groups.find((g: { key: string }) => g.key === 'docs');
    expect(docs.files.map((f: { path: string }) => f.path)).toContain(`${DOCS_DIR}/design-notes.md`);
    expect(docs.files.map((f: { path: string }) => f.path)).not.toContain(`${DOCS_DIR}/new-doc.md`);
  });

  it('409s rather than clobbering a name already in use', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });
    await app.inject({ method: 'POST', url: '/api/control/create', payload: { category: 'docs' } });
    await app.inject({ method: 'POST', url: '/api/control/create', payload: { category: 'docs' } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/control/rename',
      payload: { path: `${DOCS_DIR}/new-doc-2.md`, name: 'New doc' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'That name is already used' });
  });

  it('refuses to rename an instruction file', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/control/rename',
      payload: { path: INSTRUCTIONS_FILE, name: 'Something else' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Cannot rename that file' });
  });

  it('refuses a new name that slugs to nothing', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });
    await app.inject({ method: 'POST', url: '/api/control/create', payload: { category: 'docs' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/control/rename',
      payload: { path: `${DOCS_DIR}/new-doc.md`, name: '///' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Cannot rename that file' });
  });
});

describe('DELETE /api/control/file', () => {
  it('deletes a created doc', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });
    await app.inject({ method: 'POST', url: '/api/control/create', payload: { category: 'docs' } });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/control/file?path=${encodeURIComponent(`${DOCS_DIR}/new-doc.md`)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const list = await app.inject({ method: 'GET', url: '/api/control/files' });
    const docs = list.json().groups.find((g: { key: string }) => g.key === 'docs');
    expect(docs.files).toEqual([]);
  });

  it('separates a path violation from a file that exists but is protected', async () => {
    const { app } = await openTestProject({ name: 'Ctl' });

    const outside = await app.inject({
      method: 'DELETE',
      url: `/api/control/file?path=${encodeURIComponent('../evil.md')}`,
    });
    expect(outside.statusCode).toBe(400);
    expect(outside.json()).toEqual({ error: 'Path not allowed' });

    // Instruction files resolve fine but are never deletable — a distinct message.
    const protectedFile = await app.inject({
      method: 'DELETE',
      url: `/api/control/file?path=${encodeURIComponent(INSTRUCTIONS_FILE)}`,
    });
    expect(protectedFile.statusCode).toBe(400);
    expect(protectedFile.json()).toEqual({ error: 'This file cannot be deleted' });
  });
});

// Every control route is behind ensureOpen. Without this the guards are executed but never
// constrained, so removing any one of them would go unnoticed.
describe('control routes with no project open', () => {
  const DOC = `${DOCS_DIR}/x.md`;
  const routes = [
    { method: 'GET' as const, url: '/api/control/files' },
    { method: 'GET' as const, url: `/api/control/file?path=${encodeURIComponent(DOC)}` },
    { method: 'PUT' as const, url: '/api/control/file', payload: { path: DOC, content: 'x' } },
    { method: 'POST' as const, url: '/api/control/create', payload: { category: 'docs' } },
    { method: 'POST' as const, url: '/api/control/rename', payload: { path: DOC, name: 'y' } },
    { method: 'DELETE' as const, url: `/api/control/file?path=${encodeURIComponent(DOC)}` },
    { method: 'GET' as const, url: '/api/control/resources' },
    { method: 'PUT' as const, url: '/api/control/resources', payload: { links: [] } },
  ];

  it.each(routes)('409s on $method $url', async ({ method, url, payload }) => {
    bare = new ProjectSession();
    const app = testApp(bare);
    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'No project open' });
    await app.close();
  });
});
