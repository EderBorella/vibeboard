import { useEffect, useRef, useState } from 'react';
import type { EffortLevel, PermissionMode, useCopilot } from './useCopilot';

const MODES: { value: PermissionMode; label: string; hint: string }[] = [
  { value: 'plan', label: 'Plan', hint: 'read & plan only, no edits' },
  { value: 'acceptEdits', label: 'Execute', hint: 'auto-accept file edits' },
  { value: 'bypassPermissions', label: 'Full-auto', hint: 'everything, unattended' },
];
const MODELS: { value: string; label: string }[] = [
  { value: '', label: 'Default model' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'fable', label: 'Fable' },
];
const EFFORTS: { value: '' | EffortLevel; label: string }[] = [
  { value: '', label: 'Default effort' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-high' },
  { value: 'max', label: 'Max' },
];

const CONTEXT_BUDGET = 200_000;

function fmtUsd(n: number): string { return `$${n.toFixed(n < 1 ? 4 : 2)}`; }
function fmtK(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

interface Props {
  copilot: ReturnType<typeof useCopilot>;
  mode: PermissionMode;
  model: string;
  effort: '' | EffortLevel;
  onMode: (m: PermissionMode) => void;
  onModel: (m: string) => void;
  onEffort: (e: '' | EffortLevel) => void;
  onClose: () => void;
}

export function CopilotPanel({ copilot, mode, model, effort, onMode, onModel, onEffort, onClose }: Props) {
  const { items, running, model: activeModel, stats, send, compact, newSession, cancel } = copilot;
  const [draft, setDraft] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }); }, [items, running]);

  const turnOpts = () => ({ mode, model: model || undefined, effort: effort || undefined });
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
        <div className="mode-group" role="group" aria-label="Permission mode">
          {MODES.map((m) => (
            <button key={m.value} className={`mode-btn${mode === m.value ? ' active' : ''}`} title={m.hint} disabled={running} onClick={() => onMode(m.value)}>
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
          {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select value={effort} disabled={running} onChange={(e) => onEffort(e.target.value as '' | EffortLevel)}>
          {EFFORTS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
        </select>
      </div>

      <div className="copilot-body" ref={bodyRef}>
        {items.length === 0 && (
          <div className="copilot-empty">
            Ask the copilot to work on this project. It runs Claude Code in the project folder,
            so card changes appear on the board as it works.
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
