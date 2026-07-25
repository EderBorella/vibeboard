import { describe, it, expect, beforeAll } from 'vitest';
import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openTestProject, wsClient } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const SHIM = join(here, 'fixtures', 'fake-claude.mjs');

beforeAll(() => {
  chmodSync(SHIM, 0o755);
  process.env.VIBEBOARD_CLAUDE_BIN = SHIM;
});

interface Item { kind: string; text: string; toolName?: string }
interface Msg { type: string; items?: Item[]; chats?: { id: string; title: string }[]; currentChatId?: string }

const lastHistory = (m: Msg[]): Msg | undefined => [...m].reverse().find((x) => x.type === 'copilot:history');

describe('copilot chat history over /ws', () => {
  it('persists a turn, replays it to a new connection, and supports new/delete', async () => {
    const { app } = await openTestProject({ name: 'Co' });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });

    // First client: history on connect is empty, then a turn is recorded.
    const c1 = wsClient<Msg>(address);
    await c1.open;
    await c1.waitUntil((m) => m.some((x) => x.type === 'copilot:history'));
    expect(lastHistory(c1.messages)!.items).toEqual([]);

    c1.send({ type: 'copilot:send', text: 'hi', mode: 'plan' });
    // After the turn, a copilot:chats update lists the new chat titled from the first message.
    await c1.waitUntil((m) => m.some((x) => x.type === 'copilot:chats' && (x.chats ?? []).some((c) => c.title === 'hi')));

    // A brand-new connection replays the persisted transcript (user 'hi' + assistant 'fresh').
    const c2 = wsClient<Msg>(address);
    await c2.open;
    await c2.waitUntil((m) => m.some((x) => x.type === 'copilot:history' && (x.items ?? []).length >= 2));
    const replay = lastHistory(c2.messages)!;
    expect(replay.items).toEqual([
      { kind: 'user', text: 'hi' },
      { kind: 'assistant', text: 'fresh' },
    ]);
    const hiChatId = replay.currentChatId!;

    // New chat: broadcast history with empty items and a different current id; old chat retained.
    c1.send({ type: 'copilot:new' });
    await c1.waitUntil((m) => { const h = lastHistory(m); return !!h && h.currentChatId !== hiChatId && (h.items ?? []).length === 0; });
    const afterNew = lastHistory(c1.messages)!;
    expect(afterNew.chats!.some((c) => c.id === hiChatId)).toBe(true);

    // Delete the old chat: it disappears from the list.
    c1.send({ type: 'copilot:delete', chatId: hiChatId });
    await c1.waitUntil((m) => { const h = lastHistory(m); return !!h && !(h.chats ?? []).some((c) => c.id === hiChatId); });

    c1.close();
    c2.close();
  }, 10000);
});
