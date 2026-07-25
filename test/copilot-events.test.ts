import { describe, expect, it } from 'vitest';
import { type CopilotEvent, parseCopilotLine } from '../src/server/copilot-events.js';

// Lines shaped exactly like real `claude --output-format stream-json` output.
const INIT = JSON.stringify({
  type: 'system',
  subtype: 'init',
  session_id: 'abc-123',
  model: 'claude-haiku-4-5',
  permissionMode: 'plan',
  cwd: '/x',
});
const THINKING = JSON.stringify({
  type: 'assistant',
  message: { content: [{ type: 'thinking', thinking: 'hmm' }] },
  session_id: 'abc-123',
});
const TEXT = JSON.stringify({
  type: 'assistant',
  message: { content: [{ type: 'text', text: 'ok' }] },
  session_id: 'abc-123',
});
const TOOL_USE = JSON.stringify({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/x/E-1.md' } }] },
});
const TOOL_RESULT = JSON.stringify({
  type: 'user',
  message: { content: [{ type: 'tool_result', content: 'done' }] },
});
const RESULT = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'ok',
  num_turns: 1,
  duration_ms: 3187,
  total_cost_usd: 0.065962,
  session_id: 'abc-123',
  usage: {
    input_tokens: 10,
    cache_creation_input_tokens: 32536,
    cache_read_input_tokens: 0,
    output_tokens: 176,
  },
});

describe('parseCopilotLine', () => {
  it('parses the init event', () => {
    expect(parseCopilotLine(INIT)).toEqual([
      { kind: 'init', sessionId: 'abc-123', model: 'claude-haiku-4-5', permissionMode: 'plan' },
    ]);
  });

  it('extracts thinking, text, and tool_use content blocks', () => {
    expect(parseCopilotLine(THINKING)).toEqual([{ kind: 'thinking', text: 'hmm' }]);
    expect(parseCopilotLine(TEXT)).toEqual([{ kind: 'text', text: 'ok' }]);
    expect(parseCopilotLine(TOOL_USE)).toEqual([
      { kind: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/x/E-1.md' } },
    ]);
  });

  it('extracts tool results from user messages', () => {
    expect(parseCopilotLine(TOOL_RESULT)).toEqual([{ kind: 'tool_result', text: 'done' }]);
  });

  it('summarizes the result with cost, duration, turns, and context tokens', () => {
    const [evt] = parseCopilotLine(RESULT);
    expect(evt).toMatchObject({ kind: 'result', sessionId: 'abc-123' });
    if (evt.kind !== 'result') throw new Error('expected result');
    expect(evt.stats).toEqual({
      ok: true,
      text: 'ok',
      costUsd: 0.065962,
      durationMs: 3187,
      turns: 1,
      contextTokens: 10 + 32536 + 0,
      outputTokens: 176,
    });
  });

  it('emits per-call context from an assistant message usage (window occupancy)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'hi' }],
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 32536,
          cache_read_input_tokens: 0,
          output_tokens: 3,
        },
      },
      session_id: 's',
    });
    const events = parseCopilotLine(line);
    expect(events).toContainEqual({ kind: 'text', text: 'hi' });
    expect(events).toContainEqual({ kind: 'usage', contextTokens: 10 + 32536 + 0 });
  });

  it('reports context from the last iteration, not the summed-across-calls total', () => {
    // A multi-tool turn: top-level usage sums 3 calls (would read ~240k), but the window
    // occupancy is the last call's prompt (~40k).
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'done',
      num_turns: 1,
      duration_ms: 100,
      total_cost_usd: 0.5,
      session_id: 's',
      usage: {
        input_tokens: 30,
        cache_read_input_tokens: 200_000,
        cache_creation_input_tokens: 40_000,
        output_tokens: 900,
        iterations: [
          { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 33_000 },
          { input_tokens: 10, cache_read_input_tokens: 33_000, cache_creation_input_tokens: 5_000 },
          { input_tokens: 10, cache_read_input_tokens: 38_000, cache_creation_input_tokens: 2_000 },
        ],
      },
    });
    const [evt] = parseCopilotLine(line);
    if (evt.kind !== 'result') throw new Error('expected result');
    expect(evt.stats.contextTokens).toBe(10 + 38_000 + 2_000); // last iteration only
  });

  it('ignores hook/thinking_tokens/rate_limit noise and malformed lines', () => {
    expect(
      parseCopilotLine(JSON.stringify({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 5 })),
    ).toEqual([]);
    expect(parseCopilotLine(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: {} }))).toEqual([]);
    expect(parseCopilotLine('not json at all')).toEqual([]);
    expect(parseCopilotLine('')).toEqual([]);
  });

  it('parses partial-message stream events (block start/stop + text/thinking deltas)', () => {
    const start = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    });
    const textDelta = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'he' } },
    });
    const thinkDelta = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } },
    });
    const stop = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
    const msgDelta = JSON.stringify({ type: 'stream_event', event: { type: 'message_delta', delta: {} } });
    expect(parseCopilotLine(start)).toEqual([{ kind: 'block_start', block: 'text' }]);
    expect(parseCopilotLine(textDelta)).toEqual([{ kind: 'text_delta', text: 'he' }]);
    expect(parseCopilotLine(thinkDelta)).toEqual([{ kind: 'thinking_delta', text: 'hm' }]);
    expect(parseCopilotLine(stop)).toEqual([{ kind: 'block_stop' }]);
    expect(parseCopilotLine(msgDelta)).toEqual([]); // message_delta is noise
  });

  it('handles a multi-block assistant message in order', () => {
    const multi = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 't' },
          { type: 'text', text: 'a' },
        ],
      },
    });
    expect(parseCopilotLine(multi)).toEqual([
      { kind: 'thinking', text: 't' },
      { kind: 'text', text: 'a' },
    ]);
  });
});

