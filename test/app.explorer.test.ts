import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { boardColumnSlugs } from '../src/core/board.js';
import { readConfig } from '../src/core/config.js';
import { boardRel, CONFIG_DIR, INSTRUCTIONS_FILE, POINTER_FILES, SKILLS_DIR } from '../src/core/layout.js';
import { buildApp } from '../src/server/app.js';
import type { DirListing, FileRead } from '../src/server/explorer-list.js';
import { ProjectSession } from '../src/server/session.js';
import { openTestProject } from './helpers.js';

const [CLAUDE_MD] = POINTER_FILES;

// The Explorer's HTTP surface. The module tests cover what each function decides; these cover the
// codes and messages the UI actually branches on.
let bare: ProjectSession | undefined;

afterEach(async () => {
  await bare?.close();
  bare = undefined;
});

describe('GET /api/explorer/list', () => {
  it('lists the project root when no path is given', async () => {
    const { app } = await openTestProject({ name: 'E' });
    const res = await app.inject({ method: 'GET', url: '/api/explorer/list' });
    expect(res.statusCode).toBe(200);
    const listing = res.json() as DirListing;
    expect(listing.path).toBe('');
    expect(listing.parent).toBeNull();
    const names = listing.entries.map((e) => e.name);
    // A scaffolded project: the CLI pointer file that has to stay at the root, and the one folder
    // holding everything else, both visible.
    expect(names).toContain(CLAUDE_MD);
    expect(names).toContain(CONFIG_DIR);
  });

  it('lists a subdirectory', async () => {
    const { app } = await openTestProject({ name: 'E' });
    const res = await app.inject({
      method: 'GET',
      url: `/api/explorer/list?path=${encodeURIComponent(SKILLS_DIR)}`,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as DirListing).parent).toBe(CONFIG_DIR);
  });

  it('400s on traversal, a missing directory, and a file', async () => {
    const { app } = await openTestProject({ name: 'E' });
    for (const path of ['../..', 'nope', INSTRUCTIONS_FILE]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/explorer/list?path=${encodeURIComponent(path)}`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Not a directory in this project' });
    }
  });
});

describe('GET /api/explorer/file', () => {
  it('returns a text file with its content', async () => {
    const { app, root } = await openTestProject({ name: 'E' });
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'note.md'), '# note\n', 'utf8');
    const res = await app.inject({ method: 'GET', url: '/api/explorer/file?path=docs/note.md' });
    expect(res.statusCode).toBe(200);
    expect(res.json() as FileRead).toEqual({
      kind: 'text',
      path: 'docs/note.md',
      name: 'note.md',
      size: 7,
      content: '# note\n',
    });
  });

  it('reports a binary file rather than sending it as text', async () => {
    const { app, root } = await openTestProject({ name: 'E' });
    await writeFile(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x47]));
    const res = await app.inject({ method: 'GET', url: '/api/explorer/file?path=logo.png' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ kind: 'binary', path: 'logo.png', name: 'logo.png', size: 4 });
  });

  it('400s with "Not a file" for a directory, and "Path not allowed" for anything refused', async () => {
    // Two different messages because they are two different problems: one is a wrong click, the
    // other is a path the server will not touch.
    const { app } = await openTestProject({ name: 'E' });
    // `.vibeboard` really exists in a scaffolded project — a directory that does NOT exist is refused
    // as a path, not reported as a non-file, which is the distinction being asserted here.
    const dir = await app.inject({
      method: 'GET',
      url: `/api/explorer/file?path=${encodeURIComponent(CONFIG_DIR)}`,
    });
    expect(dir.statusCode).toBe(400);
    expect(dir.json()).toEqual({ error: 'Not a file' });

    for (const path of ['../../etc/passwd', 'gone.md', '']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/explorer/file?path=${encodeURIComponent(path)}`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Path not allowed' });
    }
  });
});

