import { useEffect, useRef, useState } from 'react';
import { listModels, getModelStatus, type ModelOption, type ModelStatus } from '../api';
import { backendCaps, backendDefaults } from '../shared';
import { ModelPicker } from '../components/ModelPicker';
import type { CopilotMode, EffortLevel, useCopilot } from './useCopilot';

const CONTEXT_BUDGET = 200_000;
const BACKENDS: { value: string; label: string }[] = [
  { value: 'claude-code', label: 'Claude' },
  { value: 'opencode', label: 'OpenCode' },
];

// Short backend label for the chat list — chats don't carry context across backends, so
// each one is tagged with the backend it ran on.
function backendLabel(b: string): string {
  return BACKENDS.find((x) => x.value === b)?.label ?? b;
}

function fmtUsd(n: number): string { return `$${n.toFixed(n < 1 ? 4 : 2)}`; }
function fmtK(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

// Compact relative time for the chat switcher (e.g. "just now", "5m", "2h", "3d").
function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

interface Props {
  copilot: ReturnType<typeof useCopilot>;
  backend: string;
  mode: CopilotMode;
  model: string;
  effort: '' | EffortLevel;
  onMode: (m: CopilotMode) => void;
  onModel: (m: string) => void;
  onEffort: (e: '' | EffortLevel) => void;
  onBackend: (b: string) => void;
  // True when any dock control differs from the configured default; clearing goes back to it.
  overridden: boolean;
  onReset: () => void;
  onClose: () => void;
}

export function CopilotPanel({
  copilot, backend, mode, model, effort,
  onMode, onModel, onEffort, onBackend, overridden, onReset, onClose,
}: Props) {
  const { items, running, model: activeModel, stats, chats, currentChatId, send, compact, newSession, openChat, deleteChat, cancel } = copilot;
  const [draft, setDraft] = useState('');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [chatMenu, setChatMenu] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const currentTitle = chats.find((c) => c.id === currentChatId)?.title ?? 'New chat';

  // Modes/efforts/models are backend-specific; fall back to this backend's default when the
  // carried-over selection doesn't apply (e.g. after switching Claude ↔ OpenCode).
  const caps = backendCaps(backend);
  const defaults = backendDefaults(backend);
  const effMode = caps.modes.some((m) => m.value === mode) ? mode : caps.modes[0].value;
  const effEffort = caps.efforts.some((e) => e.value === effort) ? effort : defaults.effort;
  const effModel = model || defaults.model;

  // Warn when the chosen model can't call tools — the copilot can't touch cards without them.
  const noTools = models.find((m) => m.id === effModel)?.caps?.toolCall === false;

  // Model choices depend on the configured backend (claude aliases vs opencode models).
  useEffect(() => {
    let live = true;
    listModels(backend).then((m) => { if (live) setModels(m); }).catch(() => { if (live) setModels([]); });
    return () => { live = false; };
  }, [backend]);

  // Live status/uptime for the selected model (OpenRouter only; null otherwise).
  useEffect(() => {
    let live = true;
    setStatus(null);
    getModelStatus(effModel).then((s) => { if (live) setStatus(s); }).catch(() => {});
    return () => { live = false; };
  }, [effModel]);

  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }); }, [items, running]);

  // Always concrete — the server would fill these in anyway, and sending them keeps what the
  // UI shows and what runs the same thing.
  // The backend goes too: the dock is a session override, so the server can't assume the
  // configured one is in force.
  const turnOpts = () => ({ mode: effMode, backend, model: effModel, effort: effEffort });
  const submit = (): void => {
    if (!draft.trim() || running) return;
    send(draft, turnOpts());
    setDraft('');
  };

  const pct = Math.min(100, Math.round((stats.contextTokens / CONTEXT_BUDGET) * 100));
  const nearFull = stats.contextTokens > CONTEXT_BUDGET * 0.8;

  return (
    <aside className="copilot">
      <div className="copilot-head">
        <span className="copilot-title">Copilot</span>
        <div className="backend-toggle" role="group" aria-label="Backend">
          {BACKENDS.map((b) => (
            <button
              key={b.value}
              className={`bt-btn${backend === b.value ? ' active' : ''}`}
              disabled={running}
              title={running ? 'Finish the current turn first' : `Switch to ${b.label} (starts a new chat)`}
              onClick={() => onBackend(b.value)}
            >
              {b.label}
            </button>
          ))}
        </div>
        {activeModel && <span className="copilot-model">{activeModel}</span>}
        <button className="copilot-x" onClick={onClose} title="Hide (session keeps running)">✕</button>
      </div>

      <div className="copilot-chatbar">
        <div className="chat-switcher">
          <button className="chat-current" disabled={running} onClick={() => setChatMenu((v) => !v)} title="Chat history">
            <span className="chat-current-title">{currentTitle}</span>
            <span className="chat-caret">▾</span>
          </button>
          {chatMenu && (
            <>
              <div className="chat-menu-backdrop" onClick={() => setChatMenu(false)} />
              <div className="chat-menu" role="menu">
                {chats.length === 0 && <div className="chat-menu-empty">No saved chats yet</div>}
                {chats.map((c) => (
                  <div key={c.id} className={`chat-menu-item${c.id === currentChatId ? ' active' : ''}`}>
                    <button className="chat-menu-open" onClick={() => { openChat(c.id, backend); setChatMenu(false); }} title={c.title}>
                      <span className="chat-menu-title">
                        <span className={`chat-backend bk-${c.backend}`}>{backendLabel(c.backend)}</span>
                        {c.title}
                      </span>
                      <span className="chat-menu-meta">{relTime(c.updatedAt)} · {c.messageCount} msg</span>
                    </button>
                    <button className="chat-del" title="Delete chat" onClick={() => deleteChat(c.id)}>✕</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <button className="chat-new" disabled={running} onClick={newSession} title="Start a fresh chat">+ New</button>
      </div>

      <div className="copilot-controls">
        <div className="mode-group" role="group" aria-label="Mode">
          {caps.modes.map((m) => (
            <button key={m.value} className={`mode-btn${effMode === m.value ? ' active' : ''}`} title={m.hint} disabled={running} onClick={() => onMode(m.value)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="copilot-actions">
          <button onClick={() => compact(turnOpts())} disabled={running} title="Compact the conversation">Compact</button>
        </div>
      </div>

      <div className="copilot-selects">
        <ModelPicker models={models} value={effModel} defaultModel={defaults.model} disabled={running} onChange={onModel} />
        <select className="effort-select" value={effEffort} disabled={running} onChange={(e) => onEffort(e.target.value as '' | EffortLevel)}>
          {caps.efforts.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
        </select>
      </div>
      {overridden && (
        <div className="copilot-override">
          Just for this session — the project default is unchanged.
          <button className="copilot-reset" onClick={onReset} disabled={running}>Use default</button>
        </div>
      )}
      {noTools && (
        <div className="copilot-warn" role="alert">
          ⚠ This model can’t use tools — the copilot can’t create or edit cards. Pick a 🔧 model.
        </div>
      )}
      {status && (
        <div className={`copilot-status ${status.up ? 'ok' : 'down'}`}>
          <span className="status-dot" />
          {status.up ? 'available' : 'unavailable'}
          {status.uptime != null && ` · ${status.uptime.toFixed(1)}% uptime`}
          {` · ${status.endpoints} provider${status.endpoints === 1 ? '' : 's'}`}
        </div>
      )}

      <div className="copilot-body" ref={bodyRef}>
        {items.length === 0 && (
          <div className="copilot-empty">
            Ask the copilot to work on this project. It runs your configured backend
            ({backend}) in the project folder, so card changes appear on the board as it works.
          </div>
        )}
        {items.map((it) => (
          <div key={it.id} className={`msg msg-${it.kind}`}>
            {it.kind === 'tool' ? <span className="msg-tool">⚙ {it.toolName}</span>
              : it.kind === 'thinking' ? <span className="msg-thinking">{it.text}</span>
              : it.text}
          </div>
        ))}
        {running && <div className="msg msg-running">…working</div>}
      </div>

      <div className="copilot-readout">
        <span title="cumulative session cost">{fmtUsd(stats.costUsd)}</span>
        <span>{stats.turns} turns</span>
        <span>{(stats.lastDurationMs / 1000).toFixed(1)}s</span>
        <span className={`ctx${nearFull ? ' ctx-warn' : ''}`} title={`context window: ${stats.contextTokens.toLocaleString()} / ${CONTEXT_BUDGET.toLocaleString()} tokens`}>
          <span className="ctx-bar"><span className="ctx-fill" style={{ width: `${pct}%` }} /></span>
          ctx {fmtK(stats.contextTokens)}{nearFull ? ' · consider /compact' : ''}
        </span>
      </div>

      <div className="copilot-input">
        <textarea
          value={draft}
          placeholder={running ? 'Running…' : 'Message the copilot (Enter to send)'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          rows={3}
        />
        {running
          ? <button className="btn-secondary" onClick={cancel}>Stop</button>
          : <button className="btn-primary" onClick={submit} disabled={!draft.trim()}>Send</button>}
      </div>
    </aside>
  );
}
