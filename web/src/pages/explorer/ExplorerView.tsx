import { useState } from 'react';
import { Button } from '../../atoms/Button';
import { Text } from '../../atoms/Text';
import {
  createFsNode,
  deleteFsEntry,
  deleteFsTree,
  type FileRead,
  type FsNode,
  listDir,
  moveFsNode,
  renameFsNode,
} from '../../lib/api';
import { errorText } from '../../lib/errors';
import type { ProjectSnapshot } from '../../lib/shared';
import { useConfirm } from '../../lib/useConfirm';
import { FileTree } from '../../organisms/explorer/FileTree';
import { formatBytes } from '../../organisms/explorer/format';
import { nameOf, parentOf } from '../../organisms/explorer/paths';
import {
  deleteEmptyFolderRequest,
  deleteEntryRequest,
  deleteFolderRequest,
} from '../../organisms/explorer/requests';
import { useOpenFile } from '../../organisms/explorer/useOpenFile';
import { useTree } from '../../organisms/explorer/useTree';
import { EditorBody, EditorLayout } from '../../organisms/shared/EditorLayout';

interface Props {
  // Bumps whenever the project changes on disk, so the tree and the open file follow along.
  snapshot: ProjectSnapshot;
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
  const { confirm, dialog } = useConfirm();
  const [selected, setSelected] = useState<FsNode | null>(null);
  // The row being renamed and the text in it. Set right after a create, so a new file lands with its
  // name selected and ready to type over — no browser prompt, which can be suppressed.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // What is being dragged. State rather than a ref, unlike the board's: the tree needs to re-render to
  // stop offering the folders this node cannot legally land in.
  const [dragging, setDragging] = useState<FsNode | null>(null);
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
      setError(errorText(e));
    }
  }

  // Delete, in four steps so that no one of them is doing two jobs: pick the question, ask it, act,
  // then put the tab back in a consistent state.
  async function remove(): Promise<void> {
    const node = selected;
    if (!node) return;
    setError(null);
    try {
      // A symlink is ONE entry however it behaves, so it is never the recursive question — even a link
      // to a folder inside the project, where deleting the link must leave the folder alone.
      const folder = node.kind === 'dir' && !node.symlink;
      if (folder ? await removeFolder(node) : await removeEntry(node)) await afterDelete(node);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function removeEntry(node: FsNode): Promise<boolean> {
    if (!(await confirm(deleteEntryRequest(node)))) return false;
    if ((await deleteFsEntry(node.path)) === 'not-empty') {
      // Only reachable through a race: something landed in the folder between the count and the click.
      setError('That folder is no longer empty. Refresh and try again.');
      return false;
    }
    return true;
  }

  // An empty folder goes with one click; a folder with contents asks for its name to be typed. Which
  // question to ask is decided by counting first, so the user is never asked twice for one delete.
  async function removeFolder(node: FsNode): Promise<boolean> {
    const listing = await listDir(node.path).catch(() => null);
    const count = listing ? listing.entries.length + (listing.truncated ?? 0) : 0;
    if (count === 0) {
      if (!(await confirm(deleteEmptyFolderRequest(node)))) return false;
      return (await deleteFsEntry(node.path)) === 'ok';
    }
    if (!(await confirm(deleteFolderRequest(node, count)))) return false;
    await deleteFsTree(node.path, node.name);
    return true;
  }

  async function afterDelete(node: FsNode): Promise<void> {
    setSelected(null);
    // The editor may be showing the file just deleted, or one that was inside a deleted folder.
    const shown = open.file?.path;
    if (shown === node.path || shown?.startsWith(`${node.path}/`)) open.close();
    await tree.reload(parentOf(node.path));
  }

  // Drop onto a folder row, or onto the header for the project root. The server checks the same three
  // refusals; FileTree simply does not light up a row it knows would be refused.
  async function dropInto(dir: string): Promise<void> {
    const node = dragging;
    setDragging(null);
    if (!node) return;
    setError(null);
    try {
      const moved = await moveFsNode(node.path, dir);
      await tree.reload(parentOf(node.path)); // where it came from
      await tree.open(dir); // and where it went, expanded so it can be seen to have arrived
      setSelected(moved);
      if (open.file?.path === node.path) await open.open(moved.path);
    } catch (e) {
      setError(errorText(e));
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
      setError(errorText(e));
    }
  }

  const file = open.file;
  return (
    <section className="control explorer">
      <FileTree
        rows={tree.rows}
        selected={selected}
        busy={tree.busy}
        error={tree.error}
        newIn={newInFor(selected)}
        renaming={renaming}
        renameDraft={renameDraft}
        onActivate={activate}
        onRefresh={() => void tree.refresh()}
        onNew={(kind) => void newNode(kind)}
        onDelete={() => void remove()}
        dragging={dragging}
        onDragStart={setDragging}
        onDropInto={(dir) => void dropInto(dir)}
        onStartRename={startRename}
        onRenameDraft={setRenameDraft}
        onCommitRename={() => void commitRename()}
        onCancelRename={() => setRenaming(null)}
      />

      <div className="vb-editor" data-fill>
        {file ? (
          <EditorLayout
            path={file.path}
            dirty={open.dirty}
            views={file.kind === 'text' ? ['edit', 'preview'] : []}
            view={open.view}
            onView={open.setView}
            actions={
              file.kind === 'text' && (
                <Button
                  variant="primary"
                  size="md"
                  disabled={open.busy || !open.dirty}
                  onClick={() => void save()}
                >
                  Save
                </Button>
              )
            }
          >
            {file.kind === 'text' ? (
              <EditorBody view={open.view} draft={open.draft} onDraft={open.edit} />
            ) : (
              <Text lead className="empty">
                {unopenable(file)}
              </Text>
            )}
          </EditorLayout>
        ) : (
          <Text lead className="empty">
            Select a file to view or edit it.
          </Text>
        )}
        {(error ?? open.error) && <Text role="error">{error ?? open.error}</Text>}
      </div>

      {dialog}
    </section>
  );
}
