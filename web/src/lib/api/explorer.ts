// ---- Explorer --------------------------------------------------------------
// The project as it is on disk. No category and no allow-list, unlike the control files in
// `control.ts` — the only boundary is the project root, enforced server-side.

import { post, request } from './http';

// Mirrors `SensitivePath` in src/core/sensitive-paths.ts. The KINDS are here and the sentence is not
// re-derived: the server sends `why`, because it is written against `core/layout.ts`'s directories and a
// second copy of that reasoning in the browser is a second copy that goes stale.
export interface SensitivePath {
  kind: 'git-internal' | 'board-state' | 'run-scratch';
  why: string;
}

export interface FsNode {
  path: string; // root-relative POSIX
  name: string;
  kind: 'file' | 'dir' | 'other';
  size?: number;
  symlink?: true;
  target?: string;
  escapes?: true; // points outside the project: shown so it can be removed, never opened
  sensitive?: SensitivePath; // not the user's content: git internals, board state, a run's scratch
}

export interface DirListing {
  path: string;
  parent: string | null;
  entries: FsNode[];
  truncated?: number; // entries the server did not return
}

// Three outcomes rather than a boolean: what the pane says differs, so the difference is data.
export type FileRead =
  | { kind: 'text'; path: string; name: string; size: number; content: string; sensitive?: SensitivePath }
  | { kind: 'binary'; path: string; name: string; size: number }
  | { kind: 'too-large'; path: string; name: string; size: number };

export async function listDir(path: string): Promise<DirListing> {
  const url = `/api/explorer/list?path=${encodeURIComponent(path)}`;
  return (await request(url, {}, { fallback: 'Failed to list folder' })).json();
}

export async function readFsFile(path: string): Promise<FileRead> {
  const url = `/api/explorer/file?path=${encodeURIComponent(path)}`;
  return (await request(url, {}, { fallback: 'Failed to load file' })).json();
}

export async function putFsFile(path: string, content: string): Promise<void> {
  await request(
    '/api/explorer/file',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, content }),
    },
    { fallback: 'Failed to save file' },
  );
}

// Created with a server-assigned default name ("Untitled.md", "Untitled 2.md", …), which the tree
// then renames in place. The client never builds a path — same rule as the control routes.
export function createFsNode(parent: string, kind: 'file' | 'dir'): Promise<FsNode> {
  return post<FsNode>('/api/explorer/create', { parent, kind });
}

// `name` is a literal basename, not a path: a rename must not be able to relocate anything.
export function renameFsNode(path: string, name: string): Promise<FsNode> {
  return post<FsNode>('/api/explorer/rename', { path, name });
}

// `to` is the destination folder; the name comes along unchanged.
export function moveFsNode(path: string, to: string): Promise<FsNode> {
  return post<FsNode>('/api/explorer/move', { path, to });
}

// One entry: a file, a link, or an empty folder. 'not-empty' is a normal answer rather than an error —
// the caller has a harder question to ask in that case.
export async function deleteFsEntry(path: string): Promise<'ok' | 'not-empty'> {
  const url = `/api/explorer/entry?path=${encodeURIComponent(path)}`;
  // 409 is `allow`ed rather than caught: it is this endpoint's second normal answer, and the caller
  // has a harder question to ask the user in that case.
  const res = await request(url, { method: 'DELETE' }, { allow: [409], fallback: 'Failed to delete' });
  return res.status === 409 ? 'not-empty' : 'ok';
}

// A folder and everything in it. `confirm` is the folder's own name as the user typed it; the server
// checks it again, so this is not the only thing standing in the way.
export async function deleteFsTree(path: string, confirm: string): Promise<void> {
  const url = `/api/explorer/tree?path=${encodeURIComponent(path)}&confirm=${encodeURIComponent(confirm)}`;
  await request(url, { method: 'DELETE' }, { fallback: 'Failed to delete folder' });
}
