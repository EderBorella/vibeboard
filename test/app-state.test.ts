import { readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import {
  readState,
  rememberProject,
  restoreLastProject,
  stateFile,
  writeState,
} from '../src/server/app-state.js';
import { ProjectSession } from '../src/server/session.js';
import { tempDir } from './helpers.js';

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
  const a = buildApp(s);
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
    await rm(join(root, '.vibeboard'), { recursive: true, force: true });

    session = new ProjectSession();
    expect(await restoreLastProject(session)).toBeUndefined();
    expect(session.isOpen).toBe(false);
  });
});

describe('the server records what you open', () => {
  it('remembers a project opened over HTTP', async () => {
    const root = await scaffolded('Opened');
    session = new ProjectSession();
    app = buildApp(session);
    await app.inject({ method: 'POST', url: '/api/project/open', payload: { path: root } });
    expect((await readState()).lastProject).toBe(root);
  });

  it('does not remember a failed open', async () => {
    const notAProject = await tempDir();
    session = new ProjectSession();
    app = buildApp(session);
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
