// Shared shapes for persisted copilot conversations. The server (chat-store) owns these
// on disk; the web side mirrors TranscriptItem/ChatMeta in shared.ts across the tsc/Vite
// boundary. Thinking and tool_result are never persisted (hidden / noisy), so the kinds
// here are a subset of the client's live transcript kinds.

export type TranscriptKind = 'user' | 'assistant' | 'tool' | 'error';

export interface TranscriptItem {
  kind: TranscriptKind;
  text: string;
  toolName?: string; // set for kind === 'tool'
}

export interface ChatStats {
  costUsd: number;       // cumulative across turns in this chat
  turns: number;         // cumulative
  lastDurationMs: number;
  contextTokens: number; // latest turn's window occupancy
}

// Lightweight header for the switcher list (no transcript body).
export interface ChatMeta {
  id: string;            // VibeBoard's own id (crypto.randomUUID)
  title: string;         // first user message, truncated; else a timestamp
  backend: string;       // backend the chat was created under
  model?: string;
  createdAt: string;     // ISO
  updatedAt: string;     // ISO
  messageCount: number;  // number of transcript items
}

// The full persisted chat (one JSON file under <project>/.vibeboard/chat/<id>.json).
export interface StoredChat extends ChatMeta {
  cliSessionId?: string; // underlying CLI session for resume (claude --resume / opencode id)
  items: TranscriptItem[];
  stats: ChatStats;
}

export const ZERO_STATS: ChatStats = { costUsd: 0, turns: 0, lastDurationMs: 0, contextTokens: 0 };
