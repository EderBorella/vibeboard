import { useEffect, useRef, useState } from 'react';
import type { ModelOption } from '../api';

const FAV_KEY = 'vb-fav-models';

function loadFavs(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]')); } catch { return new Set(); }
}

interface Props {
  models: ModelOption[];
  value: string;               // '' = backend default
  onChange: (id: string) => void;
  disabled?: boolean;
}

// Searchable model dropdown with star-to-favorite (favorites pinned to top, persisted).
export function ModelPicker({ models, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [favs, setFavs] = useState<Set<string>>(loadFavs);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggleFav = (id: string): void => {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const pick = (id: string): void => { onChange(id); setOpen(false); setQuery(''); };

  const meta = (m: ModelOption): string => {
    const parts: string[] = [];
    if (m.free) parts.push('free');
    else if (m.promptPerM != null) parts.push(`$${m.promptPerM.toFixed(2)}/${(m.completionPerM ?? 0).toFixed(2)} per M`);
    if (m.contextLength) parts.push(`${Math.round(m.contextLength / 1000)}k ctx`);
    return parts.join(' · ');
  };

  const q = query.trim().toLowerCase();
  const filtered = q ? models.filter((m) => m.id.toLowerCase().includes(q)) : models;
  const favModels = filtered.filter((m) => favs.has(m.id));
  const rest = filtered.filter((m) => !favs.has(m.id));

  const selected = models.find((m) => m.id === value);
  const label = value ? `${selected?.free ? '🆓 ' : ''}${value}` : 'Default model';

  const row = (m: ModelOption): React.ReactNode => (
    <div key={m.id} className={`mp-item${m.id === value ? ' mp-sel' : ''}`}>
      <button className="mp-star" title={favs.has(m.id) ? 'Unfavorite' : 'Favorite'} onClick={() => toggleFav(m.id)}>
        {favs.has(m.id) ? '★' : '☆'}
      </button>
      <button className="mp-pick" onClick={() => pick(m.id)}>
        <span className="mp-pick-main">
          {m.free && <span className="mp-free">🆓</span>}
          <span className="mp-id">{m.id}</span>
        </span>
        {meta(m) && <span className="mp-meta">{meta(m)}</span>}
      </button>
    </div>
  );

  return (
    <div className="mp" ref={ref}>
      <button className="mp-trigger" disabled={disabled} onClick={() => setOpen((v) => !v)} title={label}>
        <span className="mp-trigger-label">{label}</span>
        <span className="mp-caret">▾</span>
      </button>
      {open && (
        <div className="mp-panel">
          <input
            className="mp-search"
            autoFocus
            value={query}
            placeholder="Search models…"
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="mp-list">
            <button className={`mp-default${value === '' ? ' mp-sel' : ''}`} onClick={() => pick('')}>Default model</button>
            {favModels.length > 0 && <div className="mp-group">★ Favorites</div>}
            {favModels.map(row)}
            {favModels.length > 0 && rest.length > 0 && <div className="mp-group">All models</div>}
            {rest.map(row)}
            {filtered.length === 0 && <div className="mp-empty">No models match “{query}”.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
