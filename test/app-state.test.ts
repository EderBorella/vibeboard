import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { CONFIG_DIR } from '../src/core/layout.js';
import {
  debugLogging,
  readState,
  rememberProject,
  restoreLastProject,
  setDebugLogging,
  stateFile,
  writeState,
} from '../src/server/app-state.js';
import { ProjectSession } from '../src/server/session.js';
import { tempDir, testApp } from './helpers.js';

let session: ProjectSession | undefined;
let app: FastifyInstance | undefined;
const original = process.env.VIBEBOARD_STATE_FILE;

beforeEach(async () => {
  // Each test gets its own state file so they can't see each other's.
  process.env.VIBEBOARD_STATE_FILE = join(await tempDir(), 'state.json');
});

afterEach(async () => {
  await app?.close();
  await session?.close();
  app = undefined;
  session = undefined;
  process.env.VIBEBOARD_STATE_FILE = original;
});

async function scaffolded(name = 'Remembered'): Promise<string> {
  const root = await tempDir();
  const s = new ProjectSession();
  const a = testApp(s);
  await a.inject({
    method: 'POST',
    url: '/api/project/scaffold',
    payload: { path: root, name, mode: 'greenfield' },
  });
  await a.close();
  await s.close();
  return root;
}

describe('app state file', () => {
  it('returns {} when the file is missing', async () => {
    expect(await readState()).toEqual({});
  });

  it('returns {} on corrupt or unexpected content rather than throwing', async () => {
    await writeFile(stateFile(), 'not json at all', 'utf8');
    expect(await readState()).toEqual({});
    await writeFile(stateFile(), '[1,2,3]', 'utf8');
    expect(await readState()).toEqual({});
    await writeFile(stateFile(), '{"lastProject":42}', 'utf8');
    expect(await readState()).toEqual({});
  });

  it('round-trips the last project', async () => {
    await writeState({ lastProject: '/some/project' });
    expect(await readState()).toEqual({ lastProject: '/some/project' });
  });

  // The file is VibeBoard's alone — nothing else writes it — so it is validated on read and
  // rewritten wholesale. Unrecognised keys are intentionally not carried over.
  it('rememberProject replaces the last project and drops unknown keys', async () => {
    await writeFile(stateFile(), JSON.stringify({ lastProject: '/old', strayKey: true }), 'utf8');
    await rememberProject('/new');
    const raw = JSON.parse(await readFile(stateFile(), 'utf8'));
    expect(raw).toEqual({ lastProject: '/new' });
  });
});

// The app-level debug switch: whether the auto-pilot loop's ordinary output is kept as well as its errors.
// Here rather than in a project's config.yaml because the logs are VibeBoard's own folder, and a debug
// switch in the user's document would also be forgotten the moment they switched project.
describe('the debug logging setting', () => {
  it('round-trips, and is off when nothing has been said', async () => {
    expect(await debugLogging()).toBe(false);
    await setDebugLogging(true);
    expect(await debugLogging()).toBe(true);
    await setDebugLogging(false);
    expect(await debugLogging()).toBe(false);
  });

  // The two settings share ONE file, so each writer has to preserve the other's field. Written as a
  // wholesale overwrite, opening a project would silently turn the switch off.
  it('survives a project being opened, and does not disturb it', async () => {
    await setDebugLogging(true);
    await rememberProject('/some/project');
    expect(await readState()).toEqual({ lastProject: '/some/project', debugLog: true });

    await setDebugLogging(false);
    expect(await readState()).toEqual({ lastProject: '/some/project', debugLog: false });
  });

  // Each field validated on its own. Read through a single ternary over `lastProject` — which is what this
  // did — a file holding one nonsense value discarded the other, so a typo in the state file would forget
  // which project you had open.
  it('ignores a non-boolean without discarding the rest of the file', async () => {
    await writeFile(stateFile(), '{"lastProject":"/p","debugLog":"yes"}', 'utf8');
    expect(await readState()).toEqual({ lastProject: '/p' });
  });

  // It THROWS rather than swallowing, and that is the point of the split: a switch that reports success and
  // changes nothing is worse than one that says it could not save. `rememberProject` keeps the old
  // behaviour, because remembering a project is a convenience that must never fail an open.
  it('reports a write it could not make, where remembering a project does not', async () => {
    process.env.VIBEBOARD_STATE_FILE = join(await tempDir(), 'no-such-dir', 'x', 'state.json');
    const readOnly = dirname(dirname(process.env.VIBEBOARD_STATE_FILE));
    await mkdir(readOnly, { recursive: true });
    await chmod(readOnly, 0o500);
    onTestFinished(() => chmod(readOnly, 0o700));

    await expect(setDebugLogging(true)).rejects.toThrow();
    await expect(rememberProject('/p')).resolves.toBeUndefined();
  });
});

