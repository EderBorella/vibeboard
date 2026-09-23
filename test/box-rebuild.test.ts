import { chmodSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it, onTestFinished } from 'vitest';
import { IDLE_STATE } from '../src/core/autopilot-state.js';
import { buildApp } from '../src/server/app.js';
import { CredentialStore } from '../src/server/auth/credentials.js';
import { ProjectSession } from '../src/server/boards/session.js';
import { BoxManager } from '../src/server/boxes/box-manager.js';
import { buildFrames, rebuildRefusal } from '../src/server/boxes/box-routes.js';
import { BoxService } from '../src/server/boxes/box-service.js';
import { boxName, type DockerRun } from '../src/server/boxes/containers.js';
import { writeAutopilotState } from '../src/store/autopilot-store.js';
import { fixedSandbox, TEST_SANDBOX, tempDir } from './helpers.js';

// POST /api/boxes/rebuild — the only way to be rid of a box that has drifted, because `ensure` adopts a
// healthy one rather than remaking it.
//
// Built with buildApp DIRECTLY rather than through `testApp`, for the reason test/signin-route.test.ts
// and test/app.sandbox.test.ts are: the helper fills an Authorization header in on every request that
// does not bring one, so a test of who may call this would pass while presenting the admin token —
// proving the opposite of what it claims.

const SHIM = join(process.cwd(), 'test', 'fixtures', 'fake-agent.mjs');
// Stryker copies the repo without the executable bit, and a shim that cannot be spawned makes every
// dispatch fail before any mutant exists.
chmodSync(SHIM, 0o755);
// The shim's behaviour travels in the prompt, not the environment, which is shared with every other
// test file in this process.
const HANG = '[[behaviour:hang]]';

const ADMIN = 'admin-token-for-box-rebuild';
const admin = { authorization: `Bearer ${ADMIN}` };

// A BoxService that answers as a daemon holding exactly `present`, and records every `docker rm -f`.
// What went is the assertion here, so it has to be observed rather than assumed: `stop` returns void,
// and a route that called it twice unconditionally would look identical from the outside.
function recordingBoxes(present: string[]): { boxes: BoxService; removed: string[] } {
  const removed: string[] = [];
  const docker: DockerRun = async (args) => {
    if (args[0] === 'ps') return { code: 0, stdout: `${present.join('\n')}\n`, stderr: '' };
    if (args[0] === 'rm') {
      removed.push(String(args[2]));
      return { code: 0, stdout: '', stderr: '' };
    }
    // As helpers.testBoxes answers: no box yet, and no published port for one that did not ask.
    if (args[0] === 'inspect') return { code: 1, stdout: '', stderr: 'No such object' };
    if (args[0] === 'port') return { code: 1, stdout: '', stderr: 'No public port' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const boxes = new BoxService({
    manager: new BoxManager({ docker, user: '1000:1000' }),
    image: 'vibeboard-agent:test',
  });
  return { boxes, removed };
}

interface Ctx {
  app: FastifyInstance;
  root: string;
  credentials: CredentialStore;
  // What the stand-in daemon was actually asked to remove.
  removed: string[];
}

async function open(
  opts: {
    // The boxes the daemon holds, named from the project root the way production names them — so a
    // route computing the name differently finds nothing rather than removing the wrong container.
    present?: (root: string) => string[];
    // An app with NO containers at all. Not a production shape, but it is the one the defensive
    // branch exists for.
    noBoxes?: boolean;
    scaffold?: boolean;
    mode?: 'greenfield' | 'brownfield';
  } = {},
): Promise<Ctx> {
  const root = await tempDir();
  const rec = recordingBoxes(opts.present?.(root) ?? []);
  const session = new ProjectSession();
  const credentials = new CredentialStore(ADMIN);
  const app = buildApp(session, {
    credentials,
    logger: false,
    // Only the run-in-flight test dispatches, but the runner is wired the same way for all of them so
    // no test can accidentally prove a refusal against an app that could not have run anything.
    runBin: SHIM,
    sandbox: fixedSandbox(TEST_SANDBOX),
    ...(opts.noBoxes ? {} : { boxes: rec.boxes }),
  });
  onTestFinished(async () => {
    app.runner.cancelAll();
    await app.close();
    await session.close();
  });
  if (opts.scaffold !== false) {
    const scaffolded = await app.inject({
      method: 'POST',
      url: '/api/project/scaffold',
      headers: admin,
      payload: { path: root, name: 'B', mode: opts.mode ?? 'brownfield' },
    });
    // The fixture asserts its own premise: with no project open every guard reads the permissive
    // branch, and a refusal test would then pass for a reason it is not about.
    if (scaffolded.statusCode !== 200) {
      throw new Error(`could not scaffold ${root}: ${scaffolded.statusCode} ${scaffolded.body}`);
    }
  }
  return { app, root, credentials, removed: rec.removed };
}

const bothBoxes = (root: string): string[] => [boxName(root, 'claude-code'), boxName(root, 'opencode')];

const rebuild = (app: FastifyInstance, headers: Record<string, string> = admin) =>
  app.inject({ method: 'POST', url: '/api/boxes/rebuild', headers });

describe('throwing the boxes away', () => {
  it('removes both backends’ boxes and reports how many went', async () => {
    const { app, root, removed } = await open({ present: bothBoxes });

    const res = await rebuild(app);

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true, removed: 2 });
    expect(removed).toEqual(bothBoxes(root));
  });

  it('does not report a box that was never there', async () => {
    // The half that makes the count worth printing. A project with one box must answer 1 — a constant,
    // or a count taken from the loop rather than from what exists, would answer 2 here.
    const { app, root, removed } = await open({ present: (r) => [boxName(r, 'opencode')] });

    const res = await rebuild(app);

    expect(res.json()).toEqual({ ok: true, removed: 1 });
    expect(removed).toEqual([boxName(root, 'opencode')]);
  });

  it('refuses when there is no project open, so it cannot remove another project’s boxes', async () => {
    const { app } = await open({ scaffold: false, present: bothBoxes });
    const res = await rebuild(app);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('No project open');
  });

  it('refuses rather than reporting success when the server has no containers at all', async () => {
    const { app } = await open({ noBoxes: true });
    const res = await rebuild(app);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('without containers');
  });
});

