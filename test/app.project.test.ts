import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, relative as relative_ } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectSession } from '../src/server/boards/session.js';
import { scaffoldProject } from '../src/store/project/scaffold.js';
import { openTestProject, tempDir, testApp } from './helpers.js';

let bare: ProjectSession | undefined;
const originalRoot = process.env.VIBEBOARD_ROOT;

afterEach(async () => {
  await bare?.close();
  bare = undefined;
  if (originalRoot === undefined) delete process.env.VIBEBOARD_ROOT;
  else process.env.VIBEBOARD_ROOT = originalRoot;
});

async function app(): Promise<ReturnType<typeof testApp>> {
  bare = new ProjectSession();
  return testApp(bare);
}

// A folder holding one scaffolded project, for the browse endpoint to find.
async function projectsDir(): Promise<{ base: string; name: string }> {
  const base = await tempDir();
  const name = 'findme';
  await mkdir(join(base, name), { recursive: true });
  await scaffoldProject(join(base, name), { name: 'Findme', mode: 'brownfield', today: '2026-07-25' });
  return { base, name };
}

describe('GET /api/projects', () => {
  it('lists projects under an explicitly requested root', async () => {
    const { base, name } = await projectsDir();
    const res = await (await app()).inject({
      method: 'GET',
      url: `/api/projects?root=${encodeURIComponent(base)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((p: { path: string }) => p.path)).toContain(join(base, name));
  });

  it('falls back to VIBEBOARD_ROOT when the query names no root', async () => {
    const { base, name } = await projectsDir();
    process.env.VIBEBOARD_ROOT = base;
    const res = await (await app()).inject({ method: 'GET', url: '/api/projects' });
    expect(res.json().map((p: { path: string }) => p.path)).toContain(join(base, name));
  });

  it('prefers an explicit root over the environment', async () => {
    const wanted = await projectsDir();
    const other = await projectsDir();
    process.env.VIBEBOARD_ROOT = other.base;

    const res = await (await app()).inject({
      method: 'GET',
      url: `/api/projects?root=${encodeURIComponent(wanted.base)}`,
    });
    const paths = res.json().map((p: { path: string }) => p.path);
    expect(paths).toContain(join(wanted.base, wanted.name));
    expect(paths).not.toContain(join(other.base, other.name));
  });

  it('answers with an empty list rather than failing on a root with nothing in it', async () => {
    process.env.VIBEBOARD_ROOT = await tempDir();
    const res = await (await app()).inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('POST /api/project/open', () => {
  it('opens a scaffolded project and returns its snapshot', async () => {
    const { base, name } = await projectsDir();
    const path = join(base, name);
    const res = await (await app()).inject({ method: 'POST', url: '/api/project/open', payload: { path } });

    expect(res.statusCode).toBe(200);
    // The body must carry the snapshot itself — the UI renders straight from it.
    expect(res.json().snapshot).toBeDefined();
    expect(res.json().snapshot.config.name).toBe('Findme');
  });

  it('refuses a folder that is not a project, naming why', async () => {
    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/project/open',
      payload: { path: await tempDir() },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Not a VibeBoard project' });
  });
});

describe('GET /api/state', () => {
  it('reports a closed session before anything is opened', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/state' });
    expect(res.json()).toEqual({ open: false });
  });

  it('carries the snapshot once a project is open', async () => {
    const { app: opened } = await openTestProject({ name: 'St' });
    const res = await opened.inject({ method: 'GET', url: '/api/state' });
    expect(res.json().open).toBe(true);
    expect(res.json().snapshot.config.name).toBe('St');
  });
});

// A PATH THAT IS NOT ABSOLUTE IS NOT THIS SERVER'S TO GUESS AT.
//
// The New Project form takes a free-text parent folder and concatenates it with the name, so
// `data/projects` — one missing leading slash — asked for `data/projects/calculator`. Nothing between
// that field and the filesystem made it absolute or refused it, so Node resolved it against the
// SERVER's working directory and the project was created INSIDE the VibeBoard install.
//
// What that cost, on 2026-08-16, in the order the symptoms arrived:
//
//   * docker refused the box: "data/projects/calculator includes invalid characters for a local volume
//     name" — a relative string is a VOLUME NAME to `docker run -v`, not a host directory;
//   * auto-pilot's pre-flight commit ran in the VibeBoard repository, so the run's progress depended on
//     VibeBoard's own pre-commit hook, and the loop eventually stopped quoting a failure in
//     test/git-work.test.ts — a file that project has never heard of;
//   * the project had no repository of its own, so its box never pinned `.git/hooks` read-only.
//
// REFUSED, NOT RESOLVED, and that is the decision worth stating: `resolve()` here would have produced
// exactly the directory that caused all of the above, silently. The only honest reading of a relative
// path from a browser is that nobody has said where they meant.
describe('a path that is not absolute', () => {
  it('is refused by open, saying what is wrong with it', async () => {
    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/project/open',
      payload: { path: 'data/projects/calculator' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/absolute/i);
  });

  it('is refused by scaffold, and writes nothing', async () => {
    const { base } = await projectsDir();
    // A path relative to THIS process's cwd that would otherwise be created for real.
    const relative = relative_(process.cwd(), join(base, 'would-be-created'));

    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/project/scaffold',
      payload: { path: relative, name: 'would-be-created', mode: 'greenfield' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/absolute/i);
    // The refusal has to come BEFORE anything is written: a project half-created by a request that was
    // then refused is worse than either outcome on its own.
    expect(existsSync(join(base, 'would-be-created'))).toBe(false);
  });
});
