import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import WebSocket from 'ws';
import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tempDir } from './helpers.js';
import { ProjectSession } from '../src/server/session.js';
import { buildApp } from '../src/server/app.js';
import type { FastifyInstance } from 'fastify';

const here = dirname(fileURLToPath(import.meta.url));
const SHIM = join(here, 'fixtures', 'fake-claude.mjs');

let session: ProjectSession | undefined;
let app: FastifyInstance | undefined;

beforeAll(() => {
  chmodSync(SHIM, 0o755);
  process.env.VIBEBOARD_CLAUDE_BIN = SHIM;
});

afterEach(async () => {
  await app?.close();
  await session?.close();
  app = undefined;
  session = undefined;
});

interface Item { kind: string; text: string; toolName?: string }
interface Msg { type: string; items?: Item[]; chats?: { id: string; title: string }[]; currentChatId?: string }

// A /ws client that records messages and lets tests await a predicate over them.
function connect(address: string): {
  ws: WebSocket; messages: Msg[]; open: Promise<void>;
  waitFor: (pred: (m: Msg[]) => boolean) => Promise<void>;
} {
  const ws = new WebSocket(`${address.replace('http', 'ws')}/ws`);
  const messages: Msg[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (d) => { messages.push(JSON.parse(d.toString())); waiters.forEach((w) => w()); });
  const open = new Promise<void>((r) => ws.on('open', () => r()));
  const waitFor = (pred: (m: Msg[]) => boolean): Promise<void> =>
    new Promise((resolve) => { if (pred(messages)) return resolve(); waiters.push(() => { if (pred(messages)) resolve(); }); });
  return { ws, messages, open, waitFor };
}

const lastHistory = (m: Msg[]): Msg | undefined => [...m].reverse().find((x) => x.type === 'copilot:history');

describe('copilot chat history over /ws', () => {
  it('persists a turn, replays it to a new connection, and supports new/delete', async () => {
    session = new ProjectSession();
    app = buildApp(session);
    const root = await tempDir();
    await app.inject({ method: 'POST', url: '/api/project/scaffold', payload: { path: root, name: 'Co', mode: 'greenfield' } });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });

    // First client: history on connect is empty, then a turn is recorded.
    const c1 = connect(address);
    await c1.open;
    await c1.waitFor((m) => m.some((x) => x.type === 'copilot:history'));
    expect(lastHistory(c1.messages)!.items).toEqual([]);

    c1.ws.send(JSON.stringify({ type: 'copilot:send', text: 'hi', mode: 'plan' }));
    // After the turn, a copilot:chats update lists the new chat titled from the first message.
    await c1.waitFor((m) => m.some((x) => x.type === 'copilot:chats' && (x.chats ?? []).some((c) => c.title === 'hi')));

    // A brand-new connection replays the persisted transcript (user 'hi' + assistant 'fresh').
    const c2 = connect(address);
    await c2.open;
    await c2.waitFor((m) => m.some((x) => x.type === 'copilot:history' && (x.items ?? []).length >= 2));
    const replay = lastHistory(c2.messages)!;
    expect(replay.items).toEqual([
      { kind: 'user', text: 'hi' },
      { kind: 'assistant', text: 'fresh' },
    ]);
    const hiChatId = replay.currentChatId!;

    // New chat: broadcast history with empty items and a different current id; old chat retained.
    c1.ws.send(JSON.stringify({ type: 'copilot:new' }));
    await c1.waitFor((m) => { const h = lastHistory(m); return !!h && h.currentChatId !== hiChatId && (h.items ?? []).length === 0; });
    const afterNew = lastHistory(c1.messages)!;
    expect(afterNew.chats!.some((c) => c.id === hiChatId)).toBe(true);

    // Delete the old chat: it disappears from the list.
    c1.ws.send(JSON.stringify({ type: 'copilot:delete', chatId: hiChatId }));
    await c1.waitFor((m) => { const h = lastHistory(m); return !!h && !(h.chats ?? []).some((c) => c.id === hiChatId); });

    c1.ws.close();
    c2.ws.close();
  }, 10000);
});