describe('refused while work is in flight', () => {
  it('names auto-pilot, because that is what has to be stopped first', async () => {
    const { app, root, removed } = await open({ present: bothBoxes });
    await writeAutopilotState(root, { ...IDLE_STATE, state: 'running', at: '2026-08-15T09:00:00.000Z' });

    const res = await rebuild(app);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Auto-pilot is running this project');
    // A refusal that does not say what to do about it is a dead end.
    expect(res.json().error).toContain('auto-pilot panel');
    expect(removed).toEqual([]);
  });

  it('names the running agent, and removes nothing', async () => {
    // A real hanging run rather than a stubbed count: there is no way to make the runner look busy
    // from outside, and asserting against a stub would be a test of the stub.
    const { app, removed } = await open({ mode: 'greenfield', present: bothBoxes });
    const state = (await app.inject({ url: '/api/state', headers: admin })).json() as {
      snapshot: { boards: { engineering: { id: string }[] } };
    };
    const dispatched = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: admin,
      payload: {
        board: 'engineering',
        card: state.snapshot.boards.engineering[0].id,
        skill: 'execute',
        prompt: HANG,
      },
    });
    expect(dispatched.statusCode, dispatched.body).toBe(200);

    const res = await rebuild(app);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('1 agent is running on this project');
    expect(removed).toEqual([]);
  });
});

describe('who may call it', () => {
  // Admin-only by ABSENCE from the scope table in auth.ts, which is the point: nobody had to remember
  // to deny it, and an agent must not be able to destroy the box it is running inside.
  it('refuses a run credential — `service` is the widest scope a run ever gets', async () => {
    const { app, root, credentials } = await open();
    const cred = credentials.mintRun('service', 'run-1', root);
    const res = await rebuild(app, { authorization: `Bearer ${cred.token}` });
    expect(res.statusCode).toBe(403);
  });

  it('refuses with no credential at all', async () => {
    const { app } = await open();
    const res = await app.inject({ method: 'POST', url: '/api/boxes/rebuild' });
    expect(res.statusCode).toBe(401);
  });
});

describe('the refusal sentence', () => {
  it('is silent when nothing is in flight', () => {
    expect(rebuildRefusal({ runs: 0, autopilot: 'idle' })).toBeNull();
  });

  it('counts a queued run, because it starts on its own moments later', () => {
    // The predicate is `activity()` in auth/signin-routes.ts, not a new one: a run waiting for a slot
    // is a dispatch already decided, so a rebuild racing it is the same accident a moment late.
    expect(rebuildRefusal({ runs: 2, autopilot: 'idle' })).toContain('2 agents are running');
  });

  it('puts auto-pilot first, because stopping the runs would not stop it dispatching more', () => {
    expect(rebuildRefusal({ runs: 3, autopilot: 'running' })).toContain('Auto-pilot');
  });
});

