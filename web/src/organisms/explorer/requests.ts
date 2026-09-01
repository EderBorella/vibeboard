import type { FsNode } from '../../lib/api';
import type { ConfirmRequest } from '../../lib/useConfirm';

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

// SAVING SOMETHING THAT IS NOT THE USER'S CONTENT — git internals, board state, or a run's scratch
// space. A warning and never a refusal: the tab reaches these on purpose, and repairing a config by
// hand is the reason it does. What is not acceptable is doing it without being told.
//
// It quotes the server's own sentence rather than composing one here. That sentence is written against
// `core/layout.ts` in `core/sensitive-paths.ts`, and a second wording in the browser would be a second
// thing to keep true.
//
// NOT `danger`, and not a typed confirmation. Nothing is destroyed and nothing is unrecoverable — the
// file on disk is replaced by what is already on screen. Dressing it as a deletion would teach people to
// click through the dialogs that ARE deletions.
export function saveSensitiveRequest(path: string, why: string): ConfirmRequest {
  return {
    title: `Save over ${path}?`,
    body: why,
    action: 'Save it',
  };
}
