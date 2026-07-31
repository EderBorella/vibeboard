import { realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

// The path rule, shared by every feature that touches files on a client's say-so: Project Control's
// allow-listed documents and the Explorer's whole-project tree. Deliberately one copy — two copies
// of a check like this drift, and the one that drifts is the one nobody re-reads.

export interface ResolvedPath {
  abs: string;
  rel: string; // normalised, root-relative, POSIX
}

// Normalise a client-supplied path to root-relative POSIX, or null if it is not one we accept.
// '' is the project root and comes back as ''; callers that cannot act on the root reject it.
export function normaliseRel(rel: unknown): string | null {
  if (typeof rel !== 'string') return null;
  const posix = rel.split(sep).join('/');
  if (posix.startsWith('/')) return null; // absolute — not ours to interpret
  const parts = posix.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.includes('..')) return null; // no traversal, however it is spelled
  return parts.join('/');
}

export interface ResolveOptions {
  // Act on the project root itself. Off by default: reading or removing the root is never what a
  // caller meant unless it says so.
  allowRoot?: boolean;
  // Resolve the final segment through a symlink. True for reading and writing — the bytes have to
  // live inside the project. False for deleting or renaming the entry itself, where the symlink IS
  // the target and following it would check the wrong path.
  follow?: boolean;
}

export async function resolveInRoot(
  root: string,
  rel: unknown,
  opts: ResolveOptions = {},
): Promise<ResolvedPath | null> {
  const posix = normaliseRel(rel);
  if (posix === null) return null;
  if (posix === '' && !opts.allowRoot) return null;
  const abs = resolve(root, posix);
  // Belt to normaliseRel's braces: whatever resolve() made of the path, it still has to be under root.
  if (relative(root, abs).startsWith('..')) return null;
  const follow = opts.follow ?? true;
  const check = follow || posix === '' ? abs : dirname(abs);
  if (!(await withinRootRealpath(root, check))) return null;
  return { abs, rel: posix };
}

// Walk up to the nearest existing ancestor and compare its realpath with the root's, so a symlink
// anywhere along the path cannot land outside the project — including one whose own target does not
// exist yet, which is why the loop climbs instead of resolving once.
export async function withinRootRealpath(root: string, abs: string): Promise<boolean> {
  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch {
    return false;
  }
  let cur = abs;
  for (;;) {
    try {
      const real = await realpath(cur);
      return real === rootReal || real.startsWith(rootReal + sep);
    } catch {
      const parent = resolve(cur, '..');
      if (parent === cur) return false; // hit the filesystem root without finding an existing ancestor
      cur = parent;
    }
  }
}
