import { useEffect, useState } from 'react';
import { BOARDS, BOARD_LABELS, type BoardName, type ProjectConfig } from '../shared';
import { listModels, patchConfig, type ModelOption } from '../api';

const BACKENDS: { value: string; label: string }[] = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'opencode', label: 'OpenCode' },
];
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

interface Props {
  config: ProjectConfig;
  onClose: () => void;
  onSaved: () => void;
}

function parseCsv(text: string): string[] {
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

export function SettingsModal({ config, onClose, onSaved }: Props) {
  const [backend, setBackend] = useState(config.copilot.backend || 'claude-code');
  const [model, setModel] = useState(config.copilot.model ?? '');
  const [effort, setEffort] = useState(config.copilot.effort ?? '');
  const [columns, setColumns] = useState<Record<BoardName, string>>(() => {
    const o = {} as Record<BoardName, string>;
    for (const b of BOARDS) o[b] = (config.boards[b]?.columns ?? []).join(', ');
    return o;
  });
  const [miniatureChars, setMiniatureChars] = useState(config.miniatureChars);
  const [idPadding, setIdPadding] = useState(config.idPadding);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Models depend on the chosen backend (claude aliases vs `opencode models`).
  useEffect(() => {
    let live = true;
    listModels(backend).then((m) => { if (live) setModels(m); }).catch(() => { if (live) setModels([]); });
    return () => { live = false; };
  }, [backend]);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const boards = {} as ProjectConfig['boards'];
      for (const b of BOARDS) boards[b] = { columns: parseCsv(columns[b]) };
      await patchConfig({
        copilot: { backend, model: model || undefined, effort: effort || undefined },
        boards,
        miniatureChars: Number(miniatureChars) || config.miniatureChars,
        idPadding: Number(idPadding) || config.idPadding,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Settings</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="settings-section">Copilot</div>
          <div className="field"><span>Backend</span>
            <div className="mode-group">
              {BACKENDS.map((b) => (
                <button key={b.value} className={`mode-btn${backend === b.value ? ' active' : ''}`} onClick={() => { setBackend(b.value); setModel(''); }}>
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <label className="field"><span>Default model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">(backend default)</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.free ? `🆓 ${m.id}` : m.id}</option>)}
            </select>
          </label>
          <label className="field"><span>Default effort</span>
            <select value={effort} onChange={(e) => setEffort(e.target.value)}>
              {EFFORTS.map((e) => <option key={e} value={e}>{e || '(default)'}</option>)}
            </select>
          </label>

          <div className="settings-section">Boards</div>
          <div className="settings-hint">Columns are comma-separated (left→right). Renaming or removing a column doesn't move existing cards — move them first.</div>
          {BOARDS.map((b) => (
            <label key={b} className="field"><span>{BOARD_LABELS[b]} columns</span>
              <input value={columns[b]} onChange={(e) => setColumns((c) => ({ ...c, [b]: e.target.value }))} />
            </label>
          ))}

          <div className="settings-section">Cards</div>
          <div className="settings-row">
            <label className="field"><span>Miniature length</span>
              <input type="number" value={miniatureChars} onChange={(e) => setMiniatureChars(Number(e.target.value))} />
            </label>
            <label className="field"><span>ID padding</span>
              <input type="number" value={idPadding} onChange={(e) => setIdPadding(Number(e.target.value))} />
            </label>
          </div>

          {error && <div className="modal-error">{error}</div>}
        </div>

        <div className="modal-foot">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy}>Save</button>
        </div>
      </div>
    </div>
  );
}
