import { useEffect, useMemo, useState } from 'react';
import type { ModelOption } from '../api';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { compareModels, type ModelFilter, matchesFilter } from './model-filter';
import { fmtCtx, fmtPrice, loadFavs, providerOf, saveFavs } from './model-format';

interface Props {
  models: ModelOption[];
  value: string;
  defaultModel: string; // this backend's default — pinned to the top of the list
  onChange: (id: string) => void;
  disabled?: boolean;
}

// Model selector: a trigger button that opens a filterable modal. Filters default to
// tool-capable (the copilot needs tools to edit cards). Favorites persist in localStorage.
export function ModelPicker({ models, value, defaultModel, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [toolOnly, setToolOnly] = useState(true);
  const [freeOnly, setFreeOnly] = useState(false);
  const [visionOnly, setVisionOnly] = useState(false);
  const [provider, setProvider] = useState('all');
  const [favs, setFavs] = useState<Set<string>>(loadFavs);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const toggleFav = (id: string): void => {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavs(next);
      return next;
    });
  };

  const pick = (id: string): void => {
    onChange(id);
    setOpen(false);
  };

  const providers = useMemo(() => {
    const set = new Set(models.map((m) => providerOf(m.id)));
    return ['all', ...[...set].sort()];
  }, [models]);

  const filtered = useMemo(() => {
    const filter: ModelFilter = { query, provider, toolOnly, freeOnly, visionOnly, value, defaultModel };
    return models
      .filter((m) => matchesFilter(m, filter))
      .sort((a, b) => compareModels(a, b, { defaultModel, favs }));
  }, [models, query, toolOnly, freeOnly, visionOnly, provider, favs, value, defaultModel]);

  const selected = models.find((m) => m.id === value);
  const label = selected?.name ?? value ?? '';

  const chip = (on: boolean, set: (v: boolean) => void, text: string): React.ReactNode => (
    <button className={`mp-chip${on ? ' on' : ''}`} onClick={() => set(!on)}>
      {text}
    </button>
  );

  return (
    <div className="mp">
      <button className="mp-trigger" disabled={disabled} onClick={() => setOpen(true)} title={value}>
        <span className="mp-trigger-label">
          {selected?.free ? '🆓 ' : ''}
          {label}
        </span>
        <span className="mp-caret">▾</span>
      </button>

      {open && (
        <div className="mp-modal-backdrop" onClick={() => setOpen(false)}>
          <div className="mp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mp-modal-head">
              <span className="mp-modal-title">Choose a model</span>
              <Button variant="bare" size="sm" className="mp-modal-close" onClick={() => setOpen(false)}>
                ✕
              </Button>
            </div>

            <input
              className="mp-search"
              autoFocus
              value={query}
              placeholder="Search by name or id…"
              onChange={(e) => setQuery(e.target.value)}
            />

            <div className="mp-filters">
              {chip(toolOnly, setToolOnly, '🔧 Tool use')}
              {chip(freeOnly, setFreeOnly, '🆓 Free')}
              {chip(visionOnly, setVisionOnly, '👁 Vision')}
              <select className="mp-prov" value={provider} onChange={(e) => setProvider(e.target.value)}>
                {providers.map((p) => (
                  <option key={p} value={p}>
                    {p === 'all' ? 'All providers' : p}
                  </option>
                ))}
              </select>
            </div>

            <div className="mp-count">
              {filtered.length} of {models.length} models
            </div>

            <div className="mp-list">
              {filtered.map((m) => (
                <div
                  key={m.id}
                  className={`mp-item${m.id === value ? ' mp-sel' : ''}${m.id === defaultModel ? ' mp-def' : ''}`}
                >
                  <Button
                    variant="bare"
                    size="sm"
                    className="mp-star"
                    title={favs.has(m.id) ? 'Unfavorite' : 'Favorite'}
                    onClick={() => toggleFav(m.id)}
                  >
                    {favs.has(m.id) ? '★' : '☆'}
                  </Button>
                  <Panel
                    as="button"
                    variant="flat"
                    className="mp-pick"
                    data-testid="mp-pick"
                    onClick={() => pick(m.id)}
                  >
                    <span className="mp-pick-top">
                      <span className="mp-name">{m.name ?? m.id}</span>
                      {m.id === defaultModel && <span className="mp-def-tag">default</span>}
                      <span className="mp-price">{fmtPrice(m)}</span>
                    </span>
                    <span className="mp-pick-bot">
                      <span className="mp-id">{m.id}</span>
                      <span className="mp-badges">
                        {m.contextLength ? <span className="mp-ctx">{fmtCtx(m.contextLength)}</span> : null}
                        {m.caps?.toolCall && (
                          <span className="mp-badge" title="Tool use">
                            🔧
                          </span>
                        )}
                        {m.caps?.reasoning && (
                          <span className="mp-badge" title="Reasoning">
                            🧠
                          </span>
                        )}
                        {m.caps?.vision && (
                          <span className="mp-badge" title="Vision">
                            👁
                          </span>
                        )}
                      </span>
                    </span>
                  </Panel>
                </div>
              ))}
              {filtered.length === 0 && <div className="mp-empty">No models match the current filters.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
