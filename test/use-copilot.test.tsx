// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// A stand-in for the shared socket: keeps the subscribers so a test can push events, and records
// what the hook sends. vi.hoisted because vi.mock's factory runs before the module body.
// Keyed by bump like the real useSharedWs, so a bump change hands the hook a genuinely different
// socket. Without that the mock returns one object forever, every dependency array is trivially
// stable, and nothing can tell a correct dep list from a frozen one.
const h = vi.hoisted(() => {
  const make = () => {
    const handlers = new Set<(m: unknown) => void>();
    return {
      handlers,
      sent: [] as object[],
      subscribe(fn: (m: unknown) => void) {
        handlers.add(fn);
        return () => handlers.delete(fn);
      },
      send(payload: object) {
        this.sent.push(payload);
      },
    };
  };
  const byBump = new Map<number, ReturnType<typeof make>>();
  return {
    byBump,
    get(bump: number) {
      let s = byBump.get(bump);
      if (!s) {
        s = make();
        byBump.set(bump, s);
      }
      return s;
    },
  };
});

vi.mock('../web/src/ws.js', () => ({ useSharedWs: (bump: number) => h.get(bump) }));

import { useCopilot } from '../web/src/copilot/useCopilot.js';

const fake = h.get(0);

const emit = (msg: unknown): void => {
  act(() => {
    for (const fn of fake.handlers) fn(msg);
  });
};
const event = (e: object): void => emit({ type: 'copilot:event', event: e });

beforeEach(() => {
  for (const s of h.byBump.values()) {
    s.handlers.clear();
    s.sent.length = 0;
  }
});

describe('useCopilot transcript', () => {
  it('appends a finalised assistant message', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'text', text: 'hello' });
    expect(result.current.items).toMatchObject([{ kind: 'assistant', text: 'hello' }]);
  });

  it('streams deltas into one bubble and ignores the finalised copy', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'block_start', block: 'text' });
    event({ kind: 'text_delta', text: 'par' });
    event({ kind: 'text_delta', text: 'tial' });
    // The backend also sends the whole message at the end; counting it would duplicate the text.
    event({ kind: 'text', text: 'partial' });
    expect(result.current.items).toMatchObject([{ kind: 'assistant', text: 'partial' }]);
  });

  it('records a tool call as its own item', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'tool_use', name: 'Edit' });
    expect(result.current.items).toMatchObject([{ kind: 'tool', toolName: 'Edit' }]);
  });

  it('ignores thinking and tool results', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'thinking', text: 'hmm' });
    event({ kind: 'thinking_delta', text: 'hmm' });
    event({ kind: 'tool_result', text: 'output' });
    expect(result.current.items).toEqual([]);
  });

  it('gives every item a distinct id', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'text', text: 'a' });
    event({ kind: 'text', text: 'b' });
    const ids = result.current.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('useCopilot stats', () => {
  it('takes context occupancy from the latest usage event', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'usage', contextTokens: 100 });
    event({ kind: 'usage', contextTokens: 250 });
    expect(result.current.stats.contextTokens).toBe(250);
  });

  it('ignores a usage event with no token count', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'usage', contextTokens: 100 });
    event({ kind: 'usage' });
    expect(result.current.stats.contextTokens).toBe(100);
  });

  it('accumulates cost and turns across results, keeping only the latest duration', () => {
    const { result } = renderHook(() => useCopilot(0));
    const stats = (costUsd: number, turns: number, durationMs: number) => ({
      costUsd,
      turns,
      durationMs,
      contextTokens: 0,
    });
    event({ kind: 'result', stats: stats(0.5, 1, 100) });
    event({ kind: 'result', stats: stats(0.25, 2, 400) });
    expect(result.current.stats).toMatchObject({ costUsd: 0.75, turns: 3, lastDurationMs: 400 });
  });

  it('leaves stats alone for a result carrying none', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'result' });
    expect(result.current.stats).toMatchObject({ costUsd: 0, turns: 0 });
  });

  it('keeps the turn count a number when the backend reports none', () => {
    // OpenCode has no turn count to give, so its result event omits `turns` rather than claiming 1.
    // Added to the running total unguarded, that put NaN in the footer readout.
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'result', stats: { costUsd: 0.5, durationMs: 2011, contextTokens: 12_354 } });
    expect(result.current.stats).toMatchObject({ costUsd: 0.5, turns: 0, lastDurationMs: 2011 });
  });
});

