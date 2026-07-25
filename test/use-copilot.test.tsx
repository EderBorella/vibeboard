// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// A stand-in for the shared socket: keeps the subscribers so a test can push events, and records
// what the hook sends. vi.hoisted because vi.mock's factory runs before the module body.
const fake = vi.hoisted(() => {
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
});

vi.mock('../web/src/ws.js', () => ({ useSharedWs: () => fake }));

import { useCopilot } from '../web/src/copilot/useCopilot.js';

const emit = (msg: unknown): void => {
  act(() => {
    for (const fn of fake.handlers) fn(msg);
  });
};
const event = (e: object): void => emit({ type: 'copilot:event', event: e });

beforeEach(() => {
  fake.handlers.clear();
  fake.sent.length = 0;
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
