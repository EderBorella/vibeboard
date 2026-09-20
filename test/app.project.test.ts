import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, join, relative as relative_ } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IDLE_STATE } from '../src/core/autopilot-state.js';
import { CONFIG_DIR, CONFIG_FILE } from '../src/core/layout.js';
import { ProjectSession } from '../src/server/boards/session.js';
import { projectStateDir } from '../src/server/boxes/copilot-env.js';
import { rememberProject } from '../src/server/settings/app-state.js';
import { writeAutopilotState } from '../src/store/autopilot-store.js';
import { scaffoldProject } from '../src/store/project/scaffold.js';
import { openTestProject, tempDir, testApp } from './helpers.js';

let bare: ProjectSession | undefined;
const originalRoot = process.env.VIBEBOARD_ROOT;
// The delete tests point this at a temp file. Restored per test, or one of them writes the developer's
// real `~/.vibeboard/state.json` and forgets whatever project they had open.
const originalStateFile = process.env.VIBEBOARD_STATE_FILE;

afterEach(async () => {
  await bare?.close();
  bare = undefined;
  if (originalRoot === undefined) delete process.env.VIBEBOARD_ROOT;
  else process.env.VIBEBOARD_ROOT = originalRoot;
  if (originalStateFile === undefined) delete process.env.VIBEBOARD_STATE_FILE;
  else process.env.VIBEBOARD_STATE_FILE = originalStateFile;
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

// WHAT SCAFFOLD ANSWERS WHEN THE PROJECT IT HAS JUST WRITTEN WILL NOT OPEN. The open route has always
// caught this and said what was wrong; scaffold let the throw out as a raw 500. That was survivable
// while the only caller was a form sitting on a screen with a board behind it — the wizard is the
// caller now, and its identity step is the one screen in the product with no project behind it at all,
// where a 500 reads as the app having crashed rather than as a request having failed.
describe('POST /api/project/scaffold, when the project it wrote will not open', () => {
  it('answers the refusal the open route answers, rather than a 500', async () => {
    bare = new ProjectSession();
    // INJECTED AT THE ONE SEAM A TEST CAN REACH, and nothing else here is faked: the folder, the
    // board and the git repository are really written, and what is being read is the route's answer
    // to a failure after all of that. There is no cheap way to make a freshly scaffolded folder
    // genuinely unopenable inside one request — everything that would do it fails the scaffold first.
    bare.open = () => Promise.reject(new Error('the folder cannot be read'));
    const base = await tempDir();
    const path = join(base, 'made-then-unopenable');

    const res = await testApp(bare).inject({
      method: 'POST',
      url: '/api/project/scaffold',
      payload: { path, name: 'made-then-unopenable', mode: 'greenfield' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Not a VibeBoard project' });
    // And it really did get as far as writing one, or this would be a test of the guard above it.
    expect(existsSync(join(path, CONFIG_DIR, CONFIG_FILE))).toBe(true);
  });
});

// POST /api/project/delete — the only recursive delete a user can aim, and the tests that matter are
// the ones about what it REFUSES. A wrong path here is a `rm -rf` of whatever the server can reach.
describe('POST /api/project/delete', () => {
  const del = (a: Awaited<ReturnType<typeof app>>, path: string, name?: string) =>
    a.inject({ method: 'POST', url: '/api/project/delete', payload: { path, name } });

  it('removes a project, its agent state, and the folder itself', async () => {
    const { root, app: a, session } = await openTestProject();
    const state = projectStateDir(root);
    mkdirSync(state, { recursive: true });
    await session.close();

    const res = await del(a, root, basename(root));

    expect(res.statusCode).toBe(200);
    expect(existsSync(root)).toBe(false);
    // The remainder the entry is really about: state outside the project, findable only by digest.
    expect(existsSync(state)).toBe(false);
  });

  // THE GUARD, and it is the whole reason this module exists rather than a one-line `rm`. Asserted
  // against a real directory that is NOT a project, because the failure being prevented is deleting one.
  it('refuses a directory that is not a VibeBoard project, and removes nothing', async () => {
    const a = await app();
    const notAProject = await tempDir();
    writeFileSync(join(notAProject, 'important.txt'), 'do not delete me', 'utf8');

    const res = await del(a, notAProject, basename(notAProject));

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('.vibeboard/config.yaml');
    expect(existsSync(join(notAProject, 'important.txt'))).toBe(true);
  });

  // AND IT REFUSES BEFORE IT LETS GO. Raised in review: the marker check ran AFTER the session was
  // closed, the copilot credential revoked and both boxes removed, so a project whose config.yaml had
  // gone missing since it was opened answered 400 with the server left holding no open project.
  it('leaves the open project open when it refuses', async () => {
    const { root, app: a, session } = await openTestProject();
    // The marker gone, the folder still there — what a half-deleted or hand-edited project looks like.
    rmSync(join(root, CONFIG_DIR, CONFIG_FILE), { force: true });

    const res = await del(a, root, basename(root));

    expect(res.statusCode).toBe(400);
    // STILL OPEN. This is the assertion the ordering is about; the 400 above passed before the fix too.
    // STILL OPEN. This is the assertion the ordering is about; the 400 above passed before the fix too.
    // Asserted on the session rather than through `GET /api/state`, which cannot answer here at all: it
    // builds a snapshot, and the snapshot reads the very config.yaml this fixture removed.
    expect(session.isOpen).toBe(true);
    expect(existsSync(root)).toBe(true);
  });

  // TYPED ON THE SERVER, not only in the dialog. A confirmation that lives in the browser is one the
  // API does not have, and this is the call that destroys somebody's work.
  it('refuses when the typed name does not match the folder', async () => {
    const { root, app: a, session } = await openTestProject();
    await session.close();

    expect((await del(a, root, 'something-else')).statusCode).toBe(400);
    expect((await del(a, root)).statusCode).toBe(400); // and none at all is not a match either
    expect(existsSync(root)).toBe(true);
  });

  it('refuses a relative path before it resolves it against VibeBoard’s own folder', async () => {
    const res = await del(await app(), 'projects/mine', 'mine');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('absolute');
  });

  // Deleting the ground out from under a live run manufactures the dead-box failure on purpose: a
  // container bind-mounted at a directory that stops existing answers every exec with an OCI error.
  it('refuses while auto-pilot is running', async () => {
    const { root, app: a } = await openTestProject();
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running', iteration: 3 });

    const res = await del(a, root, basename(root));

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Soft-stop');
    expect(existsSync(root)).toBe(true);
  });

  // The open project is CLOSED first — its watcher is on a directory about to be removed — and the
  // remembered project is cleared, or the next start reopens a folder that is gone.
  it('closes the open project and forgets it', async () => {
    const stateFile = join(await tempDir(), 'state.json');
    process.env.VIBEBOARD_STATE_FILE = stateFile;
    const { root, app: a } = await openTestProject();
    await rememberProject(root);

    const res = await del(a, root, basename(root));

    expect(res.statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: '/api/state' })).json().open).toBe(false);
    expect(JSON.parse(readFileSync(stateFile, 'utf8')).lastProject).toBeUndefined();
  });

  // A DIFFERENT project's memory is not forgotten. Without this the assertion above passes against a
  // `forgetProject` that simply clears the field whatever it holds.
  it('leaves another project’s memory alone', async () => {
    const stateFile = join(await tempDir(), 'state.json');
    process.env.VIBEBOARD_STATE_FILE = stateFile;
    const { root, app: a, session } = await openTestProject();
    await session.close();
    await rememberProject('/somewhere/else');

    await del(a, root, basename(root));

    expect(JSON.parse(readFileSync(stateFile, 'utf8')).lastProject).toBe('/somewhere/else');
  });
});
