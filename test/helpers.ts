import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { ProjectSession } from '../src/server/session.js';
import { buildApp } from '../src/server/app.js';

export async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vibeboard-'));
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
  opts: { name?: string; mode?: 'greenfield' | 'brownfield' } = {},
): Promise<TestProject> {
  const session = new ProjectSession();
  const app = buildApp(session);
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
