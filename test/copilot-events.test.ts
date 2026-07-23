import { describe, it, expect } from 'vitest';
import { parseCopilotLine } from '../src/server/copilot-events.js';

// Lines shaped exactly like real `claude --output-format stream-json` output.
const INIT = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc-123', model: 'claude-haiku-4-5', permissionMode: 'plan', cwd: '/x' });
const THINKING = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm' }] }, session_id: 'abc-123' });
const TEXT = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] }, session_id: 'abc-123' });
const TOOL_USE = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/x/E-1.md' } }] } });
const TOOL_RESULT = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'done' }] } });
const RESULT = JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, result: 'ok', num_turns: 1, duration_ms: 3187,
  total_cost_usd: 0.065962, session_id: 'abc-123',
  usage: { input_tokens: 10, cache_creation_input_tokens: 32536, cache_read_input_tokens: 0, output_tokens: 176 },
});

describe('parseCopilotLine', () => {
  it('parses the init event', () => {
    expect(parseCopilotLine(INIT)).toEqual([{ kind: 'init', sessionId: 'abc-123', model: 'claude-haiku-4-5', permissionMode: 'plan' }]);
  });

  it('extracts thinking, text, and tool_use content blocks', () => {
    expect(parseCopilotLine(THINKING)).toEqual([{ kind: 'thinking', text: 'hmm' }]);
    expect(parseCopilotLine(TEXT)).toEqual([{ kind: 'text', text: 'ok' }]);
    expect(parseCopilotLine(TOOL_USE)).toEqual([{ kind: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/x/E-1.md' } }]);
  });

  it('extracts tool results from user messages', () => {
    expect(parseCopilotLine(TOOL_RESULT)).toEqual([{ kind: 'tool_result', text: 'done' }]);
  });

  it('summarizes the result with cost, duration, turns, and context tokens', () => {
    const [evt] = parseCopilotLine(RESULT);
    expect(evt).toMatchObject({ kind: 'result', sessionId: 'abc-123' });
    if (evt.kind !== 'result') throw new Error('expected result');
    expect(evt.stats).toEqual({
      ok: true, text: 'ok', costUsd: 0.065962, durationMs: 3187, turns: 1,
      contextTokens: 10 + 32536 + 0, outputTokens: 176,
    });
  });

  it('ignores hook/thinking_tokens/rate_limit noise and malformed lines', () => {
    expect(parseCopilotLine(JSON.stringify({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 5 }))).toEqual([]);
    expect(parseCopilotLine(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: {} }))).toEqual([]);
    expect(parseCopilotLine('not json at all')).toEqual([]);
    expect(parseCopilotLine('')).toEqual([]);
  });

  it('parses partial-message stream events (block start/stop + text/thinking deltas)', () => {
    const start = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } });
    const textDelta = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'he' } } });
    const thinkDelta = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } } });
    const stop = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
    const msgDelta = JSON.stringify({ type: 'stream_event', event: { type: 'message_delta', delta: {} } });
    expect(parseCopilotLine(start)).toEqual([{ kind: 'block_start', block: 'text' }]);
    expect(parseCopilotLine(textDelta)).toEqual([{ kind: 'text_delta', text: 'he' }]);
    expect(parseCopilotLine(thinkDelta)).toEqual([{ kind: 'thinking_delta', text: 'hm' }]);
    expect(parseCopilotLine(stop)).toEqual([{ kind: 'block_stop' }]);
    expect(parseCopilotLine(msgDelta)).toEqual([]); // message_delta is noise
  });

  it('handles a multi-block assistant message in order', () => {
    const multi = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 't' }, { type: 'text', text: 'a' }] } });
    expect(parseCopilotLine(multi)).toEqual([{ kind: 'thinking', text: 't' }, { kind: 'text', text: 'a' }]);
  });
});
