import { useEffect, useRef, useState } from 'react';
import { listModels, getModelStatus, type ModelOption, type ModelStatus } from '../api';
import { backendCaps, backendDefaults } from '../shared';
import { clampToCaps } from './choice';
import { BACKENDS } from './format';
import { ChatSwitcher } from './ChatSwitcher';
import { CopilotControls } from './CopilotControls';
import { CopilotReadout } from './CopilotReadout';
import type { CopilotMode, EffortLevel, useCopilot } from './useCopilot';

interface Props {
  copilot: ReturnType<typeof useCopilot>;
  backend: string;
  mode: CopilotMode;
  model: string;
  effort: EffortLevel;
  onMode: (m: CopilotMode) => void;
  onModel: (m: string) => void;
  onEffort: (e: EffortLevel) => void;
  onBackend: (b: string) => void;
  // True when any dock control differs from the configured default; clearing goes back to it.
  contextBudget: number;
  overridden: boolean;
  onReset: () => void;
  onClose: () => void;
}

export function CopilotPanel({
  copilot, backend, mode, model, effort, contextBudget,
  onMode, onModel, onEffort, onBackend, overridden, onReset, onClose,
}: Props) {
  const { items, running, model: activeModel, stats, chats, currentChatId, send, compact, newSession, openChat, deleteChat, cancel } = copilot;
  const [draft, setDraft] = useState('');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Modes and efforts are backend-specific, so a selection carried across a backend switch
  // gets clamped to what this backend actually publishes. The model arrives already
  // resolved — App owns precedence.
  const caps = backendCaps(backend);
  const { mode: effMode, effort: effEffort } = clampToCaps({ backend, model, effort }, mode);

  // Warn when the chosen model can't call tools — the copilot can't touch cards without them.
  const noTools = models.find((m) => m.id === model)?.caps?.toolCall === false;

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
    getModelStatus(model).then((s) => { if (live) setStatus(s); }).catch(() => {});
    return () => { live = false; };
  }, [model]);

  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }); }, [items, running]);

  // Always concrete — the server would fill these in anyway, and sending them keeps what the
  // UI shows and what runs the same thing.
  // The backend goes too: the dock is a session override, so the server can't assume the
  // configured one is in force.
  const turnOpts = () => ({ mode: effMode, backend, model, effort: effEffort });
  const submit = (): void => {
    if (!draft.trim() || running) return;
    send(draft, turnOpts());
    setDraft('');
  };

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

      <ChatSwitcher
        chats={chats}
        currentChatId={currentChatId}
        backend={backend}
        running={running}
        onOpen={openChat}
        onDelete={deleteChat}
        onNew={newSession}
      />

      <CopilotControls
        caps={caps}
        effMode={effMode}
        effEffort={effEffort}
        effModel={model}
        defaultModel={backendDefaults(backend).model}
        models={models}
        running={running}
        onMode={onMode}
        onModel={onModel}
        onEffort={onEffort}
        onCompact={() => compact(turnOpts())}
      />

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

      <CopilotReadout stats={stats} budget={contextBudget} />

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