const j = (o: unknown): string => JSON.stringify(o);
const stream = (event: unknown): string => j({ type: 'stream_event', event });

// The union is discriminated, so narrow rather than casting a tuple over it.
function resultOf(line: string): Extract<CopilotEvent, { kind: 'result' }> {
  const evt = parseCopilotLine(line).find((e) => e.kind === 'result');
  if (evt?.kind !== 'result') throw new Error(`no result event in ${line}`);
  return evt;
}

describe('parseCopilotLine — partial-message stream events', () => {
  it.each([
    ['text', [{ kind: 'block_start', block: 'text' }]],
    ['thinking', [{ kind: 'block_start', block: 'thinking' }]],
    ['tool_use', [{ kind: 'block_start', block: 'tool_use' }]],
    ['redacted_thinking', []],
    ['', []],
  ])('content_block_start of %p', (type, expected) => {
    expect(parseCopilotLine(stream({ type: 'content_block_start', content_block: { type } }))).toEqual(
      expected,
    );
  });

  it('ignores a block start with no content_block at all', () => {
    expect(parseCopilotLine(stream({ type: 'content_block_start' }))).toEqual([]);
  });

  it.each([
    [{ type: 'text_delta', text: 'hi' }, [{ kind: 'text_delta', text: 'hi' }]],
    [{ type: 'text_delta' }, [{ kind: 'text_delta', text: '' }]],
    [{ type: 'thinking_delta', thinking: 'hmm' }, [{ kind: 'thinking_delta', text: 'hmm' }]],
    [{ type: 'thinking_delta' }, [{ kind: 'thinking_delta', text: '' }]],
    // A thinking_delta carrying `text` must not be read as text, and vice versa.
    [{ type: 'thinking_delta', text: 'wrong field' }, [{ kind: 'thinking_delta', text: '' }]],
    [{ type: 'text_delta', thinking: 'wrong field' }, [{ kind: 'text_delta', text: '' }]],
    [{ type: 'input_json_delta', partial_json: '{' }, []],
    [{}, []],
  ])('content_block_delta %o', (delta, expected) => {
    expect(parseCopilotLine(stream({ type: 'content_block_delta', delta }))).toEqual(expected);
  });

  it('ignores a delta event with no delta', () => {
    expect(parseCopilotLine(stream({ type: 'content_block_delta' }))).toEqual([]);
  });

  it.each([
    ['content_block_stop', [{ kind: 'block_stop' }]],
    ['message_start', []],
    ['message_delta', []],
    ['message_stop', []],
    ['ping', []],
  ])('stream event %p', (type, expected) => {
    expect(parseCopilotLine(stream({ type }))).toEqual(expected);
  });

  it('ignores a stream_event with no event payload', () => {
    expect(parseCopilotLine(j({ type: 'stream_event' }))).toEqual([]);
  });
});

