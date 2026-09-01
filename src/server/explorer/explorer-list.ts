import type { Dirent, Stats } from 'node:fs';
import { readdir, readFile, readlink, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { type SensitivePath, sensitivity } from '../../core/sensitive-paths.js';
import { resolveInRoot, withinRootRealpath } from '../../store/fs-sandbox.js';

// Reading the project as a filesystem, for the Explorer tab.
//
// No allow-list and no filtering, unlike control-files.ts: `.git/`, `node_modules/` and all of
// `.vibeboard/` (cards, chat and run stores included) are listed, because an entry the app hides is
// an entry the user cannot remove — which is the bug that prompted this tab (an empty skill folder
// that could be neither seen nor deleted). What the tab does NOT do is leave the project root; see
// fs-sandbox.ts.

// A directory is listed 500 entries at a time. `.git/objects` and `node_modules` are reachable now,
// so a cap is unavoidable — but the listing carries how many it left out, and the tree says so.
// Silent truncation would read as "this is everything".
export const MAX_ENTRIES = 500;
// Above this a file is reported rather than loaded: a textarea is not a viewer for a 40 MB log.
export const MAX_EDIT_BYTES = 1_048_576;
// A NUL byte in the first block is the usual "this is not text" test — cheap and wrong only for
// exotic encodings, which we would not render anyway.
const SNIFF_BYTES = 8_192;

export interface FsNode {
  path: string; // root-relative POSIX
  name: string;
  // What the entry behaves as, so the tree does not need to reason about links. A symlink to a
  // directory is a 'dir'; a broken or escaping one is 'other'.
  kind: 'file' | 'dir' | 'other';
  size?: number; // files only
  symlink?: true;
  target?: string; // what the link points at, verbatim, for display
  escapes?: true; // resolves outside the project root: listed, never traversed or read
  // WHY EDITING THIS BY HAND IS WORTH A WORD FIRST, when it is. Computed on the server rather than in
  // the browser because the answer is about `core/layout.ts`'s directories, and a second copy of that
  // list in the web tree would drift — the web tree mirrors core deliberately and by hand, so anything
  // derived from it belongs on the wire instead. `undefined` for ordinary content, which is nearly
  // everything.
  sensitive?: SensitivePath;
}

export interface DirListing {
  path: string;
  parent: string | null; // null at the root
  entries: FsNode[];
  truncated?: number; // how many entries were NOT returned
}

// Directories first, then everything else, case-insensitively by name.
//
// Not localeCompare: its ordering depends on the runtime's locale, and this list is a cache key in
// the client. readdir returns hash order on ext4, so the sort is what makes the tree the same on
// every machine.
function byKindThenName(a: FsNode, b: FsNode): number {
  const rank = (n: FsNode): number => (n.kind === 'dir' ? 0 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  const la = a.name.toLowerCase();
  const lb = b.name.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; // stable for names differing only in case
}

function parentOf(rel: string): string {
  const cut = rel.lastIndexOf('/');
  return cut === -1 ? '' : rel.slice(0, cut);
}

function baseKind(e: Dirent): 'file' | 'dir' | 'other' {
  if (e.isDirectory()) return 'dir';
  if (e.isFile()) return 'file';
  return 'other'; // sockets, fifos, devices — listed, because they are really there
}

// Fill in what a symlink actually is. Done before the sort so a link to a directory sorts with the
// directories, and only for symlinks, so a directory of ordinary files costs no extra syscalls.
async function describeLink(root: string, node: FsNode, abs: string): Promise<void> {
  node.symlink = true;
  try {
    node.target = await readlink(abs);
  } catch {
    /* unreadable link — it is still an entry, and still deletable */
  }
  if (!(await withinRootRealpath(root, abs))) {
    node.escapes = true;
    return; // deliberately not stat'ed: that would follow it out of the project
  }
  try {
    const info = await stat(abs);
    node.kind = info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other';
  } catch {
    node.kind = 'other'; // dangling
  }
}

export async function listDir(root: string, rel: unknown): Promise<DirListing | null> {
  const r = await resolveInRoot(root, rel, { allowRoot: true });
  if (!r) return null;
  let entries: Dirent[];
  try {
    entries = await readdir(r.abs, { withFileTypes: true });
  } catch {
    return null; // missing, or not a directory
  }

  const nodes: FsNode[] = entries.map((e) => {
    const path = r.rel === '' ? e.name : `${r.rel}/${e.name}`;
    const flag = sensitivity(path);
    return { path, name: e.name, kind: baseKind(e), ...(flag ? { sensitive: flag } : {}) };
  });
  await Promise.all(
    entries.map((e, i) =>
      e.isSymbolicLink() ? describeLink(root, nodes[i], join(r.abs, e.name)) : Promise.resolve(),
    ),
  );

  nodes.sort(byKindThenName);
  const kept = nodes.slice(0, MAX_ENTRIES);
  // Sizes only for what is being returned, so a directory of 50 000 entries costs 500 stats
  // rather than 50 000.
  await Promise.all(kept.map((n) => addSize(join(root, n.path), n)));

  const listing: DirListing = {
    path: r.rel,
    parent: r.rel === '' ? null : parentOf(r.rel),
    entries: kept,
  };
  if (nodes.length > kept.length) listing.truncated = nodes.length - kept.length;
  return listing;
}

async function addSize(abs: string, node: FsNode): Promise<void> {
  if (node.kind !== 'file' || node.escapes) return;
  try {
    node.size = (await stat(abs)).size;
  } catch {
    /* vanished between readdir and stat — the entry still belongs in the listing */
  }
}

// What a read of one file produced. Three outcomes rather than a boolean, because the difference is
// what the pane tells the user: "not text" and "too big to edit" are different facts.
export type FileRead =
  | { kind: 'text'; path: string; name: string; size: number; content: string; sensitive?: SensitivePath }
  | { kind: 'binary'; path: string; name: string; size: number }
  | { kind: 'too-large'; path: string; name: string; size: number };

export async function readFileNode(root: string, rel: unknown): Promise<FileRead | 'not-a-file' | null> {
  const r = await resolveInRoot(root, rel);
  if (!r) return null;
  let info: Stats;
  try {
    info = await stat(r.abs);
  } catch {
    return null; // missing, or a dangling link
  }
  if (!info.isFile()) return 'not-a-file';
  const head = { path: r.rel, name: basename(r.rel), size: info.size };
  if (info.size > MAX_EDIT_BYTES) return { kind: 'too-large', ...head };
  const buf = await readFile(r.abs);
  if (buf.subarray(0, SNIFF_BYTES).includes(0)) return { kind: 'binary', ...head };
  // Only on the text branch: the other two cannot be edited, so there is no save to warn about.
  const flag = sensitivity(r.rel);
  return { kind: 'text', ...head, content: buf.toString('utf8'), ...(flag ? { sensitive: flag } : {}) };
}
