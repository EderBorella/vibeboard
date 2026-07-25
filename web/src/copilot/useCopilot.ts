import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMeta, WireTranscriptItem } from '../shared';

// Backend-specific; concrete values come from BACKEND_CAPS in shared.ts.
export type CopilotMode = string;
export type EffortLevel = string;

export interface TurnOptions {
  mode: CopilotMode;
  // The panel always sends concrete values; the server fills in the backend's default if
  // either is missing (an old config, or a caller that isn't the panel).
  model?: string;
  effort?: EffortLevel;
}

export interface TranscriptItem {
  id: number;
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'tool_result' | 'error';
  text: string;
  toolName?: string;
}

export interface CopilotStats {
  costUsd: number;      // cumulative across turns this session
  turns: number;        // cumulative
  lastDurationMs: number;
  contextTokens: number; // latest turn's prompt tokens (window occupancy)
}

interface CopilotEvent {
  kind: 'init' | 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'result' | 'usage'
    | 'block_start' | 'text_delta' | 'thinking_delta' | 'block_stop';
  text?: string;
  name?: string;
  block?: 'text' | 'thinking' | 'tool_use';
  sessionId?: string;
  model?: string;
  contextTokens?: number;
  stats?: { costUsd: number; durationMs: number; turns: number; contextTokens: number };
}

const ZERO: CopilotStats = { costUsd: 0, turns: 0, lastDurationMs: 0, contextTokens: 0 };

export function useCopilot() {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [model, setModel] = useState<string | undefined>();
  const [stats, setStats] = useState<CopilotStats>(ZERO);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | undefined>();
  const ws = useRef<WebSocket | null>(null);
  const nextId = useRef(1);
  const streamId = useRef<number | null>(null); // bubble currently being streamed via deltas
  const deltaMode = useRef(false);              // true once any delta seen (partial streaming on)

  const push = useCallback((item: Omit<TranscriptItem, 'id'>) => {
    setItems((prev) => [...prev, { ...item, id: nextId.current++ }]);
  }, []);

  // Replace the whole transcript with a server-persisted one (on connect / chat switch).
  // Re-ids locally so live-appended items after this never collide.
  const hydrate = useCallback((wire: WireTranscriptItem[], newStats: CopilotStats) => {
    nextId.current = 1;
    streamId.current = null;
    deltaMode.current = false;
    setItems(wire.map((w) => ({ id: nextId.current++, kind: w.kind, text: w.text, toolName: w.toolName })));
    setStats(newStats);
  }, []);

  // Open a fresh streaming bubble (assistant text or thinking) for the next deltas.
  const openStream = useCallback((kind: 'assistant' | 'thinking') => {
    setItems((prev) => { const id = nextId.current++; streamId.current = id; return [...prev, { id, kind, text: '' }]; });
  }, []);

  const appendStream = useCallback((kind: 'assistant' | 'thinking', text: string) => {
    setItems((prev) => {
      if (streamId.current != null) {
        return prev.map((it) => (it.id === streamId.current ? { ...it, text: it.text + text } : it));
      }
      const id = nextId.current++;
      streamId.current = id;
      return [...prev, { id, kind, text }];
    });
  }, []);

  const apply = useCallback((e: CopilotEvent) => {
    switch (e.kind) {
      case 'init': setSessionId(e.sessionId); setModel(e.model); break;
      // Incremental text streaming. Thinking is intentionally not rendered.
      case 'block_start': if (e.block === 'text') openStream('assistant'); break;
      case 'text_delta': deltaMode.current = true; appendStream('assistant', e.text ?? ''); break;
      case 'thinking_delta': break; // reasoning hidden
      case 'block_stop': streamId.current = null; break;
      case 'text': if (!deltaMode.current) push({ kind: 'assistant', text: e.text ?? '' }); break;
      case 'thinking': break; // reasoning hidden
      case 'tool_use': streamId.current = null; push({ kind: 'tool', text: '', toolName: e.name }); break;
      case 'tool_result': break; // tool results are noisy; the board reflects file changes
      // Context occupancy comes from each model call's own usage (last wins).
      case 'usage': if (typeof e.contextTokens === 'number') setStats((s) => ({ ...s, contextTokens: e.contextTokens! })); break;
      // Result carries cost/turns/duration only — its token totals are cross-call sums.
      case 'result':
        streamId.current = null;
        if (e.stats) setStats((s) => ({
          ...s,
          costUsd: s.costUsd + e.stats!.costUsd,
          turns: s.turns + e.stats!.turns,
          lastDurationMs: e.stats!.durationMs,
        }));
        break;
    }
  }, [push, openStream, appendStream]);

  useEffect(() => {
    const socket = new WebSocket(`ws://${location.host}/ws`);
    socket.onmessage = (ev) => {
      const m = JSON.parse(ev.data as string);
      if (m.type === 'copilot:event') apply(m.event);
      else if (m.type === 'copilot:state') { setRunning(m.state.running); setSessionId(m.state.sessionId); setModel(m.state.model); }
      else if (m.type === 'copilot:history') { setChats(m.chats); setCurrentChatId(m.currentChatId); hydrate(m.items, m.stats); }
      else if (m.type === 'copilot:chats') { setChats(m.chats); setCurrentChatId(m.currentChatId); }
      else if (m.type === 'copilot:error') push({ kind: 'error', text: m.error });
    };
    ws.current = socket;
    return () => socket.close();
  }, [apply, push, hydrate]);

  const sendRaw = (payload: object): void => ws.current?.send(JSON.stringify(payload));

  // Reset streaming state at the start of a turn: Claude streams deltas, OpenCode sends a
  // full text block — resetting per turn keeps both correct even if the backend changed.
  const startTurn = (): void => { deltaMode.current = false; streamId.current = null; };

  const send = useCallback((text: string, opts: TurnOptions) => {
    if (!text.trim()) return;
    startTurn();
    push({ kind: 'user', text });
    sendRaw({ type: 'copilot:send', text, ...opts });
  }, [push]);

  const compact = useCallback((opts: TurnOptions) => {
    startTurn();
    push({ kind: 'user', text: '/compact' });
    sendRaw({ type: 'copilot:compact', ...opts });
  }, [push]);

  const newSession = useCallback(() => {
    sendRaw({ type: 'copilot:new' });
    setItems([]);
    setStats(ZERO);
    streamId.current = null;
  }, []);

  // Switch to / delete a stored chat. The server responds with copilot:history (switch) or a
  // fresh history (delete of the active chat), which re-hydrates the transcript.
  const openChat = useCallback((chatId: string) => sendRaw({ type: 'copilot:open', chatId }), []);
  const deleteChat = useCallback((chatId: string) => sendRaw({ type: 'copilot:delete', chatId }), []);

  const cancel = useCallback(() => sendRaw({ type: 'copilot:cancel' }), []);

  return { items, running, sessionId, model, stats, chats, currentChatId, send, compact, newSession, openChat, deleteChat, cancel };
}