describe('parseCopilotLine — tool results', () => {
  it.each([
    ['a plain string', 'done', 'done'],
    ['an array of strings', ['a', 'b'], 'ab'],
    [
      'an array of text blocks',
      [
        { type: 'text', text: 'x' },
        { type: 'text', text: 'y' },
      ],
      'xy',
    ],
    ['a block with no text', [{ type: 'image' }], ''],
    ['a mix of strings and blocks', ['a', { text: 'b' }, null], 'ab'],
    ['an object', { text: 'ignored' }, ''],
    ['a number', 42, ''],
    ['nothing at all', undefined, ''],
  ])('flattens %s', (_label, content, expected) => {
    expect(
      parseCopilotLine(j({ type: 'user', message: { content: [{ type: 'tool_result', content }] } })),
    ).toEqual([{ kind: 'tool_result', text: expected }]);
  });
});

describe('parseCopilotLine — assistant content and usage', () => {
  it('emits one event per content block, skipping empty text and thinking', () => {
    const line = j({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'said' },
          { type: 'text', text: '' },
          { type: 'thinking', thinking: 'thought' },
          { type: 'thinking', thinking: '' },
          { type: 'tool_use', id: 'tu-1', name: 'Read', input: { path: 'a' } },
          { type: 'tool_use' },
          { type: 'unknown_block' },
        ],
      },
    });
    expect(parseCopilotLine(line)).toEqual([
      { kind: 'text', text: 'said' },
      { kind: 'thinking', text: 'thought' },
      { kind: 'tool_use', id: 'tu-1', name: 'Read', input: { path: 'a' } },
      { kind: 'tool_use', id: '', name: '', input: undefined },
    ]);
  });

  it('adds context occupancy from the message own usage, summing all three prompt sources', () => {
    const line = j({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 },
      },
    });
    expect(parseCopilotLine(line)).toEqual([
      { kind: 'text', text: 'hi' },
      { kind: 'usage', contextTokens: 125 },
    ]);
  });

  it('treats a non-numeric token count as zero rather than concatenating it', () => {
    const line = j({
      type: 'assistant',
      message: { content: [], usage: { input_tokens: '5', cache_read_input_tokens: 100 } },
    });
    expect(parseCopilotLine(line)).toEqual([{ kind: 'usage', contextTokens: 100 }]);
  });

  it('emits a zero usage event for an empty usage object, and none when usage is absent', () => {
    expect(parseCopilotLine(j({ type: 'assistant', message: { content: [], usage: {} } }))).toEqual([
      { kind: 'usage', contextTokens: 0 },
    ]);
    expect(parseCopilotLine(j({ type: 'assistant', message: { content: [] } }))).toEqual([]);
  });

  it.each([
    [{ type: 'assistant' }, []],
    [{ type: 'assistant', message: {} }, []],
    [{ type: 'assistant', message: { content: 'not an array' } }, []],
    [{ type: 'user' }, []],
  ])('tolerates the malformed shape %o', (obj, expected) => {
    expect(parseCopilotLine(j(obj))).toEqual(expected);
  });
});

