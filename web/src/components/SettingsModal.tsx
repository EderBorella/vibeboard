import { useEffect, useState } from 'react';
import {
  BOARDS, BOARD_LABELS, DEFAULT_CONTEXT_BUDGET, backendCaps, backendDefaults,
  type BoardName, type CopilotBackendConfig, type ProjectConfig,
} from '../shared';
import { listModels, patchConfig, type ModelOption } from '../api';
import { resolveChoice, clampToCaps } from '../copilot/choice';
import { ModelPicker } from './ModelPicker';

const BACKENDS: { value: string; label: string }[] = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'opencode', label: 'OpenCode' },
];

interface Props {
  config: ProjectConfig;
  onClose: () => void;
  onSaved: () => void;
}

function parseCsv(text: string): string[] {
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

export function SettingsModal({ config, onClose, onSaved }: Props) {
  const [backend, setBackend] = useState(resolveChoice(config.copilot, {}).backend);
  // One editable slot per backend, so editing OpenCode's model cannot disturb Claude's. The
  // two are separate settings that happen to share one pair of controls; keeping a single slot
  // meant switching connector overwrote the model saved for the one you left.
  const [slots, setSlots] = useState<Record<string, CopilotBackendConfig>>(() => {
    const o: Record<string, CopilotBackendConfig> = {};
    for (const b of BACKENDS) o[b.value] = resolveChoice(config.copilot, { backend: b.value });
    return o;
  });
  // Never blank: an unset model used to mean "the CLI picks", which hid what was running.
  const { model, effort } = slots[backend] ?? resolveChoice(config.copilot, { backend });
  const setModel = (m: string): void => setSlots((s) => ({ ...s, [backend]: { ...s[backend], model: m } }));
  const setEffort = (e: string): void => setSlots((s) => ({ ...s, [backend]: { ...s[backend], effort: e } }));
  const [columns, setColumns] = useState<Record<BoardName, string>>(() => {
    const o = {} as Record<BoardName, string>;
    for (const b of BOARDS) o[b] = (config.boards[b]?.columns ?? []).join(', ');
    return o;
  });
  const [miniatureChars, setMiniatureChars] = useState(config.miniatureChars);
  const [idPadding, setIdPadding] = useState(config.idPadding);
  const [keepChats, setKeepChats] = useState(config.keepChats ?? 20);
  const [contextBudget, setContextBudget] = useState(config.contextBudget ?? DEFAULT_CONTEXT_BUDGET);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caps = backendCaps(backend);

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
        // Every backend's slot, not just the active one — the modal can edit both.
        copilot: { backend, backends: slots },
        boards,
        miniatureChars: Number(miniatureChars) || config.miniatureChars,
        idPadding: Number(idPadding) || config.idPadding,
        keepChats: Number(keepChats) || (config.keepChats ?? 20),
        contextBudget: Number(contextBudget) || DEFAULT_CONTEXT_BUDGET,
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
                <button
                  key={b.value}
                  className={`mode-btn${backend === b.value ? ' active' : ''}`}
                  // Only the selected backend changes: each backend's model/effort live in
                  // their own slot, so switching here reveals that backend's saved choice
                  // instead of overwriting it with a built-in default.
                  onClick={() => setBackend(b.value)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field"><span>Default model</span>
            <ModelPicker models={models} value={model} defaultModel={backendDefaults(backend).model} onChange={setModel} />
          </div>
          <label className="field"><span>Default {backend === 'opencode' ? 'variant' : 'effort'}</span>
            <select
              value={clampToCaps({ backend, model, effort }, 'plan').effort}
              onChange={(e) => setEffort(e.target.value)}
            >
              {caps.efforts.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Keep last N chats</span>
            <input type="number" min={1} value={keepChats} onChange={(e) => setKeepChats(Number(e.target.value))} />
          </label>
          <label className="field"><span>Context window (tokens)</span>
            <input
              type="number" min={1000} step={1000} value={contextBudget}
              onChange={(e) => setContextBudget(Number(e.target.value))}
            />
          </label>
          <div className="settings-hint">
            What the context bar treats as full. Set it to the window of the model you actually
            use — {DEFAULT_CONTEXT_BUDGET.toLocaleString()} over-reports occupancy several times
            over on a million-token model.
          </div>

          <div className="settings-section">Boards</div>
          <div className="settings-hint">
            Columns are comma-separated (left→right). Renaming one moves its folder, so its cards
            come with it. A column that still holds cards can't be removed, and renaming and
            reordering in the same save is refused — do those one at a time.
          </div>
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
