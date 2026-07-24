import { describe, it, expect } from 'vitest';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers.js';
import { ChatStore } from '../src/server/chat-store.js';
import { defaultConfig } from '../src/core/config.js';
import type { ProjectConfig } from '../src/core/types.js';
import type { CopilotEvent } from '../src/server/copilot-events.js';

interface Ref { root: string | undefined; config: ProjectConfig | undefined }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function fresh(overrides: Partial<ProjectConfig> = {}): Promise<{ ref: Ref; store: ChatStore; chatDir: string }> {
  const root = await tempDir();
  const config = { ...defaultConfig('t'), ...overrides };
  const ref: Ref = { root, config };
  return { ref, store: new ChatStore(ref), chatDir: join(root, '.vibeboard', 'chat') };
}

const resultEvent = (sessionId: string, costUsd = 0.01): CopilotEvent => ({
  kind: 'result', sessionId,
  stats: { ok: true, text: '', costUsd, durationMs: 1200, turns: 1, contextTokens: 3000, outputTokens: 50 },
});

describe('ChatStore', () => {
  it('coalesces a turn into user + assistant items and updates stats', async () => {
    const { store } = await fresh();
    await store.recordUser('hello there');
    await store.recordEvent({ kind: 'usage', contextTokens: 3000 });
    await store.recordEvent({ kind: 'text', text: 'hi back' });
    await store.recordEvent(resultEvent('cli-1'));

    const h = await store.historyPayload();
    expect(h.items).toEqual([
      { kind: 'user', text: 'hello there' },
      { kind: 'assistant', text: 'hi back' },
    ]);
    expect(h.stats.contextTokens).toBe(3000);
    expect(h.stats.turns).toBe(1);
    expect(h.stats.costUsd).toBeCloseTo(0.01);
  });

  it('records tool_use as a tool item and ignores streaming deltas', async () => {
    const { store } = await fresh();
    await store.recordUser('make a card');
    await store.recordEvent({ kind: 'block_start', block: 'text' });
    await store.recordEvent({ kind: 'text_delta', text: 'wor' });
    await store.recordEvent({ kind: 'text_delta', text: 'king' });
    await store.recordEvent({ kind: 'block_stop' });
    await store.recordEvent({ kind: 'tool_use', id: 't1', name: 'Write', input: {} });
    await store.recordEvent({ kind: 'text', text: 'done' });

    const h = await store.historyPayload();
    expect(h.items).toEqual([
      { kind: 'user', text: 'make a card' },
      { kind: 'tool', text: '', toolName: 'Write' },
      { kind: 'assistant', text: 'done' },
    ]);
  });

  it('derives the title from the first user message', async () => {
    const { store } = await fresh();
    await store.recordUser('Investigate the flaky test in scheduler');
    await store.recordUser('second message');
    const { chats, currentChatId } = await store.chatList();
    const meta = chats.find((c) => c.id === currentChatId)!;
    expect(meta.title).toBe('Investigate the flaky test in scheduler');
  });

  it('persists to disk and a new store reloads the most-recent chat', async () => {
    const { ref, store, chatDir } = await fresh();
    await store.recordUser('remember me');
    await store.recordEvent({ kind: 'text', text: 'ok' });
    await store.recordEvent(resultEvent('cli-42'));
    await store.flush();

    const files = await readdir(chatDir);
    expect(files.length).toBe(1);

    const reopened = new ChatStore(ref);
    const h = await reopened.historyPayload();
    expect(h.items).toEqual([
      { kind: 'user', text: 'remember me' },
      { kind: 'assistant', text: 'ok' },
    ]);
    // cliSessionId survives the round-trip (used for resume on open).
    const info = await reopened.open(h.currentChatId!);
    expect(info?.cliSessionId).toBe('cli-42');
  });

  it('newChat retains the previous chat and starts an empty one', async () => {
    const { store, chatDir } = await fresh();
    await store.recordUser('first chat');
    await store.flush();
    await store.newChat();
    await store.recordUser('second chat');
    await store.flush();

    const files = await readdir(chatDir);
    expect(files.length).toBe(2);
    const { chats } = await store.chatList();
    expect(chats.map((c) => c.title).sort()).toEqual(['first chat', 'second chat']);
  });

  it('prunes to keepChats, never deleting the active chat', async () => {
    const { store, chatDir } = await fresh({ keepChats: 2 });
    for (const t of ['one', 'two', 'three']) {
      await store.newChat();
      await store.recordUser(t);
      await store.flush();
      await sleep(8); // distinct updatedAt so ordering is deterministic
    }
    const files = await readdir(chatDir);
    expect(files.length).toBe(2); // 'one' pruned, 'two' + 'three' kept

    const { chats, currentChatId } = await store.chatList();
    const titles = chats.map((c) => c.title);
    expect(titles).toContain('three');
    expect(titles).not.toContain('one');
    expect(chats.some((c) => c.id === currentChatId && c.title === 'three')).toBe(true);
  });

  it('lists chats newest-first', async () => {
    const { store } = await fresh();
    await store.recordUser('older'); await store.flush(); await sleep(8);
    await store.newChat();
    await store.recordUser('newer'); await store.flush();
    const { chats } = await store.chatList();
    expect(chats[0].title).toBe('newer');
    expect(chats[1].title).toBe('older');
  });

  it('deletes a chat; deleting the current one starts a fresh chat', async () => {
    const { store, chatDir } = await fresh();
    await store.recordUser('doomed');
    await store.flush();
    const { currentChatId } = await store.chatList();
    const { wasCurrent } = await store.delete(currentChatId!);
    expect(wasCurrent).toBe(true);
    expect(await readdir(chatDir)).toEqual([]);

    const after = await store.chatList();
    expect(after.currentChatId).not.toBe(currentChatId);
    expect(after.chats.filter((c) => c.id === currentChatId)).toEqual([]);
  });

  it('surfaces a one-shot note when reopening under a different backend', async () => {
    const { ref, store } = await fresh(); // created under claude-code
    await store.recordUser('claude chat');
    await store.flush();
    const { currentChatId } = await store.chatList();
    await store.newChat();

    ref.config = { ...ref.config!, copilot: { ...ref.config!.copilot, backend: 'opencode' } };
    const info = await store.open(currentChatId!);
    expect(info?.backend).toBe('claude-code');

    const h = await store.historyPayload();
    expect(h.note).toMatch(/opencode/);
    expect(h.items.at(-1)).toMatchObject({ kind: 'error' });
    // note is one-shot: gone on the next payload
    const h2 = await store.historyPayload();
    expect(h2.note).toBeUndefined();
  });
});
