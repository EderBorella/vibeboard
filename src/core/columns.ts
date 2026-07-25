import { readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { ARCHIVE_SLUG } from './board.js';
import { slugify } from './slug.js';
import type { BoardName } from './types.js';

// Keeping config and disk in step when columns change.
//
// A column IS a folder, so renaming a column has to rename the folder or its cards silently
// disappear from the board (they stay on disk, but nothing reads that folder any more). The
// columns list is ordered, which is what lets us tell a rename from an add/remove/reorder:
//
//   same name at every position          -> nothing to do
//   same set, different order            -> pure reorder, folders untouched
//   one name replaced in place           -> rename that folder
//   name gone, nothing took its place    -> removal (refused if it still holds cards)
//   new name, nothing left               -> addition (folder created lazily by the first card)
//
// Anything that mixes a rename with a reorder is ambiguous, so we refuse rather than guess and
// risk moving cards into the wrong column.

interface ColumnsChanged {
  renamed: { from: string; to: string }[];
}
interface ColumnsRefused {
  error: string;
}
type ReconcileResult = ColumnsChanged | ColumnsRefused;

export function isRefused(r: ReconcileResult): r is ColumnsRefused {
  return 'error' in r;
}

// Reject column lists that can't work on disk, before anything is written.
export function validateColumns(names: string[]): string | null {
  if (names.length === 0) return 'A board needs at least one column.';
  const seen = new Set<string>();
  for (const name of names) {
    const slug = slugify(name);
    if (!slug) return `"${name}" is not a valid column name.`;
    if (slug === ARCHIVE_SLUG) return `"${name}" is reserved — archive is where deleted cards go.`;
    if (seen.has(slug)) return `Duplicate column "${name}" — names must differ after slugging.`;
    seen.add(slug);
  }
  return null;
}

async function cardCount(dir: string): Promise<number> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.md')).length;
  } catch {
    return 0; // folder doesn't exist yet
  }
}

async function folderExists(dir: string): Promise<boolean> {
  try {
    await readdir(dir);
    return true;
  } catch {
    return false;
  }
}

type Renames = { from: string; to: string }[];
type DirOf = (slug: string) => string;

// Pair renames positionally, but only where BOTH sides are genuinely new/gone — if the name at
// this position moved somewhere else in the list, the edit is a reorder+rename mix.
function pairRenames(oldSlugs: string[], newSlugs: string[]): Renames | ColumnsRefused {
  if (oldSlugs.length !== newSlugs.length) return [];
  const oldSet = new Set(oldSlugs);
  const newSet = new Set(newSlugs);
  const renamed: Renames = [];
  for (let i = 0; i < oldSlugs.length; i++) {
    if (oldSlugs[i] === newSlugs[i]) continue;
    if (newSet.has(oldSlugs[i]) || oldSet.has(newSlugs[i])) {
      return { error: 'That mixes renaming and reordering columns. Please make one change at a time.' };
    }
    renamed.push({ from: oldSlugs[i], to: newSlugs[i] });
  }
  return renamed;
}

// A column that vanished and was not renamed away must not take cards with it.
async function refuseNonEmptyRemoval(
  dir: DirOf,
  oldNames: string[],
  oldSlugs: string[],
  newSlugs: string[],
  renamed: Renames,
): Promise<ColumnsRefused | null> {
  const newSet = new Set(newSlugs);
  const renamedFrom = new Set(renamed.map((r) => r.from));
  for (let i = 0; i < oldSlugs.length; i++) {
    const slug = oldSlugs[i];
    if (newSet.has(slug) || renamedFrom.has(slug)) continue;
    const count = await cardCount(dir(slug));
    if (count > 0) {
      return {
        error: `"${oldNames[i]}" still has ${count} card${count === 1 ? '' : 's'}. Move or archive them before removing the column.`,
      };
    }
  }
  return null;
}

// Never merge into an occupied folder — that would mix two columns' cards together.
async function refuseOccupiedTarget(
  dir: DirOf,
  renamed: Renames,
  newNames: string[],
  newSlugs: string[],
): Promise<ColumnsRefused | null> {
  for (const r of renamed) {
    if (await folderExists(dir(r.to))) {
      const target = newNames[newSlugs.indexOf(r.to)];
      return {
        error: `A folder for "${target}" already exists. Rename it to something else, or merge the cards yourself.`,
      };
    }
  }
  return null;
}

export async function reconcileColumns(
  projectRoot: string,
  board: BoardName,
  oldNames: string[],
  newNames: string[],
): Promise<ReconcileResult> {
  const oldSlugs = oldNames.map(slugify);
  const newSlugs = newNames.map(slugify);
  const dir: DirOf = (slug) => join(projectRoot, board, slug);

  // Same set of columns: at most a reorder, which is purely a config concern.
  const newSet = new Set(newSlugs);
  if (oldSlugs.length === newSlugs.length && oldSlugs.every((s) => newSet.has(s))) {
    return { renamed: [] };
  }

  const renamed = pairRenames(oldSlugs, newSlugs);
  if (!Array.isArray(renamed)) return renamed;

  const removal = await refuseNonEmptyRemoval(dir, oldNames, oldSlugs, newSlugs, renamed);
  if (removal) return removal;
  const occupied = await refuseOccupiedTarget(dir, renamed, newNames, newSlugs);
  if (occupied) return occupied;

  for (const r of renamed) {
    if (await folderExists(dir(r.from))) await rename(dir(r.from), dir(r.to));
  }
  return { renamed };
}
