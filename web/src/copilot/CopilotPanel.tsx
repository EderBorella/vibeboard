import { useEffect, useRef, useState } from 'react';
import { listModels, type ModelOption } from '../api';
import { backendCaps } from '../shared';
import type { CopilotMode, EffortLevel, useCopilot } from './useCopilot';

const CONTEXT_BUDGET = 200_000;

function fmtUsd(n: number): string { return `$${n.toFixed(n < 1 ? 4 : 2)}`; }
function fmtK(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

interface Props {
  copilot: ReturnType<typeof useCopilot>;
  backend: string;
  mode: CopilotMode;
  model: string;
  effort: '' | EffortLevel;
  onMode: (m: CopilotMode) => void;
  onModel: (m: string) => void;
  onEffort: (e: '' | EffortLevel) => void;
  onClose: () => void;
}

export function CopilotPanel({ copilot, backend, mode, model, effort, onMode, onModel, onEffort, onClose }: Props) {
  const { items, running, model: activeModel, stats, send, compact, newSession, cancel } = copilot;
  const [draft, setDraft] = useState('');
  const [models, setModels] = useState<ModelOption[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Model choices depend on the configured backend (claude aliases vs opencode models).
  useEffect(() => {
    let live = true;
    listModels(backend).then((m) => { if (live) setModels(m); }).catch(() => { if (live) setModels([]); });
    return () => { live = false; };
  }, [backend]);

  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }); }, [items, running]);

  // Modes/efforts are backend-specific; fall back to the backend's first valid value when
  // the carried-over selection doesn't apply (e.g. after switching Claude ↔ OpenCode).
  const caps = backendCaps(backend);
  const effMode = caps.modes.some((m) => m.value === mode) ? mode : caps.modes[0].value;
  const effEffort = caps.efforts.some((e) => e.value === effort) ? effort : '';
  const turnOpts = () => ({ mode: effMode, model: model || undefined, effort: effEffort || undefined });
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
        {activeModel && <span className="copilot-model">{activeModel}</span>}
        <button className="copilot-x" onClick={onClose} title="Hide (session keeps running)">✕</button>
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
          <button onClick={newSession} disabled={running} title="Start a fresh session">New</button>
          <button onClick={() => compact(turnOpts())} disabled={running} title="Compact the conversation">Compact</button>
        </div>
      </div>

      <div className="copilot-selects">
        <select value={model} disabled={running} onChange={(e) => onModel(e.target.value)}>
          <option value="">Default model</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.free ? `🆓 ${m.id}` : m.id}</option>)}
        </select>
        <select value={effEffort} disabled={running} onChange={(e) => onEffort(e.target.value as '' | EffortLevel)}>
          {caps.efforts.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
        </select>
      </div>

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
