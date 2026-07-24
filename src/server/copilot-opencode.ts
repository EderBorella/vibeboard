import type { CopilotEvent } from './copilot-events.js';

export interface ParsedLine {
  events: CopilotEvent[];
  sessionId?: string;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

interface OcPart {
  id?: string;
  type?: string;
  text?: string;
  tool?: string;
  name?: string;
  input?: unknown;
  state?: { input?: unknown };
  cost?: number;
  tokens?: { input?: number; output?: number; cache?: { read?: number; write?: number } };
}
interface OcLine { type?: string; sessionID?: string; part?: OcPart }

// Parse one line of `opencode run --format json`. Normalises OpenCode's step/text/tool
// events into the shared CopilotEvent stream. Text arrives as a full block (not deltas).
export function parseOpencodeLine(line: string): ParsedLine {
  let o: OcLine;
  try {
    o = JSON.parse(line) as OcLine;
  } catch {
    return { events: [] };
  }
  const sessionId = typeof o.sessionID === 'string' ? o.sessionID : undefined;
  const part = o.part ?? {};

  switch (o.type) {
    case 'text':
      return { events: part.text ? [{ kind: 'text', text: part.text }] : [], sessionId };
    case 'tool':
      return {
        events: [{ kind: 'tool_use', id: part.id ?? '', name: part.tool ?? part.name ?? 'tool', input: part.state?.input ?? part.input }],
        sessionId,
      };
    case 'step_finish': {
      const t = part.tokens ?? {};
      const contextTokens = num(t.input) + num(t.cache?.read) + num(t.cache?.write);
      const events: CopilotEvent[] = [
        { kind: 'usage', contextTokens },
        {
          kind: 'result',
          sessionId: sessionId ?? '',
          stats: { ok: true, text: '', costUsd: num(part.cost), durationMs: 0, turns: 1, contextTokens, outputTokens: num(t.output) },
        },
      ];
      return { events, sessionId };
    }
    default:
      return { events: [], sessionId }; // step_start and anything else
  }
}
