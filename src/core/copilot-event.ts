// The shapes an agent turn produces, with no parser and no transport attached.
//
// SEPARATED FROM `server/copilot-events.ts` on 2026-09-01, which keeps the parsing. The types were flat
// under `server/` and `store/chat-store.ts` imported them upward — an edge `tools/check-store-layer.mjs`
// now refuses. `import type` erases, so the edge cost nothing at run time; the reason for closing it is
// that a store module whose shapes are defined by a server module cannot be read, tested or moved on its
// own, which is the whole claim a layer makes.
//
// Pure data: no imports, no `node:*`, nothing to run. The parser stays where the backends are.

// Exported: the run engine records these on the run, not just the chat.
export interface ResultStats {
  ok: boolean;
  text: string;
  costUsd: number;
  durationMs: number;
  // Optional because not every backend reports one: Claude Code has num_turns, OpenCode's message
  // response has no equivalent, and inventing a 1 there made every OpenCode run claim "1 turn".
  turns?: number;
  contextTokens: number; // prompt tokens in play: input + cache read + cache creation
  outputTokens: number;
}

export type CopilotEvent =
  | { kind: 'init'; sessionId: string; model: string; permissionMode: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; text: string }
  | { kind: 'usage'; contextTokens: number } // per-call window occupancy, from message.usage
  | { kind: 'result'; sessionId: string; stats: ResultStats }
  // WHAT WENT WRONG, AND WHETHER TO OFFER A RETRY. Added 2026-08-31: the three sites that report a
  // failed turn all pushed `kind: 'text'`, so a 429 rendered as an ordinary assistant bubble carrying
  // the provider's raw JSON. `text` is what the MODEL said; an error is not that, and the difference
  // is what lets the chat style it, and the panel offer a remedy beside it.
  // `sentence` comes from `core/copilot-errors.ts` and is not reworded downstream.
  | { kind: 'error'; text: string; retryable: boolean }
  // Incremental (--include-partial-messages) streaming events:
  | { kind: 'block_start'; block: 'text' | 'thinking' | 'tool_use' }
  | { kind: 'text_delta'; text: string }
  | { kind: 'thinking_delta'; text: string }
  | { kind: 'block_stop' };
