import type { FsNode } from '../api';
import type { ConfirmRequest } from '../confirm/useConfirm';

// What the Explorer asks before it destroys something. Kept out of the view so the wording is
// readable — and assertable — on its own: these sentences are the only warning the user gets.

// A file, or a link. A link's warning is about the link, not its target: deleting `escape` removes the
// pointer and leaves whatever it pointed at alone, which is the opposite of what most people assume.
export function deleteEntryRequest(node: FsNode): ConfirmRequest {
  if (node.symlink) {
    return {
      title: `Delete the link ${node.name}?`,
      body: `Only the link is removed. ${node.target ?? 'What it points at'} is left alone.`,
      action: 'Delete link',
      danger: true,
    };
  }
  return {
    title: `Delete ${node.name}?`,
    body: `${node.path} is removed from disk. This cannot be undone.`,
    action: 'Delete file',
    danger: true,
  };
}

export function deleteEmptyFolderRequest(node: FsNode): ConfirmRequest {
  return {
    title: `Delete ${node.name}?`,
    body: `${node.path} is empty, and will be removed.`,
    action: 'Delete folder',
    danger: true,
  };
}

// The only typed confirmation in the app. Deleting a folder destroys things the dialog cannot list,
// and the board project is usually not a git repo, so there is nothing to recover from.
export function deleteFolderRequest(node: FsNode, count: number): ConfirmRequest {
  const held = count === 1 ? '1 entry' : `${count} entries`;
  return {
    title: `Delete ${node.name} and everything in it?`,
    body: `${node.path} holds ${held}, and anything inside them. All of it is removed from disk. This cannot be undone.`,
    action: 'Delete folder',
    danger: true,
    requireText: node.name,
  };
}