describe('useCopilot socket messages', () => {
  it('tracks running state, session and model', () => {
    const { result } = renderHook(() => useCopilot(0));
    emit({ type: 'copilot:state', state: { running: true, sessionId: 'ses_1', model: 'opus' } });
    expect(result.current.running).toBe(true);
    expect(result.current.sessionId).toBe('ses_1');
    expect(result.current.model).toBe('opus');
  });

  it('replaces the transcript when history arrives', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'text', text: 'live' });
    emit({
      type: 'copilot:history',
      chats: [],
      currentChatId: 'c1',
      items: [{ kind: 'user', text: 'restored' }],
      stats: { costUsd: 1, turns: 2, lastDurationMs: 3, contextTokens: 4 },
    });
    expect(result.current.items).toMatchObject([{ kind: 'user', text: 'restored' }]);
    expect(result.current.stats.costUsd).toBe(1);
    expect(result.current.currentChatId).toBe('c1');
  });

  it('surfaces an error as a transcript item', () => {
    const { result } = renderHook(() => useCopilot(0));
    emit({ type: 'copilot:error', error: 'backend died' });
    expect(result.current.items).toMatchObject([{ kind: 'error', text: 'backend died' }]);
  });

  it('ignores a board snapshot arriving on the same socket', () => {
    const { result } = renderHook(() => useCopilot(0));
    emit({ type: 'snapshot', snapshot: { name: 'x' } });
    expect(result.current.items).toEqual([]);
  });
});

describe('useCopilot sending', () => {
  it('sends a turn with its options and echoes the user message', () => {
    const { result } = renderHook(() => useCopilot(0));
    act(() => result.current.send('do it', { mode: 'plan', backend: 'opencode' }));
    expect(fake.sent).toMatchObject([{ type: 'copilot:send', text: 'do it', mode: 'plan', backend: 'opencode' }]);
    expect(result.current.items).toMatchObject([{ kind: 'user', text: 'do it' }]);
  });

  it('refuses to send blank text', () => {
    const { result } = renderHook(() => useCopilot(0));
    act(() => result.current.send('   ', { mode: 'plan' }));
    expect(fake.sent).toEqual([]);
    expect(result.current.items).toEqual([]);
  });

  it('clears the transcript on a new session', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'text', text: 'old' });
    act(() => result.current.newSession());
    expect(result.current.items).toEqual([]);
    expect(fake.sent).toMatchObject([{ type: 'copilot:new' }]);
  });
});

describe('useCopilot event dispatch', () => {
  it.each([
    ['thinking', { kind: 'thinking', text: 'reasoning' }],
    ['thinking_delta', { kind: 'thinking_delta', text: 'reasoning' }],
    ['tool_result', { kind: 'tool_result', text: 'noisy output' }],
  ])('renders nothing for a %s event', (_label, e) => {
    const { result } = renderHook(() => useCopilot(0));
    event(e);
    expect(result.current.items).toEqual([]);
  });

  it('records the session id and model from init', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'init', sessionId: 's-9', model: 'opus', permissionMode: 'plan' });
    expect(result.current.sessionId).toBe('s-9');
    expect(result.current.model).toBe('opus');
  });

  it('opens a stream only for a text block, not a thinking or tool_use one', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'block_start', block: 'thinking' });
    event({ kind: 'block_start', block: 'tool_use' });
    expect(result.current.items).toEqual([]);

    event({ kind: 'block_start', block: 'text' });
    event({ kind: 'text_delta', text: 'streamed' });
    expect(result.current.items).toMatchObject([{ kind: 'assistant', text: 'streamed' }]);
  });

  it('suppresses a finalised text once deltas have been seen, to avoid printing it twice', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'block_start', block: 'text' });
    event({ kind: 'text_delta', text: 'streamed' });
    event({ kind: 'block_stop' });
    event({ kind: 'text', text: 'streamed' }); // the same content arriving whole
    expect(result.current.items).toMatchObject([{ kind: 'assistant', text: 'streamed' }]);
  });

  it('names the tool on a tool_use and closes any open stream', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'block_start', block: 'text' });
    event({ kind: 'text_delta', text: 'about to call' });
    event({ kind: 'tool_use', id: 't1', name: 'Edit', input: {} });
    event({ kind: 'text_delta', text: 'after' });
    // The stream was closed, so the trailing delta starts a NEW assistant item.
    expect(result.current.items).toMatchObject([
      { kind: 'assistant', text: 'about to call' },
      { kind: 'tool', toolName: 'Edit' },
      { kind: 'assistant', text: 'after' },
    ]);
  });

  it('treats a missing text on a delta or a finalised block as empty', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'text' });
    expect(result.current.items).toMatchObject([{ kind: 'assistant', text: '' }]);
  });

  it('surfaces a server error as an error item', () => {
    const { result } = renderHook(() => useCopilot(0));
    emit({ type: 'copilot:error', error: 'boom' });
    expect(result.current.items).toMatchObject([{ kind: 'error', text: 'boom' }]);
  });

  it('gives every item a distinct id, increasing as they arrive', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'text', text: 'a' });
    event({ kind: 'text', text: 'b' });
    event({ kind: 'text', text: 'c' });
    const ids = result.current.items.map((i: { id: number }) => i.id);
    expect(new Set(ids).size).toBe(3);
    expect([...ids].sort((x, y) => x - y)).toEqual(ids);
  });
});

