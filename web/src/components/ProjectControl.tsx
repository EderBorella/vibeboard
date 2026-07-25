import { useCallback, useEffect, useState } from 'react';
import {
  type ControlCategory,
  type ControlFile,
  type ControlGroup,
  createControlFile,
  deleteControlFile,
  getControlFile,
  listControlFiles,
  putControlFile,
  renameControlFile,
} from '../api';
import type { ProjectSnapshot } from '../shared';
import { ControlFileEditor, type ControlView, type OpenFile } from './ControlFileEditor';
import { ControlFileList, RESOURCES_SENTINEL } from './ControlFileList';
import { ResourcesEditor } from './ResourcesEditor';

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

// Owns everything the two panes share: what is selected, what is loaded, and the editor buffer.
// The list and the editor are presentation; the async file operations live here.
export function ProjectControl({ snapshot }: Props) {
  const [groups, setGroups] = useState<ControlGroup[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<ControlView>('edit');
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
  // snapshot is a trigger, not an input: neither effect reads it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate trigger
  useEffect(() => {
    void refreshGroups();
  }, [refreshGroups, snapshot]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: adding file would loop via setFile
  useEffect(() => {
    if (file && !dirty) void loadFile(file.path);
  }, [snapshot]);

  function select(path: string): void {
    setSelected(path);
    if (path === RESOURCES_SENTINEL) {
      setFile(null);
      return;
    }
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
    if (!file?.deletable) return;
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
      <ControlFileList
        groups={groups}
        selected={selected}
        renaming={renaming}
        renameDraft={renameDraft}
        onSelect={select}
        onNew={(category) => void newFile(category)}
        onStartRename={startRename}
        onRenameDraft={setRenameDraft}
        onCommitRename={() => void commitRename()}
        onCancelRename={() => setRenaming(null)}
      />

      <div className="control-editor">
        {selected === RESOURCES_SENTINEL ? (
          <ResourcesEditor onError={setError} />
        ) : file ? (
          <ControlFileEditor
            file={file}
            draft={draft}
            dirty={dirty}
            view={view}
            busy={busy}
            onView={setView}
            onDraft={(v) => {
              setDraft(v);
              setDirty(true);
            }}
            onSave={save}
            onDelete={remove}
          />
        ) : (
          <div className="control-blank">Select a file to view or edit, or create a new one.</div>
        )}
        {error && <div className="control-error">{error}</div>}
      </div>
    </section>
  );
}
