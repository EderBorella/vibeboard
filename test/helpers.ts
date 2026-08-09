import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { onTestFinished } from 'vitest';
import WebSocket from 'ws';
import type { Card } from '../src/core/types.js';
import { buildApp } from '../src/server/app.js';
import { BoxManager } from '../src/server/box-manager.js';
import { BoxService } from '../src/server/box-service.js';
import type { DockerRun } from '../src/server/containers.js';
import { type Credential, CredentialStore } from '../src/server/credentials.js';
import { type SandboxStatus, wrapCommand } from '../src/server/sandbox.js';
import type { ServiceCommand } from '../src/server/service-process.js';
import { ProjectSession } from '../src/server/session.js';

// Every temp directory the suite makes goes inside the run's own root (vitest.config.ts), which is
// removed when the run ends. Before that, each of these leaked forever: 440,653 of them accumulated
// over four weeks and filled the filesystem's inode table, after which an arbitrary single test would
// fail with ENOSPC while the rest passed.
//
// Falls back to the system temp dir so a file run outside the vitest config still works, rather than
// failing on a missing variable.
export function testTmp(): string {
  return process.env.VIBEBOARD_TEST_TMP ?? tmpdir();
}

export async function tempDir(): Promise<string> {
  return mkdtemp(join(testTmp(), 'vibeboard-'));
}