describe('restoreLastProject', () => {
  it('reopens a project that is still valid', async () => {
    const root = await scaffolded();
    await rememberProject(root);

    session = new ProjectSession();
    expect(await restoreLastProject(session)).toBe(root);
    expect(session.isOpen).toBe(true);
    expect(session.config!.name).toBe('Remembered');
  });

  it('does nothing when no project was remembered', async () => {
    session = new ProjectSession();
    expect(await restoreLastProject(session)).toBeUndefined();
    expect(session.isOpen).toBe(false);
  });

  it('does nothing when the remembered project no longer exists', async () => {
    await rememberProject('/no/such/place');
    session = new ProjectSession();
    expect(await restoreLastProject(session)).toBeUndefined();
    expect(session.isOpen).toBe(false);
  });

  it('does nothing when the folder is no longer a VibeBoard project', async () => {
    const root = await scaffolded();
    await rememberProject(root);
    await rm(join(root, CONFIG_DIR), { recursive: true, force: true });

    session = new ProjectSession();
    expect(await restoreLastProject(session)).toBeUndefined();
    expect(session.isOpen).toBe(false);
  });
});

describe('the server records what you open', () => {
  it('remembers a project opened over HTTP', async () => {
    const root = await scaffolded('Opened');
    session = new ProjectSession();
    app = testApp(session);
    await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: root } });
    expect((await readState()).lastProject).toBe(root);
  });

  it('does not remember a failed open', async () => {
    const notAProject = await tempDir();
    session = new ProjectSession();
    app = testApp(session);
    const res = await app.inject({
      method: 'POST',
      url: '/api/project/open',
      payload: { path: notAProject },
    });
    expect(res.statusCode).toBe(400);
    expect(await readState()).toEqual({});
  });
});

describe('stateFile and readState defaults', () => {
  it('falls back to ~/.vibeboard/state.json when no override is set', () => {
    delete process.env.VIBEBOARD_STATE_FILE;
    const path = stateFile();
    expect(path.endsWith(join('.vibeboard', 'state.json'))).toBe(true);
    expect(path.startsWith(homedir())).toBe(true);
  });

  it('honours the override when one is set', () => {
    process.env.VIBEBOARD_STATE_FILE = '/tmp/explicit-state.json';
    expect(stateFile()).toBe('/tmp/explicit-state.json');
  });

  it.each(['null', '42', '"a string"', '[]', 'true'])(
    'reads an empty state from the non-object payload %p',
    async (payload) => {
      const file = join(await tempDir(), 'state.json');
      process.env.VIBEBOARD_STATE_FILE = file;
      await writeFile(file, payload, 'utf8');
      expect(await readState()).toEqual({});
    },
  );

  it.each([['{"lastProject":42}'], ['{"lastProject":null}'], ['{"other":"x"}']])(
    'ignores a lastProject that is not a string: %s',
    async (payload) => {
      const file = join(await tempDir(), 'state.json');
      process.env.VIBEBOARD_STATE_FILE = file;
      await writeFile(file, payload, 'utf8');
      expect(await readState()).toEqual({});
    },
  );

  it('reads back a string lastProject and nothing else', async () => {
    const file = join(await tempDir(), 'state.json');
    process.env.VIBEBOARD_STATE_FILE = file;
    await writeFile(file, '{"lastProject":"/p","junk":1}', 'utf8');
    expect(await readState()).toEqual({ lastProject: '/p' });
  });
});
