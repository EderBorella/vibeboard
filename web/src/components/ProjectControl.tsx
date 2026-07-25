import { useCallback, useEffect, useState } from 'react';
import {
  listControlFiles,
  getControlFile,
  putControlFile,
  deleteControlFile,
  createControlFile,
  renameControlFile,
  getResources,
  putResources,
  type ControlGroup,
  type ControlCategory,
  type ControlFile,
  type ResourceLink,
} from '../api';
import type { ProjectSnapshot } from '../shared';
import { renderMarkdown } from '../markdown';

const RESOURCES_SENTINEL = '@resources'; // selects the links registry rather than a file

interface OpenFile {
  path: string;
  name: string;
  category: ControlCategory;
  managed: boolean;
  deletable: boolean;
  content: string;
}

interface Props {
  // Bumps whenever the project changes on disk (shared snapshot stream) so the file list and
  // the open file refresh when the copilot creates/edits control files.
  snapshot: ProjectSnapshot;
}

// Names are shown/edited without the .md extension — the server slugs what you type into the
// real filename, so "Design Notes" becomes docs/design-notes.md.
function editableName(name: string): string {
  return name.replace(/\.md$/i, '');
}

export function ProjectControl({ snapshot }: Props) {
  const [groups, setGroups] = useState<ControlGroup[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Path currently being renamed in the list, plus its in-progress text. Set right after a
  // create so the new file lands with its name selected and ready to type over.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const refreshGroups = useCallback(async () => {
    try {
      setGroups(await listControlFiles());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadFile = useCallback(async (path: string) => {
    setError(null);
    try {
      const f = await getControlFile(path);
      setFile(f);
      setDraft(f.content);
      setDirty(false);
      setView('edit');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Initial load + live refresh: refetch the list whenever the project changes on disk, and
  // reload the open file's content when the editor has no unsaved edits.
  useEffect(() => { void refreshGroups(); }, [refreshGroups, snapshot]);
  useEffect(() => {
    if (file && !dirty) void loadFile(file.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  function select(path: string): void {
    setSelected(path);
    if (path === RESOURCES_SENTINEL) { setFile(null); return; }
    void loadFile(path);
  }

  // Create immediately with a server-assigned default name, then open it and put the list row
  // into rename mode. No browser dialog — those can be suppressed, which would kill the feature.
  async function newFile(category: ControlCategory): Promise<void> {
    setError(null);
    try {
      const created = await createControlFile(category);
      await refreshGroups();
      setSelected(created.path);
      await loadFile(created.path);
      setRenaming(created.path);
      setRenameDraft(editableName(created.name));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function startRename(f: ControlFile): void {
    if (f.category === 'instructions') return; // fixed filenames the CLIs look for
    setRenaming(f.path);
    setRenameDraft(editableName(f.name));
  }

  async function commitRename(): Promise<void> {
    const path = renaming;
    if (!path) return;
    const name = renameDraft.trim();
    const current = groups.flatMap((g) => g.files).find((f) => f.path === path);
    setRenaming(null);
    if (!name || name === editableName(current?.name ?? '')) return; // nothing to do
    setError(null);
    try {
      const updated = await renameControlFile(path, name);
      await refreshGroups();
      setSelected(updated.path);
      await loadFile(updated.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function save(): Promise<void> {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await putControlFile(file.path, draft);
      setDirty(false);
      await refreshGroups();
      await loadFile(file.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!file || !file.deletable) return;
    if (!window.confirm(`Delete ${file.path}? This removes the file from disk.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteControlFile(file.path);
      setFile(null);
      setSelected(null);
      await refreshGroups();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="control">
      <nav className="control-list">
        {groups.map((g) => (
          <div key={g.key} className="control-group">
            <div className="control-group-head">
              <span>{g.label}</span>
              {g.key !== 'instructions' && (
                <button
                  className="control-new"
                  title={`New ${g.label.toLowerCase().replace(/s$/, '')}`}
                  onClick={() => void newFile(g.key)}
                >
                  ＋
                </button>
              )}
            </div>
            {g.key === 'resources' && (
              <button
                className={`control-item${selected === RESOURCES_SENTINEL ? ' active' : ''}`}
                onClick={() => select(RESOURCES_SENTINEL)}
              >
                <span className="control-item-name">🔗 Links registry</span>
              </button>
            )}
            {g.files.length === 0 && g.key !== 'resources' && <div className="control-empty">— none —</div>}
            {g.files.map((f) => (
              renaming === f.path ? (
                <input
                  key={f.path}
                  className="control-rename"
                  value={renameDraft}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
                    if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); }
                  }}
                />
              ) : (
                <button
                  key={f.path}
                  className={`control-item${selected === f.path ? ' active' : ''}`}
                  title={`${f.path}${f.deletable ? ' · double-click to rename' : ''}`}
                  onClick={() => select(f.path)}
                  onDoubleClick={() => startRename(f)}
                >
                  <span className="control-item-name">{f.name}</span>
                  {f.managed && <span className="control-tag">managed</span>}
                </button>
              )
            ))}
          </div>
        ))}
      </nav>

      <div className="control-editor">
        {selected === RESOURCES_SENTINEL ? (
          <ResourcesEditor onError={setError} />
        ) : file ? (
          <>
            <div className="control-editor-head">
              <span className="control-editor-path">{file.path}{dirty ? ' •' : ''}</span>
              <div className="control-tabs" role="group" aria-label="View">
                <button className={view === 'edit' ? 'active' : ''} onClick={() => setView('edit')}>Edit</button>
                <button className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}>Preview</button>
              </div>
              <div className="control-editor-actions">
                {file.deletable && <button className="btn-danger" disabled={busy} onClick={remove}>Delete</button>}
                <button className="btn-primary" disabled={busy || !dirty} onClick={save}>Save</button>
              </div>
            </div>
            {file.managed && (
              <div className="control-disclaimer" role="alert">
                ⚠ <strong>{file.name}</strong> is managed by VibeBoard — the copilot won’t edit it, and
                it steers how the boards work. Edit only if you know what you’re doing. For your own
                standing instructions, use <strong>INSTRUCTIONS.md</strong> instead.
              </div>
            )}
            {view === 'edit' ? (
              <textarea
                className="control-textarea"
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
                spellCheck={false}
              />
            ) : (
              <div className="control-preview markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }} />
            )}
          </>
        ) : (
          <div className="control-blank">Select a file to view or edit, or create a new one.</div>
        )}
        {error && <div className="control-error">{error}</div>}
      </div>
    </section>
  );
}

// The links registry (.vibeboard/resources.yaml) — a small editable table of external
// references the user (and copilot) can consult.
function ResourcesEditor({ onError }: { onError: (e: string | null) => void }) {
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
