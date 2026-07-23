// Pure parsing of Claude Code's `--output-format stream-json` lines into the small set of
// events the copilot UI cares about. One raw line (an assistant message) can carry several
// content blocks, so parsing returns an array. Unknown/among-the-noise lines (hooks,
// thinking_tokens, rate_limit_event) map to [] and are simply not forwarded.

export interface ResultStats {
  ok: boolean;
  text: string;
  costUsd: number;
  durationMs: number;
  turns: number;
  contextTokens: number; // prompt tokens in play: input + cache read + cache creation
  outputTokens: number;
}

export type CopilotEvent =
  | { kind: 'init'; sessionId: string; model: string; permissionMode: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; text: string }
  | { kind: 'result'; sessionId: string; stats: ResultStats };

interface RawBlock { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown; content?: unknown }

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
    else if (b.type === 'tool_use') out.push({ kind: 'tool_use', id: b.id ?? '', name: b.name ?? '', input: b.input });
    else if (b.type === 'tool_result') out.push({ kind: 'tool_result', text: toolResultText(b.content) });
  }
  return out;
}

function resultStats(o: Record<string, unknown>): ResultStats {
  const u = (o.usage ?? {}) as Record<string, number>;
  const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
  const contextTokens = n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens);
  return {
    ok: o.is_error === false,
    text: typeof o.result === 'string' ? o.result : '',
    costUsd: n(o.total_cost_usd),
    durationMs: n(o.duration_ms),
    turns: n(o.num_turns),
    contextTokens,
    outputTokens: n(u.output_tokens),
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
        ? [{ kind: 'init', sessionId: String(o.session_id ?? ''), model: String(o.model ?? ''), permissionMode: String(o.permissionMode ?? '') }]
        : [];
    case 'assistant':
    case 'user':
      return contentEvents((o.message as { content?: unknown })?.content);
    case 'result':
      return [{ kind: 'result', sessionId: String(o.session_id ?? ''), stats: resultStats(o) }];
    default:
      return [];
  }
}
