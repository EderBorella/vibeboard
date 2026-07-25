import type { BackendCaps } from '../shared';
import type { ModelOption } from '../api';
import { ModelPicker } from '../components/ModelPicker';

interface Props {
  // Modes and efforts are backend-specific; the caller passes the caps of the backend in force.
  caps: BackendCaps;
  // Already clamped to `caps` by the caller — these are what the dock highlights.
  effMode: string;
  effEffort: string;
  effModel: string;
  defaultModel: string;
  models: ModelOption[];
  running: boolean;
  onMode: (m: string) => void;
  onModel: (m: string) => void;
  onEffort: (e: string) => void;
  onCompact: () => void;
}

// Mode buttons, Compact, and the model/effort selects.
export function CopilotControls({
  caps,
  effMode,
  effEffort,
  effModel,
  defaultModel,
  models,
  running,
  onMode,
  onModel,
  onEffort,
  onCompact,
}: Props) {
  return (
    <>
      <div className="copilot-controls">
        <div className="mode-group" role="group" aria-label="Mode">
          {caps.modes.map((m) => (
            <button
              key={m.value}
              className={`mode-btn${effMode === m.value ? ' active' : ''}`}
              title={m.hint}
              disabled={running}
              onClick={() => onMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="copilot-actions">
          <button onClick={onCompact} disabled={running} title="Compact the conversation">
            Compact
          </button>
        </div>
      </div>

      <div className="copilot-selects">
        <ModelPicker
          models={models}
          value={effModel}
          defaultModel={defaultModel}
          disabled={running}
          onChange={onModel}
        />
        <select
          className="effort-select"
          value={effEffort}
          disabled={running}
          onChange={(e) => onEffort(e.target.value)}
        >
          {caps.efforts.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
