import { lstat, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { type FsNode, readFileNode } from './explorer-list.js';
import { normaliseRel, resolveInRoot } from './fs-sandbox.js';

// Changing the project from the Explorer tab. Same boundary as reading it (fs-sandbox.ts) and the
// same absence of an allow-list: any path under the root is fair game.

export type WriteResult = 'ok' | 'not-text' | 'invalid';

// Save a text file. Refuses to write over a file the app could not show — a binary or oversized file
// never reached the editor as text, so whatever is in the buffer is not a version of it.
export async function writeFileNode(root: string, rel: unknown, content: unknown): Promise<WriteResult> {
  const r = await resolveInRoot(root, rel);
  if (!r || typeof content !== 'string') return 'invalid';
  const existing = await readFileNode(root, rel);
  if (existing === 'not-a-file') return 'invalid'; // a directory
  if (existing !== null && existing.kind !== 'text') return 'not-text';
  try {
    // No mkdir: saving a file is not permission to build a path. A missing parent means the tree the
    // client is working from is stale, and inventing directories would hide that.
    await writeFile(r.abs, content, 'utf8');
  } catch {
    return 'invalid';
  }
  return 'ok';
}

// --- Names ------------------------------------------------------------------

// The longest single filename most filesystems accept, in bytes rather than characters — an emoji
// costs four.
const MAX_NAME_BYTES = 255;

// A literal filename, unlike Project Control which slugs a display name into one. In a file explorer
// the name IS the filename: slugging "Q3 Notes.md" into "q3-notes.md" would be the tab lying about
// what it just wrote.
//
// Only what the filesystem cannot represent, or what means something else, is refused. A backslash is
// allowed: it is a legal character here, and rejecting it would be this module inventing a rule.
export function validName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (trimmed === '' || trimmed === '.' || trimmed === '..') return null;
  if (trimmed.includes('/') || trimmed.includes('\0')) return null;
  if (Buffer.byteLength(trimmed) > MAX_NAME_BYTES) return null;
  return trimmed;
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await lstat(abs); // lstat, so a dangling symlink still counts as occupied
    return true;
  } catch {
    return false;
  }
}

async function isDir(abs: string): Promise<boolean> {
  try {
    return (await stat(abs)).isDirectory();
  } catch {
    return false;
  }
}

// --- Creating ---------------------------------------------------------------

const DEFAULT_NAMES = { file: 'Untitled.md', dir: 'New folder' } as const;

export type NewKind = keyof typeof DEFAULT_NAMES;

export function isNewKind(k: unknown): k is NewKind {
  return k === 'file' || k === 'dir';
}

// "Untitled.md" → "Untitled 2.md": the counter goes before the extension, so the file stays a
// markdown file however many times + is clicked.
function numbered(base: string, n: number): string {
  if (n === 1) return base;
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? `${base} ${n}` : `${base.slice(0, dot)} ${n}${base.slice(dot)}`;
}

async function freeName(parentAbs: string, base: string): Promise<string | null> {
  for (let n = 1; n < 1000; n++) {
    const candidate = numbered(base, n);
    if (!(await pathExists(join(parentAbs, candidate)))) return candidate;
  }
  return null;
}

// Create an empty file or a folder with a default, collision-free name. The client then renames the
// row in place — the same flow as Project Control, and for the same reason: a browser prompt can be
// suppressed, which would leave no way to name anything.
export async function createNode(root: string, parent: unknown, kind: unknown): Promise<FsNode | 'invalid'> {
  if (!isNewKind(kind)) return 'invalid';
  const p = await resolveInRoot(root, parent, { allowRoot: true });
  if (!p || !(await isDir(p.abs))) return 'invalid';
  const name = await freeName(p.abs, DEFAULT_NAMES[kind]);
  if (!name) return 'invalid';
  const abs = join(p.abs, name);
  try {
    if (kind === 'dir') await mkdir(abs);
    else await writeFile(abs, '', { encoding: 'utf8', flag: 'wx' }); // wx: never clobber a race
  } catch {
    return 'invalid';
  }
  return {
    path: p.rel === '' ? name : `${p.rel}/${name}`,
    name,
    kind,
    ...(kind === 'file' ? { size: 0 } : {}),
  };
}

// --- Renaming and moving ----------------------------------------------------

export type MoveResult = FsNode | 'taken' | 'into-self' | 'invalid';

// Rename in place: a new basename, same parent.
export async function renameNode(root: string, rel: unknown, name: unknown): Promise<MoveResult> {
  const from = normaliseRel(rel);
  const clean = validName(name);
  if (from === null || from === '' || clean === null) return 'invalid';
  const parent = from.includes('/') ? `${from.slice(0, from.lastIndexOf('/'))}/` : '';
  return moveNode(root, from, `${parent}${clean}`);
}

// Move into another folder, keeping the name: what a drag onto a folder row means.
export async function moveIntoDir(root: string, rel: unknown, toDir: unknown): Promise<MoveResult> {
  const from = normaliseRel(rel);
  const dir = normaliseRel(toDir);
  if (from === null || from === '' || dir === null) return 'invalid';
  const target = await resolveInRoot(root, dir, { allowRoot: true });
  if (!target || !(await isDir(target.abs))) return 'invalid';
  return moveNode(root, from, dir === '' ? basename(from) : `${dir}/${basename(from)}`);
}

// The one primitive both of the above are: rename() moves and renames alike.
//
// Resolved with follow:false because the thing being moved may itself be a symlink — following it
// would rename whatever it points at, or refuse when it points out of the project.
async function moveNode(root: string, from: string, to: string): Promise<MoveResult> {
  const source = await resolveInRoot(root, from, { follow: false });
  const dest = await resolveInRoot(root, to, { follow: false });
  if (!source || !dest) return 'invalid';
  if (source.rel === dest.rel) return await describe(root, dest.rel); // asked for the name it has
  // A folder cannot swallow itself. Compared with a trailing separator, so `docs` does not match
  // `docs-old` — equality is already the no-op case above.
  if (dest.rel.startsWith(`${source.rel}/`)) return 'into-self';
  if (await pathExists(dest.abs)) return 'taken';
  if (!(await isDir(dirname(dest.abs)))) return 'invalid'; // no such destination folder
  try {
    await rename(source.abs, dest.abs);
  } catch {
    return 'invalid';
  }
  return await describe(root, dest.rel);
}

// The moved entry as the client will list it. lstat, so a moved symlink reports as a link rather
// than as whatever it points at.
async function describe(root: string, rel: string): Promise<FsNode> {
  const abs = join(root, rel);
  const node: FsNode = { path: rel, name: basename(rel), kind: 'other' };
  try {
    const info = await lstat(abs);
    if (info.isSymbolicLink()) node.symlink = true;
    const real = info.isSymbolicLink() ? await stat(abs).catch(() => null) : info;
    if (real?.isDirectory()) node.kind = 'dir';
    else if (real?.isFile()) {
      node.kind = 'file';
      node.size = real.size;
    }
  } catch {
    /* moved and then removed by something else; the client re-lists anyway */
  }
  return node;
}
