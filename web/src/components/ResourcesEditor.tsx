import { useEffect, useState } from 'react';
import { getResources, putResources, type ResourceLink } from '../api';

// The links registry (.vibeboard/resources.yaml) — a small editable table of external
// references the user (and copilot) can consult. It owns its own rows and dirty flag because
// nothing outside this pane reads them; only errors are handed back up to the shared banner.
export function ResourcesEditor({ onError }: { onError: (e: string | null) => void }) {
  const [links, setLinks] = useState<ResourceLink[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getResources().then((l) => { if (live) { setLinks(l); setDirty(false); } }).catch((e) => onError(e.message));
    return () => { live = false; };
  }, [onError]);

  const update = (i: number, patch: Partial<ResourceLink>): void => {
    setLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
    setDirty(true);
  };
  const add = (): void => { setLinks((prev) => [...prev, { title: '', url: '' }]); setDirty(true); };
  const removeRow = (i: number): void => { setLinks((prev) => prev.filter((_, idx) => idx !== i)); setDirty(true); };

  async function save(): Promise<void> {
    setBusy(true);
    onError(null);
    try {
      const clean = links.filter((l) => l.title.trim() || l.url.trim());
      await putResources(clean);
      setLinks(clean);
      setDirty(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="control-editor-head">
        <span className="control-editor-path">Links registry{dirty ? ' •' : ''}</span>
        <div className="control-editor-actions">
          <button className="btn-secondary" onClick={add}>＋ Add link</button>
          <button className="btn-primary" disabled={busy || !dirty} onClick={save}>Save</button>
        </div>
      </div>
      <div className="resources-table">
        {links.length === 0 && <div className="control-blank">No links yet. Add references the copilot can consult.</div>}
        {links.map((l, i) => (
          <div key={i} className="resource-row">
            <input className="res-title" placeholder="Title" value={l.title} onChange={(e) => update(i, { title: e.target.value })} />
            <input className="res-url" placeholder="https://…" value={l.url} onChange={(e) => update(i, { url: e.target.value })} />
            <input className="res-note" placeholder="Note (optional)" value={l.note ?? ''} onChange={(e) => update(i, { note: e.target.value })} />
            <button className="res-del" title="Remove" onClick={() => removeRow(i)}>✕</button>
          </div>
        ))}
      </div>
    </>
  );
}
