import { useCallback, useEffect, useState } from 'react';
import { type FileRead, type FsNode, putFsFile, readFsFile } from '../api';
import { formatBytes } from '../explorer/format';
import { useTree } from '../explorer/useTree';
import type { ProjectSnapshot } from '../shared';
import { EditorBody, EditorShell, type EditorView } from './EditorShell';
import { FileTree } from './FileTree';

interface Props {
  // Bumps whenever the project changes on disk, so the tree and the open file follow along.
  snapshot: ProjectSnapshot;
}

// Why a file cannot be edited here, in the words the pane shows. Both are honest about being
// temporary: the file is really there, and this tab simply has no reader for it yet.
function unopenable(read: FileRead): string {
  return read.kind === 'binary'
    ? `${formatBytes(read.size)} of binary — no reader for this kind of file yet. It can still be renamed, moved or deleted.`
    : `${formatBytes(read.size)} — too large to open in the editor. It can still be renamed, moved or deleted.`;
}

// The Explorer tab: the whole project as a tree, with a text editor beside it. Owns what is selected,
// what is loaded and the editor buffer; the tree and the shell are presentation.
export function ExplorerView({ snapshot }: Props) {
  const tree = useTree(snapshot);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<FileRead | null>(null);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<EditorView>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (path: string): Promise<void> => {
    setError(null);
    try {
      const read = await readFsFile(path);
      setOpen(read);
      setDraft(read.kind === 'text' ? read.content : '');
      setDirty(false);
    } catch (e) {
      setOpen(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Follow the file on disk while the buffer is clean, so an agent's edit appears — and never while
  // it is dirty, which would throw away typing. `snapshot` is the trigger; nothing here reads it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate trigger
  useEffect(() => {
    if (selected && !dirty) void load(selected);
  }, [snapshot]);

  function activate(node: FsNode): void {
    if (node.kind === 'dir' || node.escapes || node.kind === 'other') {
      tree.toggle(node);
      return;
    }
    setSelected(node.path);
    void load(node.path);
  }

  async function save(): Promise<void> {
    if (open?.kind !== 'text') return;
    setBusy(true);
    setError(null);
    try {
      await putFsFile(open.path, draft);
      setDirty(false);
      await load(open.path);
      await tree.reload(parentOf(open.path)); // the size in the tree just changed
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="control explorer">
      <FileTree
        rows={tree.rows}
        selected={selected}
        busy={tree.busy}
        error={tree.error}
        onActivate={activate}
        onRefresh={() => void tree.refresh()}
      />

      <div className="control-editor">
        {open ? (
          <EditorShell
            path={open.path}
            dirty={dirty}
            views={open.kind === 'text' ? ['edit', 'preview'] : []}
            view={view}
            onView={setView}
            actions={
              open.kind === 'text' && (
                <button className="btn-primary" disabled={busy || !dirty} onClick={() => void save()}>
                  Save
                </button>
              )
            }
          >
            {open.kind === 'text' ? (
              <EditorBody
                view={view}
                draft={draft}
                onDraft={(v) => {
                  setDraft(v);
                  setDirty(true);
                }}
              />
            ) : (
              <div className="control-blank">{unopenable(open)}</div>
            )}
          </EditorShell>
        ) : (
          <div className="control-blank">Select a file to view or edit it.</div>
        )}
        {error && <div className="control-error">{error}</div>}
      </div>
    </section>
  );
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}