describe('useCopilot wire payloads', () => {
  it.each([
    ['cancel', (r: Record<string, (...a: unknown[]) => void>) => r.cancel(), { type: 'copilot:cancel' }],
    ['newSession', (r: Record<string, (...a: unknown[]) => void>) => r.newSession(), { type: 'copilot:new' }],
    [
      'deleteChat',
      (r: Record<string, (...a: unknown[]) => void>) => r.deleteChat('c-1'),
      { type: 'copilot:delete', chatId: 'c-1' },
    ],
    [
      'openChat',
      (r: Record<string, (...a: unknown[]) => void>) => r.openChat('c-2', 'opencode'),
      { type: 'copilot:open', chatId: 'c-2', backend: 'opencode' },
    ],
  ])('%s sends the exact payload', (_label, call, expected) => {
    const { result } = renderHook(() => useCopilot(0));
    act(() => call(result.current as unknown as Record<string, (...a: unknown[]) => void>));
    expect(fake.sent).toEqual([expected]);
  });

  it('carries the turn options on send and on compact, and echoes the user turn', () => {
    const { result } = renderHook(() => useCopilot(0));
    const opts = { mode: 'plan', backend: 'claude-code', model: 'opus', effort: 'high' };

    act(() => result.current.send('do it', opts));
    expect(fake.sent).toEqual([{ type: 'copilot:send', text: 'do it', ...opts }]);
    expect(result.current.items).toMatchObject([{ kind: 'user', text: 'do it' }]);

    act(() => result.current.compact(opts));
    expect(fake.sent[1]).toEqual({ type: 'copilot:compact', ...opts });
    expect(result.current.items[1]).toMatchObject({ kind: 'user', text: '/compact' });
  });

  it.each(['', '   ', '\n\t'])('refuses to send the blank message %p', (text) => {
    const { result } = renderHook(() => useCopilot(0));
    act(() => result.current.send(text, { mode: 'plan' }));
    expect(fake.sent).toEqual([]);
    expect(result.current.items).toEqual([]);
  });

  it('clears the transcript and stats on a new session', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'text', text: 'old' });
    event({ kind: 'result', sessionId: 's', stats: { ok: true, text: '', costUsd: 1, durationMs: 2, turns: 1, contextTokens: 3, outputTokens: 4 } });
    expect(result.current.items).toHaveLength(1);

    act(() => result.current.newSession());
    expect(result.current.items).toEqual([]);
    expect(result.current.stats).toMatchObject({ turns: 0, costUsd: 0 });
  });
});

// Every callback is memoised so the dock's children do not re-render on each transcript update.
// A dependency array that lists the wrong thing shows up here and nowhere else.
describe('useCopilot callback identity', () => {
  it('keeps every returned callback stable across a re-render', () => {
    const { result, rerender } = renderHook(() => useCopilot(0));
    const before = { ...result.current };

    event({ kind: 'text', text: 'changes state' });
    rerender();

    for (const name of ['send', 'compact', 'cancel', 'newSession', 'openChat', 'deleteChat'] as const) {
      expect(result.current[name], name).toBe(before[name]);
    }
  });
});

describe('useCopilot rebuilds its callbacks when the socket changes', () => {
  it('hands out new callbacks after a bump, and sends on the new socket', () => {
    const { result, rerender } = renderHook(({ bump }) => useCopilot(bump), {
      initialProps: { bump: 0 },
    });
    const before = { ...result.current };

    rerender({ bump: 7 });
    for (const name of ['send', 'compact', 'cancel', 'newSession', 'openChat', 'deleteChat'] as const) {
      expect(result.current[name], name).not.toBe(before[name]);
    }

    // And the rebuilt callback talks to the new socket, not the one it closed over before.
    act(() => result.current.cancel());
    expect(h.get(7).sent).toEqual([{ type: 'copilot:cancel' }]);
    expect(h.get(0).sent).toEqual([]);
  });
});

