import { useCallback, useEffect, useRef, useState } from 'react';
import { type DirListing, type FsNode, listDir } from '../../lib/api';
import { errorText } from '../../lib/errors';

// The Explorer's tree state: which directories have been listed, which are open, and the flat list
// of rows that comes out of the two. Listings are per-directory and lazy — an eager walk would
// recurse into node_modules and .git, which are deliberately reachable here.

export type TreeRow =
  | { kind: 'node'; node: FsNode; depth: number; expanded: boolean }
  // The tail of a directory the server capped. Rendered as a row rather than dropped, so a
  // truncated listing never reads as a complete one.
  | { kind: 'more'; parent: string; depth: number; count: number };

// Pure, and exported for its own test: the ordering and the depths are the whole behaviour of the
// tree, and they are much easier to pin down here than through a rendered component.
export function flatten(
  listings: Map<string, DirListing>,
  expanded: Set<string>,
  path = '',
  depth = 0,
): TreeRow[] {
  const listing = listings.get(path);
  if (!listing) return [];
  const rows: TreeRow[] = [];
  for (const node of listing.entries) {
    const open = node.kind === 'dir' && expanded.has(node.path);
    rows.push({ kind: 'node', node, depth, expanded: open });
    if (open) rows.push(...flatten(listings, expanded, node.path, depth + 1));
  }
  if (listing.truncated) rows.push({ kind: 'more', parent: path, depth, count: listing.truncated });
  return rows;
}

interface Tree {
  rows: TreeRow[];
  busy: boolean;
  error: string | null;
  toggle: (node: FsNode) => void;
  // Expand a directory and re-list it, whether or not it was already open. What a create calls, so
  // the new row is visible in a folder the user had collapsed.
  open: (path: string) => Promise<void>;
  // Re-list one directory: what a rename or delete calls for its parent.
  reload: (path: string) => Promise<void>;
  // Re-list everything currently open.
  refresh: () => Promise<void>;
}

export function useTree(trigger?: unknown): Tree {
  // The cache and the open set live in refs, with the flattened rows as the published state. They
  // are one source of truth read by a pure function, which is simpler than keeping a Map and a Set
  // in state and rebuilding both immutably on every expand.
  const listings = useRef(new Map<string, DirListing>());
  const expanded = useRef(new Set<string>());
  const [rows, setRows] = useState<TreeRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rebuild = useCallback(() => setRows(flatten(listings.current, expanded.current)), []);

  const reload = useCallback(
    async (path: string): Promise<void> => {
      try {
        listings.current.set(path, await listDir(path));
        setError(null);
      } catch (e) {
        listings.current.delete(path);
        expanded.current.delete(path);
        // A subdirectory that has gone is fully described by no longer being in the tree — an agent
        // deleting a folder must not raise a banner. The root failing is a different matter.
        if (path === '') setError(errorText(e));
      }
      rebuild();
    },
    [rebuild],
  );

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true);
    const paths = listings.current.size > 0 ? [...listings.current.keys()] : [''];
    await Promise.all(paths.map(reload));
    setBusy(false);
  }, [reload]);

  const toggle = useCallback(
    (node: FsNode): void => {
      if (node.kind !== 'dir' || node.escapes) return; // a link out of the project is not traversed
      if (expanded.current.delete(node.path)) {
        rebuild();
        return;
      }
      expanded.current.add(node.path);
      rebuild(); // open immediately; the listing fills in when it lands
      if (!listings.current.has(node.path)) void reload(node.path);
    },
    [reload, rebuild],
  );

  const open = useCallback(
    async (path: string): Promise<void> => {
      expanded.current.add(path);
      await reload(path); // rebuilds, so the newly-opened folder appears with its contents
    },
    [reload],
  );

  // First load, and a re-list whenever the project changes on disk. `trigger` is a signal, not an
  // input — nothing here reads it. Note it does not cover everything: session.ts's watcher ignores
  // node_modules, .git and .vibeboard/{chat,runs}, so changes there wait for the ⟳.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate trigger
  useEffect(() => {
    void refresh();
  }, [trigger]);

  return { rows, busy, error, toggle, open, reload, refresh };
}
