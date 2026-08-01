import type { FsNode } from '../api';

// Path arithmetic on root-relative POSIX paths, shared by the tree and the view so there is one
// notion of "the folder this lives in". '' is the project root throughout.

export function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

export function nameOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

// Whether `dir` is a legitimate destination for a drag of `node`. The server refuses the same three
// cases; this is what stops the row lighting up as a target in the first place, so the user is not
// invited to make a move that will only fail.
export function canDropInto(node: FsNode | null, dir: string): boolean {
  if (!node) return false;
  if (dir === parentOf(node.path)) return false; // already there: a no-op, not a move
  if (dir === node.path) return false; // into itself
  if (dir.startsWith(`${node.path}/`)) return false; // into its own descendant, which detaches it
  return true;
}