// Run a shell command the way an agent turn is run — through the sandbox wrapper, so what the test
// observes is what a real run would hit. The exit code IS the assertion: a denial surfaces as a
// non-zero exit and a message on stderr, never as a thrown error here.
//
// `box` is required whenever `status` is ok, exactly as it is in production: the wrapper throws
// rather than quietly returning an unconfined command, and a helper that hid that would let a test
// prove containment against a command that was never contained.
export function sh(
  status: SandboxStatus,
  script: string,
  box?: string,
): Promise<{ code: number | null; stderr: string }> {
  const { bin, args } = wrapCommand('/bin/sh', ['-c', script], status, box);
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    // A missing `aa-exec` emits 'error', not a non-zero exit, and an unhandled one kills the worker
    // rather than failing the test. Resolved like any other refusal, which is what the caller means.
    child.on('error', (err) => resolve({ code: -1, stderr: String(err) }));
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

// The mutation layer returns `'unknown-column'` rather than throwing. Fixtures that name a
// configured column have to say so somewhere, and one narrowing helper beats a non-null cast at
// every use site: a sentinel here means the fixture is wrong, and it says which.
export function cardFrom(result: Card | 'unknown-column'): Card {
  if (result === 'unknown-column') throw new Error('fixture named a column the board does not have');
  return result;
}

// Where fake-claude.mjs records the args it was spawned with. One log per process, outside the
// repo: the shim appends and the tests index the log by position, so a shared path silently
// interleaves other processes' args — which is what made Stryker's verdicts non-deterministic
// across its parallel workers.
export function shimArgsLog(): string {
  return join(mkdtempSync(join(testTmp(), 'vibeboard-shim-')), 'args.log');
}

export const TEST_ADMIN_TOKEN = 'test-admin-token';

// Every agent needs a sandbox, so every test that dispatches one needs a status that says so. The
// suite still travels the REAL wrapping — `wrapCommand` builds a genuine `docker exec` argv and the
// spawn really happens — because `VIBEBOARD_DOCKER_BIN` points docker at test/fake-docker.mjs, which
// strips the exec prefix and runs the rest on the host. There is no bypass inside `wrapCommand` for
// anyone to reach for later; the seam is the binary, and the argv stays under assertion.
//
// What is deliberately NOT simulated is the isolation itself. That is checked against a real
// container in test/box-integration.test.ts, which skips when docker or the image is absent.
export const TEST_SANDBOX: SandboxStatus = { ok: true, image: 'vibeboard-agent:test' };

// The path to the stand-in, resolved from this file so it survives whatever the cwd is.
export const FAKE_DOCKER = fileURLToPath(new URL('./fake-docker.mjs', import.meta.url));

// Point the whole process at it. Called from the suite's setup file, once, rather than per test —
// process-wide state set in a beforeEach races every other file sharing the worker.
export function useFakeDocker(): void {
  process.env.VIBEBOARD_DOCKER_BIN = FAKE_DOCKER;
}

// A BoxService whose docker is the stand-in: `ensure` answers with a real box name, computed the real
// way, without a daemon. Tests that dispatch an agent pass this alongside TEST_SANDBOX.
export function testBoxes(): BoxService {
  return new BoxService({
    manager: new BoxManager({ docker: fakeDockerRun, user: '1000:1000' }),
    image: 'vibeboard-agent:test',
  });
}

// Answers as a healthy daemon with NO box yet: every `ensure` creates, which is one no-op call here
// and keeps the digest out of it. Reporting a running box would mean reporting a spec digest too —
// adoption checks it now — and a helper that guessed wrong would silently rebuild on every call.
const fakeDockerRun: DockerRun = async (args) => {
  if (args[0] === 'inspect') return { code: 1, stdout: '', stderr: 'No such object' };
  // Only for a box that ASKED to publish. Answering unconditionally is what let a box created
  // without `-p` look like one that had it, which hid a real failure in the OpenCode server path.
  if (args[0] === 'port') return { code: 1, stdout: '', stderr: 'No public port' };
  return { code: 0, stdout: '', stderr: '' };
};

export interface TestAppOpts {
  runBin?: string;
  serviceCommand?: () => ServiceCommand;
  logger?: FastifyServerOptions['logger'];
  // Passed in when a test needs to mint a run credential of its own — the service loop reaches the board
  // over HTTP with a `service` token, so testing it means holding the same store the app checks against.
  credentials?: CredentialStore;
  // Confinement, as the composition root would pass it. Absent means unsandboxed, which is what
  // every suite that is about something else wants.
  sandbox?: SandboxStatus;
  boxes?: BoxService | null;
}

// buildApp, plus the browser's credential on every request that does not bring its own. Auth is not
// what these suites are about, and threading a header through several hundred inject() calls would
// bury the assertions in ceremony. The hook fills the header in rather than bypassing the check, so
// the boundary still runs on every one of them — and test/auth.test.ts builds its app with
// buildApp directly, which is what keeps the boundary itself under test.
export function testApp(session: ProjectSession, opts: TestAppOpts = {}): FastifyInstance {
  // `?? TEST_SANDBOX`, not a spread default: openTestProject forwards `sandbox: opts.sandbox`,
  // which is an explicit `undefined` when the caller named none — and an explicit undefined wins
  // over a spread default. That silently disabled every dispatch in the suite.
  const app = buildApp(session, {
    ...opts,
    sandbox: opts.sandbox ?? TEST_SANDBOX,
    // Paired with the sandbox for the same reason it is in production: a status that says "confined"
    // and no box to be confined IN makes `wrapCommand` throw. Coupling them here means a test cannot
    // accidentally build the one without the other.
    // `null` means "no containers", explicitly. `undefined` means "the caller did not say", which
    // gets the default — every test that dispatches an agent needs one, because a sandbox with no box
    // to be confined in makes the wrapper throw.
    boxes: opts.boxes === null ? undefined : (opts.boxes ?? testBoxes()),
    credentials: opts.credentials ?? new CredentialStore(TEST_ADMIN_TOKEN),
  });
  app.addHook('onRequest', async (req) => {
    req.headers.authorization ??= `Bearer ${TEST_ADMIN_TOKEN}`;
  });
  return app;
}

export interface TestProject {
  app: FastifyInstance;
  session: ProjectSession;
  root: string;
  // A run credential for this project, for tests about what an agent or the service may do. The admin
  // header is filled in automatically for every other request, so this is only needed when the SCOPE is
  // the point. The store itself is deliberately NOT returned: nothing destructured it, and a field no test
  // exercises is one more thing to keep true for no one.
  mint: (scope: 'work' | 'checkup' | 'service', run: string, card?: string) => Credential;
}

// The setup most route tests re-typed by hand: a temp folder, scaffolded and opened, with an
// app bound to its session. `mode: 'brownfield'` skips the sample cards, for tests that need
// to own the board.
//
// Teardown is registered with the runner instead of each file's afterEach, so the watcher and
// the server are closed even when an assertion throws half way through a test. That means it
// must be called from inside a test, not from beforeAll.
export async function openTestProject(
  opts: {
    name?: string;
    mode?: 'greenfield' | 'brownfield';
    runBin?: string;
    sandbox?: SandboxStatus;
    // Where agents run. A BoxService to record what docker was asked for; `null` for an app with NO
    // containers at all, which is not a production shape but is what the defensive branches expect.
    boxes?: BoxService | null;
    // What to spawn for the auto-pilot loop. Tests put a shim here and read back what the process was
    // actually given.
    serviceCommand?: () => ServiceCommand;
    // Silent unless a test asks otherwise; pass a stream to read back what the subsystems logged.
    logger?: FastifyServerOptions['logger'];
  } = {},
): Promise<TestProject> {
  const session = new ProjectSession();
  const credentials = new CredentialStore(TEST_ADMIN_TOKEN);
  const app = testApp(session, {
    runBin: opts.runBin,
    logger: opts.logger,
    sandbox: opts.sandbox,
    // Forwarded explicitly, and `null` forwarded as `null`: an explicit undefined would fall through
    // to testApp's default, which is exactly how `sandbox` once silently disabled every dispatch in
    // the suite (see the note there).
    boxes: opts.boxes,
    credentials,
    ...(opts.serviceCommand ? { serviceCommand: opts.serviceCommand } : {}),
  });
  const root = await tempDir();
  const scaffolded = await app.inject({
    method: 'POST',
    url: '/api/project/scaffold',
    payload: { path: root, name: opts.name ?? 'T', mode: opts.mode ?? 'greenfield' },
  });
  // The fixture asserts its own premise, because a silent failure here DISARMS the test that follows
  // rather than failing it: with no project open `session.root` is undefined, and every guard that
  // reads it short-circuits to the permissive branch — `autopilot.current()` to `IDLE_STATE`, so an
  // S7 refusal test sees 400 instead of 409 and blames the guard. Found by a reviewer chasing exactly
  // that symptom.
  if (scaffolded.statusCode !== 200) {
    throw new Error(
      `openTestProject could not scaffold ${root}: ${scaffolded.statusCode} ${scaffolded.body}`,
    );
  }
  onTestFinished(async () => {
    await app.close();
    await session.close();
  });
  return {
    app,
    session,
    root,
    mint: (scope, run, card) => credentials.mintRun(scope, run, root, card),
  };
}

export interface WsTestClient<M> {
  ws: WebSocket;
  messages: M[];
  open: Promise<void>;
  // Resolves with the first message satisfying `pred`, whether it has already arrived or not.
  waitFor: (pred: (m: M) => boolean) => Promise<M>;
  // Resolves once the messages received so far satisfy `pred` — for conditions about the
  // transcript as a whole, such as "the latest history message has two items".
  waitUntil: (pred: (all: M[]) => boolean) => Promise<void>;
  send: (payload: object) => void;
  close: () => void;
}

// A /ws client that records every message and lets a test await a condition over them.
// Replaces the messages/waiters/waitFor trio that four test files each hand-rolled; the
// message type stays the caller's, so assertions remain as specific as they were.
export function wsClient<M = Record<string, unknown>>(address: string): WsTestClient<M> {
  const ws = new WebSocket(`${address.replace('http', 'ws')}/ws`);
  const messages: M[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (data) => {
    messages.push(JSON.parse(data.toString()) as M);
    for (const w of waiters) w();
  });
  const open = new Promise<void>((resolve) => ws.on('open', () => resolve()));

  const waitUntil = (pred: (all: M[]) => boolean): Promise<void> =>
    new Promise((resolve) => {
      if (pred(messages)) return resolve();
      waiters.push(() => {
        if (pred(messages)) resolve();
      });
    });
  const waitFor = async (pred: (m: M) => boolean): Promise<M> => {
    await waitUntil((all) => all.some(pred));
    return messages.find(pred)!;
  };

  return {
    ws,
    messages,
    open,
    waitFor,
    waitUntil,
    send: (payload) => ws.send(JSON.stringify(payload)),
    close: () => ws.close(),
  };
}
