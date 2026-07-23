import { useCallback, useEffect, useRef, useState } from 'react';

export type PermissionMode = 'plan' | 'acceptEdits' | 'bypassPermissions';

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
  kind: 'init' | 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'result';
  text?: string;
  name?: string;
  sessionId?: string;
  model?: string;
  stats?: { costUsd: number; durationMs: number; turns: number; contextTokens: number };
}

const ZERO: CopilotStats = { costUsd: 0, turns: 0, lastDurationMs: 0, contextTokens: 0 };

export function useCopilot() {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [model, setModel] = useState<string | undefined>();
  const [stats, setStats] = useState<CopilotStats>(ZERO);
  const ws = useRef<WebSocket | null>(null);
  const nextId = useRef(1);

  const push = useCallback((item: Omit<TranscriptItem, 'id'>) => {
    setItems((prev) => {
      // Merge consecutive assistant text into one bubble for readability.
      const last = prev[prev.length - 1];
      if (item.kind === 'assistant' && last?.kind === 'assistant') {
        return [...prev.slice(0, -1), { ...last, text: last.text + item.text }];
      }
      return [...prev, { ...item, id: nextId.current++ }];
    });
  }, []);

  const apply = useCallback((e: CopilotEvent) => {
    switch (e.kind) {
      case 'init': setSessionId(e.sessionId); setModel(e.model); break;
      case 'text': push({ kind: 'assistant', text: e.text ?? '' }); break;
      case 'thinking': push({ kind: 'thinking', text: e.text ?? '' }); break;
      case 'tool_use': push({ kind: 'tool', text: '', toolName: e.name }); break;
      case 'tool_result': break; // tool results are noisy; the board reflects file changes
      case 'result':
        if (e.stats) setStats((s) => ({
          costUsd: s.costUsd + e.stats!.costUsd,
          turns: s.turns + e.stats!.turns,
          lastDurationMs: e.stats!.durationMs,
          contextTokens: e.stats!.contextTokens,
        }));
        break;
    }
  }, [push]);

  useEffect(() => {
    const socket = new WebSocket(`ws://${location.host}/ws`);
    socket.onmessage = (ev) => {
      const m = JSON.parse(ev.data as string);
      if (m.type === 'copilot:event') apply(m.event);
      else if (m.type === 'copilot:state') { setRunning(m.state.running); setSessionId(m.state.sessionId); setModel(m.state.model); }
      else if (m.type === 'copilot:error') push({ kind: 'error', text: m.error });
    };
    ws.current = socket;
    return () => socket.close();
  }, [apply, push]);

  const sendRaw = (payload: object): void => ws.current?.send(JSON.stringify(payload));

  const send = useCallback((text: string, mode: PermissionMode) => {
    if (!text.trim()) return;
    push({ kind: 'user', text });
    sendRaw({ type: 'copilot:send', text, mode });
  }, [push]);

  const compact = useCallback((mode: PermissionMode) => {
    push({ kind: 'user', text: '/compact' });
    sendRaw({ type: 'copilot:compact', mode });
  }, [push]);

  const newSession = useCallback(() => {
    sendRaw({ type: 'copilot:new' });
    setItems([]);
    setStats(ZERO);
  }, []);

  const cancel = useCallback(() => sendRaw({ type: 'copilot:cancel' }), []);

  return { items, running, sessionId, model, stats, send, compact, newSession, cancel };
}