describe('useCopilot streaming mechanics', () => {
  it('starts idle with an empty transcript', () => {
    const { result } = renderHook(() => useCopilot(0));
    expect(result.current.running).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it('a text block start alone opens an empty assistant bubble', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'block_start', block: 'text' });
    expect(result.current.items).toMatchObject([{ kind: 'assistant', text: '' }]);
  });

  it('a delta with no block start opens an assistant bubble on demand', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'text_delta', text: 'orphan' });
    expect(result.current.items).toMatchObject([{ kind: 'assistant', text: 'orphan' }]);
  });

  it('concatenates consecutive deltas into one bubble', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'block_start', block: 'text' });
    event({ kind: 'text_delta', text: 'one ' });
    event({ kind: 'text_delta', text: 'two' });
    expect(result.current.items).toMatchObject([{ kind: 'assistant', text: 'one two' }]);
  });

  it('block_stop closes the bubble so the next delta starts a new one', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'block_start', block: 'text' });
    event({ kind: 'text_delta', text: 'first' });
    event({ kind: 'block_stop' });
    event({ kind: 'text_delta', text: 'second' });
    expect(result.current.items).toMatchObject([
      { kind: 'assistant', text: 'first' },
      { kind: 'assistant', text: 'second' },
    ]);
  });

  it('gives stream-created bubbles increasing ids too', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'block_start', block: 'text' });
    event({ kind: 'block_stop' });
    event({ kind: 'text_delta', text: 'x' });
    event({ kind: 'tool_use', id: 't', name: 'Read', input: {} });
    const ids = result.current.items.map((i: { id: number }) => i.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('records a tool call as an empty tool item carrying only the name', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'tool_use', id: 't', name: 'Grep', input: { q: 1 } });
    expect(result.current.items).toMatchObject([{ kind: 'tool', text: '', toolName: 'Grep' }]);
  });

  it('takes window occupancy from a usage event', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'usage', contextTokens: 4321 });
    expect(result.current.stats.contextTokens).toBe(4321);
  });

  it('replaces the chat list on copilot:chats without touching the transcript', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'text', text: 'keep me' });
    emit({
      type: 'copilot:chats',
      chats: [{ id: 'c-1', title: 'One' }],
      currentChatId: 'c-1',
    });
    expect(result.current.chats).toMatchObject([{ id: 'c-1', title: 'One' }]);
    expect(result.current.currentChatId).toBe('c-1');
    expect(result.current.items).toHaveLength(1);
  });

  it('clears delta mode on hydrate, so a finalised text still prints', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'text_delta', text: 'streamed' }); // delta mode on
    emit({
      type: 'copilot:history',
      items: [
        { kind: 'user', text: 'restored' },
        { kind: 'assistant', text: 'and its answer' },
      ],
      stats: { turns: 1, costUsd: 0, lastDurationMs: 0, contextTokens: 0, outputTokens: 0 },
      chats: [],
      currentChatId: undefined,
    });
    // Re-ided from 1 upward, in order, so live items appended later cannot collide.
    expect(result.current.items).toMatchObject([
      { kind: 'user', text: 'restored' },
      { kind: 'assistant', text: 'and its answer' },
    ]);
    const ids = result.current.items.map((i: { id: number }) => i.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(2);

    event({ kind: 'text', text: 'after hydrate' });
    expect(result.current.items).toHaveLength(3);
  });

  it('clears delta mode at the start of a turn, so a non-streaming backend still prints', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'text_delta', text: 'streamed' }); // delta mode on
    act(() => result.current.send('next turn', { mode: 'plan' }));
    event({ kind: 'text', text: 'whole answer' }); // OpenCode sends a full block
    expect(result.current.items).toMatchObject([
      { kind: 'assistant', text: 'streamed' },
      { kind: 'user', text: 'next turn' },
      { kind: 'assistant', text: 'whole answer' },
    ]);
  });
});

describe('useCopilot missing delta text', () => {
  it('appends nothing rather than undefined when a delta carries no text', () => {
    const { result } = renderHook(() => useCopilot(0));
    event({ kind: 'block_start', block: 'text' });
    event({ kind: 'text_delta', text: 'kept' });
    event({ kind: 'text_delta' });
    expect(result.current.items).toMatchObject([{ kind: 'assistant', text: 'kept' }]);
  });
});
