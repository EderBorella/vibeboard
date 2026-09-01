// Pure parsing of Claude Code's `--output-format stream-json` lines into the small set of
// events the copilot UI cares about. One raw line (an assistant message) can carry several
// content blocks, so parsing returns an array. Unknown/among-the-noise lines (hooks,
// thinking_tokens, rate_limit_event) map to [] and are simply not forwarded.

// THE TYPES LIVE IN `core/copilot-event.ts` and are re-exported here, so the ten modules that import
// them from this file keep working and the parser stays the one thing this module is. See that file for
// why the split exists.
import type { CopilotEvent, ResultStats } from '../core/copilot-event.js';

export type { CopilotEvent, ResultStats };

interface RawBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
}

export const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

// Context-window occupancy for a single model call = all prompt tokens
// (uncached + cache-read + cache-creation). Sourced from an assistant message's own
// usage — NOT the result's top-level usage, which sums every call in the turn.
function contextFromUsage(usage: Record<string, unknown> | undefined): number | undefined {
  if (!usage) return undefined;
  return (
    num(usage.input_tokens) + num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens)
  );
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === 'string' ? c : ((c as RawBlock)?.text ?? ''))).join('');
  }
  return '';
}

function contentEvents(content: unknown): CopilotEvent[] {
  if (!Array.isArray(content)) return [];
  const out: CopilotEvent[] = [];
  for (const b of content as RawBlock[]) {
    if (b.type === 'text' && b.text) out.push({ kind: 'text', text: b.text });
    else if (b.type === 'thinking' && b.thinking) out.push({ kind: 'thinking', text: b.thinking });
    else if (b.type === 'tool_use')
      out.push({ kind: 'tool_use', id: b.id ?? '', name: b.name ?? '', input: b.input });
    else if (b.type === 'tool_result') out.push({ kind: 'tool_result', text: toolResultText(b.content) });
  }
  return out;
}

function resultStats(o: Record<string, unknown>): ResultStats {
  const u = (o.usage ?? {}) as Record<string, unknown>;
  // Top-level usage sums every model call in the turn (each tool round-trip re-reads the
  // whole context), so it overstates window size. The LAST iteration's prompt tokens are
  // the real context-window occupancy at the end of the turn.
  const iters = Array.isArray(u.iterations) ? (u.iterations as Record<string, unknown>[]) : [];
  const promptSrc = iters.length ? iters[iters.length - 1] : u;
  const contextTokens =
    num(promptSrc.input_tokens) +
    num(promptSrc.cache_read_input_tokens) +
    num(promptSrc.cache_creation_input_tokens);
  return {
    ok: o.is_error === false,
    text: typeof o.result === 'string' ? o.result : '',
    costUsd: num(o.total_cost_usd),
    durationMs: num(o.duration_ms),
    turns: num(o.num_turns),
    contextTokens,
    outputTokens: num(u.output_tokens),
  };
}

export function parseCopilotLine(line: string): CopilotEvent[] {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!o || typeof o !== 'object') return [];
  switch (o.type) {
    case 'system':
      return o.subtype === 'init'
        ? [
            {
              kind: 'init',
              sessionId: String(o.session_id ?? ''),
              model: String(o.model ?? ''),
              permissionMode: String(o.permissionMode ?? ''),
            },
          ]
        : [];
    case 'assistant': {
      const message = o.message as { content?: unknown; usage?: Record<string, unknown> };
      const events = contentEvents(message?.content);
      const ctx = contextFromUsage(message?.usage);
      if (ctx !== undefined) events.push({ kind: 'usage', contextTokens: ctx });
      return events;
    }
    case 'user':
      return contentEvents((o.message as { content?: unknown })?.content);
    case 'stream_event':
      return streamEvents(o.event as StreamEvent | undefined);
    case 'result':
      return [{ kind: 'result', sessionId: String(o.session_id ?? ''), stats: resultStats(o) }];
    default:
      return [];
  }
}

interface StreamEvent {
  type?: string;
  content_block?: { type?: string };
  delta?: { type?: string; text?: string; thinking?: string };
}

// Incremental deltas from --include-partial-messages. Only text/thinking are surfaced;
// the final `assistant` message still arrives and carries tool_use.
function streamEvents(event: StreamEvent | undefined): CopilotEvent[] {
  if (!event) return [];
  switch (event.type) {
    case 'content_block_start': {
      const t = event.content_block?.type;
      if (t === 'text' || t === 'thinking' || t === 'tool_use') return [{ kind: 'block_start', block: t }];
      return [];
    }
    case 'content_block_delta':
      if (event.delta?.type === 'text_delta') return [{ kind: 'text_delta', text: event.delta.text ?? '' }];
      if (event.delta?.type === 'thinking_delta')
        return [{ kind: 'thinking_delta', text: event.delta.thinking ?? '' }];
      return [];
    case 'content_block_stop':
      return [{ kind: 'block_stop' }];
    default:
      return [];
  }
}
