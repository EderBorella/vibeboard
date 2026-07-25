import { useEffect, useMemo, useState } from 'react';
import type { ModelOption } from '../api';

const FAV_KEY = 'vb-fav-models';

function loadFavs(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

interface Props {
  models: ModelOption[];
  value: string;
  defaultModel: string; // this backend's default — pinned to the top of the list
  onChange: (id: string) => void;
  disabled?: boolean;
}

// Provider is the id prefix (opencode/deepseek/openrouter); claude aliases have none.
function providerOf(id: string): string {
  const i = id.indexOf('/');
  return i < 0 ? 'claude' : id.slice(0, i);
}

function fmtCtx(n?: number): string {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function fmtPrice(m: ModelOption): string {
  if (m.free) return 'Free';
  if (m.promptPerM == null) return '';
  return `$${m.promptPerM} / $${m.completionPerM ?? 0}`;
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
      localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
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
    const q = query.trim().toLowerCase();
    return models
      .filter((m) => {
        if (m.id === value || m.id === defaultModel) return true; // never hide the selection or the default
        if (toolOnly && !m.caps?.toolCall) return false;
        if (freeOnly && !m.free) return false;
        if (visionOnly && !m.caps?.vision) return false;
        if (provider !== 'all' && providerOf(m.id) !== provider) return false;
        if (q && !`${m.id} ${m.name ?? ''}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        // The backend's default sits at the top, above favourites: it's the answer to "what
        // am I getting if I don't think about this?", so it should never need scrolling for.
        if ((a.id === defaultModel) !== (b.id === defaultModel)) return a.id === defaultModel ? -1 : 1;
        const fa = favs.has(a.id),
          fb = favs.has(b.id);
        if (fa !== fb) return fa ? -1 : 1; // favorites next
        if (a.free !== b.free) return a.free ? -1 : 1; // then free
        return (a.name ?? a.id).localeCompare(b.name ?? b.id);
      });
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
              <button className="mp-modal-close" onClick={() => setOpen(false)}>
                ✕
              </button>
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
                  <button
                    className="mp-star"
                    title={favs.has(m.id) ? 'Unfavorite' : 'Favorite'}
                    onClick={() => toggleFav(m.id)}
                  >
                    {favs.has(m.id) ? '★' : '☆'}
                  </button>
                  <button className="mp-pick" onClick={() => pick(m.id)}>
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
                  </button>
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