describe('PUT /api/explorer/file', () => {
  it('saves a text file', async () => {
    const { app, root } = await openTestProject({ name: 'E' });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/explorer/file',
      payload: { path: INSTRUCTIONS_FILE, content: '# mine\n' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await readFile(join(root, INSTRUCTIONS_FILE), 'utf8')).toBe('# mine\n');
  });

  it('reaches a card file, which Project Control cannot', async () => {
    // The point of the tab: the board's own markdown is part of the project, and the watcher pushes
    // a snapshot when it changes, so an edit here shows up on the board.
    const { app, root } = await openTestProject({ name: 'E' });
    // The column the scaffold seeded, not a named one: 'todo' left this listing empty and the
    // `toBeDefined` below was the only thing that noticed.
    const [column] = boardColumnSlugs(await readConfig(root), 'features');
    const listing = await app.inject({
      method: 'GET',
      url: `/api/explorer/list?path=${encodeURIComponent(boardRel('features', column))}`,
    });
    const card = (listing.json() as DirListing).entries.find((e) => e.name.endsWith('.md'));
    expect(card).toBeDefined();

    const res = await app.inject({
      method: 'PUT',
      url: '/api/explorer/file',
      payload: { path: card?.path, content: '---\ntitle: Edited\n---\n' },
    });
    expect(res.statusCode).toBe(200);
    expect(await readFile(join(root, card?.path ?? ''), 'utf8')).toContain('title: Edited');
  });

  it('refuses to overwrite a file it could not show, with a message saying why', async () => {
    const { app, root } = await openTestProject({ name: 'E' });
    await writeFile(join(root, 'logo.png'), Buffer.from([0x89, 0x00, 0x4e]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/explorer/file',
      payload: { path: 'logo.png', content: 'clobbered' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'This file is not editable text — refusing to overwrite it',
    });
    expect(await readFile(join(root, 'logo.png'))).toEqual(Buffer.from([0x89, 0x00, 0x4e]));
  });

  it('400s on a path it will not touch', async () => {
    const { app } = await openTestProject({ name: 'E' });
    for (const path of ['../escape.md', '', CONFIG_DIR]) {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/explorer/file',
        payload: { path, content: 'x' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Path not allowed' });
    }
  });
});

describe('POST /api/explorer/create', () => {
  it('creates a file and a folder in the root, and reports them back', async () => {
    const { app } = await openTestProject({ name: 'E' });
    const file = await app.inject({
      method: 'POST',
      url: '/api/explorer/create',
      payload: { parent: '', kind: 'file' },
    });
    expect(file.statusCode).toBe(200);
    expect(file.json()).toEqual({ path: 'Untitled.md', name: 'Untitled.md', kind: 'file', size: 0 });

    const dir = await app.inject({
      method: 'POST',
      url: '/api/explorer/create',
      payload: { parent: '', kind: 'dir' },
    });
    expect(dir.json()).toEqual({ path: 'New folder', name: 'New folder', kind: 'dir' });
  });

  it('400s on a kind it does not make, or a parent it cannot use', async () => {
    const { app } = await openTestProject({ name: 'E' });
    for (const payload of [
      { parent: '', kind: 'symlink' },
      { parent: '', kind: undefined },
      { parent: INSTRUCTIONS_FILE, kind: 'file' },
      { parent: '../..', kind: 'file' },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/explorer/create', payload });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Cannot create that here' });
    }
  });
});

describe('POST /api/explorer/rename and /move', () => {
  it('renames a file', async () => {
    const { app, root } = await openTestProject({ name: 'E' });
    await writeFile(join(root, 'old.md'), 'body', 'utf8');
    const res = await app.inject({
      method: 'POST',
      url: '/api/explorer/rename',
      payload: { path: 'old.md', name: 'new.md' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ path: 'new.md', name: 'new.md', kind: 'file' });
    expect(await readFile(join(root, 'new.md'), 'utf8')).toBe('body');
  });

  it('moves a file into a folder', async () => {
    const { app, root } = await openTestProject({ name: 'E' });
    await writeFile(join(root, 'a.md'), 'body', 'utf8');
    await mkdir(join(root, 'docs'), { recursive: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/explorer/move',
      payload: { path: 'a.md', to: 'docs' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ path: 'docs/a.md' });
  });

  it('409s on a collision, with a message about the name', async () => {
    const { app, root } = await openTestProject({ name: 'E' });
    await writeFile(join(root, 'a.md'), 'a', 'utf8');
    await writeFile(join(root, 'b.md'), 'b', 'utf8');
    const res = await app.inject({
      method: 'POST',
      url: '/api/explorer/rename',
      payload: { path: 'a.md', name: 'b.md' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'Something with that name is already there' });
  });

  it('400s on a folder moved inside itself, distinctly from any other refusal', async () => {
    const { app, root } = await openTestProject({ name: 'E' });
    await mkdir(join(root, 'a', 'b'), { recursive: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/explorer/move',
      payload: { path: 'a', to: 'a/b' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'A folder cannot be moved inside itself' });
  });

  it('400s on a name that is really a path, and on the project root', async () => {
    const { app, root } = await openTestProject({ name: 'E' });
    await writeFile(join(root, 'a.md'), 'a', 'utf8');
    // `docs` has to EXIST for this to pin anything: without it, a rename to "docs/a.md" would be
    // refused for having no destination folder, and the assertion would pass even with the guard
    // removed. Verified by planting exactly that.
    await mkdir(join(root, 'docs'), { recursive: true });
    for (const payload of [
      { path: 'a.md', name: 'docs/a.md' },
      { path: 'a.md', name: '' },
      { path: '', name: 'x.md' },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/explorer/rename', payload });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Path not allowed' });
    }
  });
});

describe('DELETE /api/explorer/entry and /tree', () => {
  it('deletes a file, and an empty folder', async () => {
    const { app, root } = await openTestProject({ name: 'E' });
    await writeFile(join(root, 'a.md'), 'a', 'utf8');
    await mkdir(join(root, 'empty'), { recursive: true });

    for (const path of ['a.md', 'empty']) {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/explorer/entry?path=${encodeURIComponent(path)}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    }
    // Names, not objects: `toContain(expect.objectContaining(...))` compares by equality and would
    // have passed whether or not anything was deleted.
    const listing = await app.inject({ method: 'GET', url: '/api/explorer/list' });
    const names = (listing.json() as DirListing).entries.map((e) => e.name);
    expect(names).not.toContain('a.md');
    expect(names).not.toContain('empty');
  });

  it('409s on a folder with contents — the cue to ask the harder question', async () => {
    const { app, root } = await openTestProject({ name: 'E' });
    await mkdir(join(root, 'full'), { recursive: true });
    await writeFile(join(root, 'full', 'x.md'), 'x', 'utf8');
    const res = await app.inject({ method: 'DELETE', url: '/api/explorer/entry?path=full' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'This folder is not empty' });
    expect(await readFile(join(root, 'full', 'x.md'), 'utf8')).toBe('x');
  });

  it('deletes a whole folder when the typed name matches', async () => {
    const { app, root } = await openTestProject({ name: 'E' });
    await mkdir(join(root, 'attic', 'deep'), { recursive: true });
    await writeFile(join(root, 'attic', 'deep', 'x.md'), 'x', 'utf8');
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/explorer/tree?path=attic&confirm=attic',
    });
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/explorer/list?path=attic' })).statusCode).toBe(400); // no longer a directory in this project
  });

  it('400s on the wrong typed name, and keeps the folder', async () => {
    const { app, root } = await openTestProject({ name: 'E' });
    await mkdir(join(root, 'attic'), { recursive: true });
    await writeFile(join(root, 'attic', 'x.md'), 'x', 'utf8');
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/explorer/tree?path=attic&confirm=Attic',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'That is not the name of this folder' });
    expect(await readFile(join(root, 'attic', 'x.md'), 'utf8')).toBe('x');
  });

  it('400s on the project root, whichever route is asked', async () => {
    const { app, root } = await openTestProject({ name: 'E' });
    for (const url of ['/api/explorer/entry?path=', '/api/explorer/tree?path=&confirm=']) {
      const res = await app.inject({ method: 'DELETE', url });
      expect(res.statusCode).toBe(400);
    }
    // Still a project: the config folder and its instructions are where they were.
    const listing = await app.inject({ method: 'GET', url: '/api/explorer/list' });
    expect((listing.json() as DirListing).entries.map((e) => e.name)).toContain(CONFIG_DIR);
    expect(await readFile(join(root, INSTRUCTIONS_FILE), 'utf8')).not.toBe('');
  });
});

describe('explorer routes with no project open', () => {
  const routes = [
    { method: 'GET' as const, url: '/api/explorer/list' },
    {
      method: 'GET' as const,
      url: `/api/explorer/file?path=${encodeURIComponent(INSTRUCTIONS_FILE)}`,
    },
    {
      method: 'PUT' as const,
      url: '/api/explorer/file',
      payload: { path: INSTRUCTIONS_FILE, content: 'x' },
    },
    { method: 'POST' as const, url: '/api/explorer/create', payload: { parent: '', kind: 'file' } },
    {
      method: 'POST' as const,
      url: '/api/explorer/rename',
      payload: { path: 'a.md', name: 'b.md' },
    },
    { method: 'POST' as const, url: '/api/explorer/move', payload: { path: 'a.md', to: 'docs' } },
    { method: 'DELETE' as const, url: '/api/explorer/entry?path=a.md' },
    { method: 'DELETE' as const, url: '/api/explorer/tree?path=docs&confirm=docs' },
  ];

  it.each(routes)('409s on $method $url', async ({ method, url, payload }) => {
    bare = new ProjectSession();
    const app = buildApp(bare);
    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'No project open' });
    await app.close();
  });
});