describe('parseCopilotLine — init and result', () => {
  it('defaults every init field to an empty string when absent', () => {
    expect(parseCopilotLine(j({ type: 'system', subtype: 'init' }))).toEqual([
      { kind: 'init', sessionId: '', model: '', permissionMode: '' },
    ]);
  });

  it('ignores a system line that is not an init', () => {
    expect(parseCopilotLine(j({ type: 'system', subtype: 'hook_event' }))).toEqual([]);
  });

  it('reads context occupancy from the LAST iteration, not the summed top-level usage', () => {
    const line = j({
      type: 'result',
      session_id: 's-1',
      is_error: false,
      result: 'done',
      total_cost_usd: 0.5,
      duration_ms: 1200,
      num_turns: 3,
      usage: {
        input_tokens: 9999, // the sum across every call — overstates the window
        output_tokens: 42,
        iterations: [
          { input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 },
          { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 },
        ],
      },
    });
    expect(parseCopilotLine(line)).toEqual([
      {
        kind: 'result',
        sessionId: 's-1',
        stats: {
          ok: true,
          text: 'done',
          costUsd: 0.5,
          durationMs: 1200,
          turns: 3,
          contextTokens: 60, // 10 + 20 + 30, the last iteration only
          outputTokens: 42,
        },
      },
    ]);
  });

  it('falls back to top-level usage when there are no iterations', () => {
    const line = j({
      type: 'result',
      usage: {
        input_tokens: 1,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 4,
        output_tokens: 7,
      },
    });
    const { stats } = resultOf(line);
    expect(stats.contextTokens).toBe(7);
    expect(stats.outputTokens).toBe(7);
  });

  it.each([
    [{ is_error: false }, true],
    [{ is_error: true }, false],
    [{}, false], // absent is not success
    [{ is_error: 'false' }, false], // and neither is the string
  ])('maps %o to ok=%p', (extra, ok) => {
    expect(resultOf(j({ type: 'result', ...extra })).stats.ok).toBe(ok);
  });

  it('defaults a missing session id, a non-string result, and every missing number', () => {
    const evt = resultOf(j({ type: 'result', result: { not: 'a string' } }));
    expect(evt.sessionId).toBe('');
    expect(evt.stats).toEqual({
      ok: false,
      text: '',
      costUsd: 0,
      durationMs: 0,
      turns: 0,
      contextTokens: 0,
      outputTokens: 0,
    });
  });

  it('treats non-array iterations as absent', () => {
    const line = j({ type: 'result', usage: { input_tokens: 5, iterations: 'nope' } });
    expect(resultOf(line).stats.contextTokens).toBe(5);
  });
});

describe('parseCopilotLine — unparseable and unknown lines', () => {
  it.each(['', 'not json', '{', 'null', '42', '"a string"', 'true', '[]'])('returns [] for %p', (line) => {
    expect(parseCopilotLine(line)).toEqual([]);
  });

  it.each([{ type: 'hook_event' }, { type: 'rate_limit_event' }, {}, { type: 42 }])(
    'returns [] for the unhandled line %o',
    (obj) => {
      expect(parseCopilotLine(j(obj))).toEqual([]);
    },
  );
});

// Each content block is dispatched on its `type`, not on which fields happen to be present. A
// block carrying a foreign field must still be read as its declared type.
describe('parseCopilotLine — block type wins over stray fields', () => {
  it.each([
    [
      { type: 'thinking', thinking: 'real', text: 'decoy' },
      { kind: 'thinking', text: 'real' },
    ],
    [
      { type: 'text', text: 'real', thinking: 'decoy' },
      { kind: 'text', text: 'real' },
    ],
    [
      { type: 'tool_use', id: 'i', name: 'n', input: 1, text: 'decoy', thinking: 'decoy' },
      { kind: 'tool_use', id: 'i', name: 'n', input: 1 },
    ],
    [
      { type: 'tool_result', content: 'r', text: 'decoy' },
      { kind: 'tool_result', text: 'r' },
    ],
  ])('reads %o as its declared type', (block, expected) => {
    expect(parseCopilotLine(j({ type: 'assistant', message: { content: [block] } }))).toEqual([expected]);
  });
});
