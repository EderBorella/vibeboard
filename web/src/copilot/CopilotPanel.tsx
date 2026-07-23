import { useEffect, useRef, useState } from 'react';
import { useCopilot, type PermissionMode } from './useCopilot';

const MODES: { value: PermissionMode; label: string; hint: string }[] = [
  { value: 'plan', label: 'Plan', hint: 'read & plan only, no edits' },
  { value: 'acceptEdits', label: 'Execute', hint: 'auto-accept file edits' },
  { value: 'bypassPermissions', label: 'Full-auto', hint: 'everything, unattended' },
];

const CONTEXT_BUDGET = 200_000;

function fmtUsd(n: number): string { return `$${n.toFixed(n < 1 ? 4 : 2)}`; }
function fmtK(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

export function CopilotPanel({ onClose }: { onClose: () => void }) {
  const { items, running, model, stats, send, compact, newSession, cancel } = useCopilot();
  const [mode, setMode] = useState<PermissionMode>('bypassPermissions');
  const [draft, setDraft] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }); }, [items, running]);

  const submit = (): void => {
    if (!draft.trim() || running) return;
    send(draft, mode);
    setDraft('');
  };

  const pct = Math.min(100, Math.round((stats.contextTokens / CONTEXT_BUDGET) * 100));
  const nearFull = stats.contextTokens > CONTEXT_BUDGET * 0.8;

  return (
    <aside className="copilot">
      <div className="copilot-head">
        <span className="copilot-title">Copilot</span>
        {model && <span className="copilot-model">{model}</span>}
        <button className="copilot-x" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="copilot-controls">
        <div className="mode-group" role="group" aria-label="Permission mode">
          {MODES.map((m) => (
            <button
              key={m.value}
              className={`mode-btn${mode === m.value ? ' active' : ''}`}
              title={m.hint}
              disabled={running}
              onClick={() => setMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="copilot-actions">
          <button onClick={newSession} disabled={running} title="Start a fresh session">New</button>
          <button onClick={() => compact(mode)} disabled={running} title="Compact the conversation">Compact</button>
        </div>
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
        <span>{fmtUsd(stats.costUsd)}</span>
        <span>{stats.turns} turns</span>
        <span>{(stats.lastDurationMs / 1000).toFixed(1)}s</span>
        <span className={`ctx${nearFull ? ' ctx-warn' : ''}`} title={`${stats.contextTokens} / ${CONTEXT_BUDGET} context tokens`}>
          <span className="ctx-bar"><span className="ctx-fill" style={{ width: `${pct}%` }} /></span>
          {fmtK(stats.contextTokens)}{nearFull ? ' · consider /compact' : ''}
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
