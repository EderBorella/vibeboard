import { useState } from 'react';
import { createFsNode, type FileRead, type FsNode, renameFsNode } from '../api';
import { formatBytes } from '../explorer/format';
import { useOpenFile } from '../explorer/useOpenFile';
import { useTree } from '../explorer/useTree';
import type { ProjectSnapshot } from '../shared';
import { EditorBody, EditorShell } from './EditorShell';
import { FileTree } from './FileTree';

interface Props {
  // Bumps whenever the project changes on disk, so the tree and the open file follow along.
  snapshot: ProjectSnapshot;
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

function nameOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

// Where a new file or folder should land: inside the selected folder, beside the selected file, or in
// the project root when nothing is selected.
function newInFor(selected: FsNode | null): string {
  if (!selected) return '';
  return selected.kind === 'dir' && !selected.escapes ? selected.path : parentOf(selected.path);
}

// Why a file cannot be edited here, in the words the pane shows. Both are honest about being
// temporary: the file is really there, and this tab simply has no reader for it yet.
function unopenable(read: FileRead): string {
  return read.kind === 'binary'
    ? `${formatBytes(read.size)} of binary — no reader for this kind of file yet. It can still be renamed, moved or deleted.`
    : `${formatBytes(read.size)} — too large to open in the editor. It can still be renamed, moved or deleted.`;
}

// The Explorer tab: the whole project as a tree, with a text editor beside it. Owns the selection and
// the folder operations; the buffer is useOpenFile's and the rows are useTree's.
export function ExplorerView({ snapshot }: Props) {
  const tree = useTree(snapshot);
  const open = useOpenFile(snapshot);
  const [selected, setSelected] = useState<FsNode | null>(null);
  // The row being renamed and the text in it. Set right after a create, so a new file lands with its
  // name selected and ready to type over — no browser prompt, which can be suppressed.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  function activate(node: FsNode): void {
    setSelected(node);
    if (node.kind === 'dir' || node.escapes || node.kind === 'other') {
      tree.toggle(node);
      return;
    }
    void open.open(node.path);
  }

  async function save(): Promise<void> {
    const file = open.file;
    if (file && (await open.save())) await tree.reload(parentOf(file.path));
  }

  async function newNode(kind: 'file' | 'dir'): Promise<void> {
    const parent = newInFor(selected);
    setError(null);
    try {
      const node = await createFsNode(parent, kind);
      await tree.open(parent); // expand it, or the new row lands out of sight in a closed folder
      setSelected(node);
      setRenaming(node.path);
      setRenameDraft(node.name);
      if (kind === 'file') await open.open(node.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function startRename(node: FsNode): void {
    setRenaming(node.path);
    setRenameDraft(node.name);
  }

  async function commitRename(): Promise<void> {
    const path = renaming;
    if (!path) return;
    const name = renameDraft.trim();
    setRenaming(null);
    if (!name || name === nameOf(path)) return; // nothing to do
    setError(null);
    try {
      const moved = await renameFsNode(path, name);
      await tree.reload(parentOf(path));
      setSelected(moved);
      // The open file just changed path underneath the editor; re-open it under its new name.
      if (open.file?.path === path) await open.open(moved.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const file = open.file;
  return (
    <section className="control explorer">
      <FileTree
        rows={tree.rows}
        selected={selected?.path ?? null}
        busy={tree.busy}
        error={tree.error}
        newIn={newInFor(selected)}
        renaming={renaming}
        renameDraft={renameDraft}
        onActivate={activate}
        onRefresh={() => void tree.refresh()}
        onNew={(kind) => void newNode(kind)}
        onStartRename={startRename}
        onRenameDraft={setRenameDraft}
        onCommitRename={() => void commitRename()}
        onCancelRename={() => setRenaming(null)}
      />

      <div className="control-editor">
        {file ? (
          <EditorShell
            path={file.path}
            dirty={open.dirty}
            views={file.kind === 'text' ? ['edit', 'preview'] : []}
            view={open.view}
            onView={open.setView}
            actions={
              file.kind === 'text' && (
                <button
                  className="btn-primary"
                  disabled={open.busy || !open.dirty}
                  onClick={() => void save()}
                >
                  Save
                </button>
              )
            }
          >
            {file.kind === 'text' ? (
              <EditorBody view={open.view} draft={open.draft} onDraft={open.edit} />
            ) : (
              <div className="control-blank">{unopenable(file)}</div>
            )}
          </EditorShell>
        ) : (
          <div className="control-blank">Select a file to view or edit it.</div>
        )}
        {(error ?? open.error) && <div className="control-error">{error ?? open.error}</div>}
      </div>
    </section>
  );
}
