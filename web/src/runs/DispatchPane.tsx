import { useState } from 'react';
import type { DispatchRequest, ModelOption, RunRecord, Skill } from '../api';
import { BackendPicker } from '../copilot/BackendPicker';
import { clampToCaps } from '../copilot/choice';
import { ModelPicker } from '../models/ModelPicker';
import { backendCaps, type Card } from '../shared';
import { Button } from '../ui/Button';

interface Props {
  skill: Skill;
  card: Card;
  // The project's saved selection, already resolved — the same defaults the chat starts from.
  defaults: { backend: string; model: string; effort: string };
  models: ModelOption[];
  // Project files that can be attached, project-root-relative.
  attachable: string[];
  // The run this dispatch continues, when it came from an attention report.
  previous?: RunRecord;
  // A prompt to start from: an option the user picked on an attention report. Editable.
  initialPrompt?: string;
  busy: boolean;
  error: string | null;
  onDispatch: (request: DispatchRequest) => void;
  onBack: () => void;
  onBackend: (backend: string) => void;
}

// The details step: what to run, with what, and on top of what. Everything is pre-populated from
// the project's defaults, and every control is the user's to change — the skill itself carries no
// backend, model, effort or mode, so nothing here is fixed by the file.
export function DispatchPane({
  skill,
  card,
  defaults,
  models,
  attachable,
  previous,
  initialPrompt,
  busy,
  error,
  onDispatch,
  onBack,
  onBackend,
}: Props) {
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [mode, setMode] = useState('bypassPermissions');
  const [model, setModel] = useState(defaults.model);
  const [effort, setEffort] = useState(defaults.effort);
  const backend = defaults.backend;

  // Modes and efforts are backend-specific, so a value carried across a backend switch is clamped
  // to what this backend actually publishes — the same rule the copilot dock follows.
  const caps = backendCaps(backend);
  const clamped = clampToCaps({ backend, model, effort }, mode);

  const toggle = (path: string): void =>
    setAttachments((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));

  const dispatch = (): void =>
    onDispatch({
      board: card.board,
      card: card.id,
      skill: skill.slug,
      prompt: prompt.trim() || undefined,
      attachments,
      previous: previous?.run,
      backend,
      model,
      effort: clamped.effort,
      mode: clamped.mode,
    });

  return (
    <section className="dispatch" aria-label={`Run ${skill.name} on ${card.id}`}>
      <header className="dispatch-head">
        <Button size="sm" onClick={onBack} title="Back to the card">
          ←
        </Button>
        <h3 className="dispatch-title">
          {skill.name} <span className="dispatch-on">on {card.id}</span>
        </h3>
      </header>
      <p className="dispatch-desc">{skill.description}</p>
      {previous && (
        <p className="dispatch-continues">
          Continues run {previous.run}. Its report goes to the agent with this one.
        </p>
      )}

      <div className="dispatch-row">
        <span className="dispatch-label">Connector</span>
        {/* THE SHARED PICKER, and the fourth call site to get it. This one built its own group from
            `BACKEND_DEFAULTS`'s KEYS, so it showed a person the raw id — "claude-code" — where the dock
            showed "Claude" and Settings showed "Claude Code": one setting with three spellings, two of
            them written by hand. */}
        <BackendPicker value={backend} onChange={onBackend} label="Connector" />
      </div>

      <div className="dispatch-row">
        <span className="dispatch-label">Model</span>
        <ModelPicker models={models} value={model} defaultModel={defaults.model} onChange={setModel} />
      </div>

      <div className="dispatch-row">
        <span className="dispatch-label">Effort</span>
        <select
          className="theme-select"
          aria-label="Effort"
          value={clamped.effort}
          onChange={(e) => setEffort(e.target.value)}
        >
          {caps.efforts.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
      </div>

      <div className="dispatch-row">
        <span className="dispatch-label">Mode</span>
        <div className="mode-group" role="group" aria-label="Mode">
          {caps.modes.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`mode-btn${clamped.mode === m.value ? ' active' : ''}`}
              title={m.hint}
              onClick={() => setMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <label className="dispatch-prompt-label" htmlFor="dispatch-prompt">
        Anything to add?
      </label>
      <textarea
        id="dispatch-prompt"
        className="dispatch-prompt"
        rows={4}
        placeholder="Optional. This goes last in the prompt, so it qualifies the skill rather than competing with it."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      {attachable.length > 0 && (
        <details className="dispatch-attach">
          <summary>Attach material{attachments.length > 0 ? ` (${attachments.length})` : ''}</summary>
          <p className="dispatch-hint">
            Paths are passed to the agent, which reads what it needs. Reference links from the resources
            registry always go with a run.
          </p>
          {attachable.map((path) => (
            <label key={path} className="link-option">
              <input type="checkbox" checked={attachments.includes(path)} onChange={() => toggle(path)} />
              <span className="link-title">{path}</span>
            </label>
          ))}
        </details>
      )}

      {error !== null && <p className="dispatch-error">{error}</p>}

      <div className="dispatch-foot">
        <Button size="md" onClick={onBack}>
          Cancel
        </Button>
        <Button variant="primary" size="md" disabled={busy} onClick={dispatch}>
          {busy ? 'A run is in flight' : `Run ${skill.name}`}
        </Button>
      </div>
    </section>
  );
}