// THE FRAMES A BUILD SENDS, and the one that must not be sent. Named rather than inlined for the same
// reason the refusal above is: the whole of the behaviour is which frames come out and in what order,
// and asserting that through a websocket would need a browser to watch it.
describe('the frames a build broadcasts', () => {
  const recorder = () => {
    const sent: { state?: string; line?: string }[] = [];
    return { sent, frames: buildFrames((f) => sent.push(f as { state?: string; line?: string })) };
  };

  it('says nothing at all when both images were already there', () => {
    // The route is idempotent and a person may press the button on a machine with nothing to do. A
    // start followed instantly by a done put every open browser's build log into "running" and out
    // again for a build that never happened — a progress report for no progress.
    const { sent, frames } = recorder();
    frames.finish('present');
    expect(sent).toEqual([]);
  });

  it('opens on the first line of output rather than before it', () => {
    const { sent, frames } = recorder();
    frames.onLine('Building the agent image vibeboard-agent:base.');
    frames.onLine('Step 1/9 : FROM node:22-slim');
    frames.finish('built');
    expect(sent).toEqual([
      { type: 'box:build', state: 'start' },
      { type: 'box:build', line: 'Building the agent image vibeboard-agent:base.' },
      { type: 'box:build', line: 'Step 1/9 : FROM node:22-slim' },
      { type: 'box:build', state: 'done' },
    ]);
  });

  it('closes a build that streamed and then failed as failed', () => {
    const { sent, frames } = recorder();
    frames.onLine('Could not build vibeboard-agent:base: E: Unable to locate package curl');
    frames.finish('failed');
    expect(sent.at(-1)).toEqual({ type: 'box:build', state: 'failed' });
  });
});

// POST /api/boxes/build ON AN IMAGE THAT EXISTS. It used to answer `already` for any image that did, so
// one on Claude Code 2.1.221 under a 2.1.280 host could not be rebuilt from the product at all.
//
// THE HOST IS REAL HERE, and only docker is not. `claude` and `opencode` are scripts on PATH printing
// versions no machine has, so the route's own reader spawns them and parses what they print — a reader
// that ignored PATH, or a route that compared against nothing, would be measured against whatever this
// machine has installed instead. The build spawns the suite's stand-in docker, which answers `build` with
// success.
describe('POST /api/boxes/build', () => {
  const CURRENT = { 'io.vibeboard.cli.claude-code': '9.9.9', 'io.vibeboard.cli.opencode': '8.8.8' };
  const BEHIND = { 'io.vibeboard.cli.claude-code': '2.1.221', 'io.vibeboard.cli.opencode': '8.8.8' };

  async function hostClis(): Promise<void> {
    const bin = await tempDir();
    await writeFile(join(bin, 'claude'), '#!/bin/sh\necho "9.9.9 (Claude Code)"\n', { mode: 0o755 });
    await writeFile(join(bin, 'opencode'), '#!/bin/sh\necho 8.8.8\n', { mode: 0o755 });
    const previous = process.env.PATH;
    process.env.PATH = `${bin}:${previous ?? ''}`;
    onTestFinished(() => {
      process.env.PATH = previous;
    });
  }

  function holding(labels: Record<string, string>): FastifyInstance {
    const docker: DockerRun = async (args) => {
      if (args[0] === 'version') return { code: 0, stdout: '29.6.0\n', stderr: '' };
      if (args[0] === 'image') {
        return {
          code: 0,
          stdout: JSON.stringify([{ Id: 'sha256:0f3c', Config: { Labels: labels } }]),
          stderr: '',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const session = new ProjectSession();
    const app = buildApp(session, {
      credentials: new CredentialStore(ADMIN),
      logger: false,
      sandbox: fixedSandbox(TEST_SANDBOX),
      boxes: new BoxService({
        manager: new BoxManager({ docker, user: '1000:1000' }),
        image: 'vibeboard-agent:test',
      }),
    });
    onTestFinished(async () => {
      await app.close();
      await session.close();
    });
    return app;
  }

  const build = (app: FastifyInstance) =>
    app.inject({ method: 'POST', url: '/api/boxes/build', headers: admin });

  it('rebuilds an image whose CLIs are behind the host, rather than calling it present', async () => {
    await hostClis();
    const res = await build(holding(BEHIND));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, already: false });
  });

  it('leaves alone an image that holds what the host has', async () => {
    await hostClis();
    expect((await build(holding(CURRENT))).json()).toEqual({ ok: true, already: true });
  });
});
