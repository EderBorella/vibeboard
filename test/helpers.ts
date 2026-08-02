import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { onTestFinished } from 'vitest';
import WebSocket from 'ws';
import type { Card } from '../src/core/types.js';
import { buildApp } from '../src/server/app.js';
import { CredentialStore } from '../src/server/credentials.js';
import { probeProfile, type SandboxStatus, wrapCommand } from '../src/server/sandbox.js';
import { ProjectSession } from '../src/server/session.js';

export async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vibeboard-'));
}

// Run a shell command the way an agent turn is run — through the sandbox wrapper, so what the test
// observes is what a real run would hit. The exit code IS the assertion: a denial surfaces as a
// non-zero exit and a message on stderr, never as a thrown error here.
export function sh(status: SandboxStatus, script: string): Promise<{ code: number | null; stderr: string }> {
  const { bin, args } = wrapCommand('/bin/sh', ['-c', script], status);
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
  return join(mkdtempSync(join(tmpdir(), 'vibeboard-shim-')), 'args.log');
}

export const TEST_ADMIN_TOKEN = 'test-admin-token';

// Every agent now needs a sandbox, so every test that dispatches one needs a real profile. This is
// `unprivileged_userns`, which ships with the distribution's own apparmor package and any
// unprivileged process may transition into — so the suite exercises the real gate and the real
// `aa-exec` path, and NO bypass exists in the codebase for anyone to reach for later.
//
// It is not our profile and enforces none of our denies; it is a stand-in for "confined". The
// tests that check what is actually denied load `vibeboard-agent` and are in test/sandbox.test.ts.
// Where AppArmor is absent this is a refusal, and the suites that dispatch will fail rather than
// quietly pass unsandboxed — the cost of one path, paid by contributors off Debian/Ubuntu/SUSE.
export const TEST_SANDBOX: SandboxStatus = await probeProfile('unprivileged_userns');

export interface TestAppOpts {
  runBin?: string;
  logger?: FastifyServerOptions['logger'];
  // Confinement, as the composition root would pass it. Absent means unsandboxed, which is what
  // every suite that is about something else wants.
  sandbox?: SandboxStatus;
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
    credentials: new CredentialStore(TEST_ADMIN_TOKEN),
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
    // Silent unless a test asks otherwise; pass a stream to read back what the subsystems logged.
    logger?: FastifyServerOptions['logger'];
  } = {},
): Promise<TestProject> {
  const session = new ProjectSession();
  const app = testApp(session, { runBin: opts.runBin, logger: opts.logger, sandbox: opts.sandbox });
  const root = await tempDir();
  await app.inject({
    method: 'POST',
    url: '/api/project/scaffold',
    payload: { path: root, name: opts.name ?? 'T', mode: opts.mode ?? 'greenfield' },
  });
  onTestFinished(async () => {
    await app.close();
    await session.close();
  });
  return { app, session, root };
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
