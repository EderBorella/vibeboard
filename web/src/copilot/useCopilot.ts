import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMeta, WireTranscriptItem } from '../shared';
import { useSharedWs } from '../ws';

// Backend-specific; concrete values come from BACKEND_CAPS in shared.ts.
export type CopilotMode = string;
export type EffortLevel = string;

interface TurnOptions {
  mode: CopilotMode;
  // Sent per turn because the dock's controls are a session override — the config holds the
  // defaults, and anything omitted here falls back to them server-side.
  backend?: string;
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
  costUsd: number; // cumulative across turns this session
  turns: number; // cumulative
  lastDurationMs: number;
  contextTokens: number; // latest turn's prompt tokens (window occupancy)
}

interface CopilotEvent {
  kind:
    | 'init'
    | 'thinking'
    | 'text'
    | 'tool_use'
    | 'tool_result'
    | 'result'
    | 'usage'
    | 'block_start'
    | 'text_delta'
    | 'thinking_delta'
    | 'block_stop';
  text?: string;
  name?: string;
  block?: 'text' | 'thinking' | 'tool_use';
  sessionId?: string;
  model?: string;
  contextTokens?: number;
  // `turns` is absent on backends that report no turn count (OpenCode), so it is optional here too —
  // adding undefined to the running total would put NaN in the footer readout.
  stats?: { costUsd: number; durationMs: number; turns?: number; contextTokens: number };
}

const ZERO: CopilotStats = { costUsd: 0, turns: 0, lastDurationMs: 0, contextTokens: 0 };

// The copilot half of the shared /ws stream. Board snapshots come down the same socket and are
// simply not matched here — useSnapshot handles those.
type WsCopilotMessage =
  | { type: 'copilot:event'; event: CopilotEvent }
  | { type: 'copilot:state'; state: { running: boolean; sessionId?: string; model?: string } }
  | {
      type: 'copilot:history';
      chats: ChatMeta[];
      currentChatId?: string;
      items: WireTranscriptItem[];
      stats: CopilotStats;
    }
  | { type: 'copilot:chats'; chats: ChatMeta[]; currentChatId?: string }
  | { type: 'copilot:error'; error: string };

export function useCopilot(bump: number) {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [model, setModel] = useState<string | undefined>();
  const [stats, setStats] = useState<CopilotStats>(ZERO);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | undefined>();
  const nextId = useRef(1);
  const streamId = useRef<number | null>(null); // bubble currently being streamed via deltas
  const deltaMode = useRef(false); // true once any delta seen (partial streaming on)

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
    setItems((prev) => {
      const id = nextId.current++;
      streamId.current = id;
      return [...prev, { id, kind, text: '' }];
    });
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

  // Usage carries this call's window occupancy (last wins); result carries cost/turns/duration,
  // which accumulate. Split out because they are the only cases that touch stats.
  const applyStats = useCallback((e: CopilotEvent) => {
    if (e.kind === 'usage') {
      const tokens = e.contextTokens;
      if (typeof tokens === 'number') setStats((s) => ({ ...s, contextTokens: tokens }));
      return;
    }
    const turnStats = e.stats;
    if (turnStats) {
      setStats((s) => ({
        ...s,
        costUsd: s.costUsd + turnStats.costUsd,
        turns: s.turns + (turnStats.turns ?? 0),
        lastDurationMs: turnStats.durationMs,
      }));
    }
  }, []);

  const apply = useCallback(
    (e: CopilotEvent) => {
      switch (e.kind) {
        case 'init':
          setSessionId(e.sessionId);
          setModel(e.model);
          break;
        // Incremental text streaming. Thinking is intentionally not rendered.
        case 'block_start':
          if (e.block === 'text') openStream('assistant');
          break;
        case 'text_delta':
          deltaMode.current = true;
          appendStream('assistant', e.text ?? '');
          break;
        case 'thinking_delta':
          break; // reasoning hidden
        case 'block_stop':
          streamId.current = null;
          break;
        case 'text':
          if (!deltaMode.current) push({ kind: 'assistant', text: e.text ?? '' });
          break;
        case 'thinking':
          break; // reasoning hidden
        case 'tool_use':
          streamId.current = null;
          push({ kind: 'tool', text: '', toolName: e.name });
          break;
        case 'tool_result':
          break; // tool results are noisy; the board reflects file changes
        case 'usage':
          applyStats(e);
          break;
        case 'result':
          streamId.current = null;
          applyStats(e);
          break;
      }
    },
    [push, openStream, appendStream, applyStats],
  );

  const ws = useSharedWs(bump);
  useEffect(
    () =>
      ws.subscribe((raw) => {
        // One cast at the wire boundary; the switch narrows from there. A board snapshot arriving
        // on the shared socket matches no case and is ignored.
        const m = raw as WsCopilotMessage;
        switch (m.type) {
          case 'copilot:event':
            apply(m.event);
            break;
          case 'copilot:state':
            setRunning(m.state.running);
            setSessionId(m.state.sessionId);
            setModel(m.state.model);
            break;
          case 'copilot:history':
            setChats(m.chats);
            setCurrentChatId(m.currentChatId);
            hydrate(m.items, m.stats);
            break;
          case 'copilot:chats':
            setChats(m.chats);
            setCurrentChatId(m.currentChatId);
            break;
          case 'copilot:error':
            push({ kind: 'error', text: m.error });
            break;
        }
      }),
    [ws, apply, push, hydrate],
  );

  // Wrapped so the turn helpers below can depend on them; ws is memoised, so both stay stable.
  const sendRaw = useCallback((payload: object): void => ws.send(payload), [ws]);

  // Reset streaming state at the start of a turn: Claude streams deltas, OpenCode sends a
  // full text block — resetting per turn keeps both correct even if the backend changed.
  const startTurn = useCallback((): void => {
    deltaMode.current = false;
    streamId.current = null;
  }, []);

  const send = useCallback(
    (text: string, opts: TurnOptions) => {
      if (!text.trim()) return;
      startTurn();
      push({ kind: 'user', text });
      sendRaw({ type: 'copilot:send', text, ...opts });
    },
    [push, sendRaw, startTurn],
  );

  const compact = useCallback(
    (opts: TurnOptions) => {
      startTurn();
      push({ kind: 'user', text: '/compact' });
      sendRaw({ type: 'copilot:compact', ...opts });
    },
    [push, sendRaw, startTurn],
  );

  const newSession = useCallback(() => {
    sendRaw({ type: 'copilot:new' });
    setItems([]);
    setStats(ZERO);
    streamId.current = null;
  }, [sendRaw]);

  // Switch to / delete a stored chat. The server responds with copilot:history (switch) or a
  // fresh history (delete of the active chat), which re-hydrates the transcript.
  // The backend rides along so the server can decide whether to resume the stored CLI session
  // (only valid when the chat's backend matches the one in force — override included).
  const openChat = useCallback(
    (chatId: string, backend?: string) => sendRaw({ type: 'copilot:open', chatId, backend }),
    [sendRaw],
  );
  const deleteChat = useCallback((chatId: string) => sendRaw({ type: 'copilot:delete', chatId }), [sendRaw]);

  const cancel = useCallback(() => sendRaw({ type: 'copilot:cancel' }), [sendRaw]);

  return {
    items,
    running,
    sessionId,
    model,
    stats,
    chats,
    currentChatId,
    send,
    compact,
    newSession,
    openChat,
    deleteChat,
    cancel,
  };
}
