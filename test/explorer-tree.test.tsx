// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirListing, FsNode } from '../web/src/api.js';

const api = vi.hoisted(() => ({ listDir: vi.fn() }));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { flatten, useTree } = await import('../web/src/explorer/useTree.js');

const dir = (path: string, name = path.split('/').pop() ?? path): FsNode => ({
  path,
  name,
  kind: 'dir',
});
const file = (path: string, size = 1): FsNode => ({
  path,
  name: path.split('/').pop() ?? path,
  kind: 'file',
  size,
});

const listing = (path: string, entries: FsNode[], truncated?: number): DirListing => ({
  path,
  parent: path === '' ? null : path.split('/').slice(0, -1).join('/'),
  entries,
  ...(truncated ? { truncated } : {}),
});

describe('flatten', () => {
  it('is empty until the root has been listed', () => {
    expect(flatten(new Map(), new Set())).toEqual([]);
  });

  it('lists one level while nothing is expanded', () => {
    const map = new Map([['', listing('', [dir('docs'), file('a.md')])]]);
    expect(flatten(map, new Set())).toEqual([
      { kind: 'node', node: dir('docs'), depth: 0, expanded: false },
      { kind: 'node', node: file('a.md'), depth: 0, expanded: false },
    ]);
  });

  it('splices an expanded folder in beneath its own row, one level deeper', () => {
    const map = new Map([
      ['', listing('', [dir('docs'), file('z.md')])],
      ['docs', listing('docs', [file('docs/a.md')])],
    ]);
    const rows = flatten(map, new Set(['docs']));
    expect(rows.map((r) => (r.kind === 'node' ? [r.node.path, r.depth] : ['more', r.depth]))).toEqual([
      ['docs', 0],
      ['docs/a.md', 1],
      ['z.md', 0],
    ]);
    expect(rows[0]).toMatchObject({ expanded: true });
  });

  it('nests three levels, so depth is a distance and not a boolean', () => {
    // Two levels cannot tell `depth + 1` from a fixed 1.
    const map = new Map([
      ['', listing('', [dir('a')])],
      ['a', listing('a', [dir('a/b')])],
      ['a/b', listing('a/b', [file('a/b/c.md')])],
    ]);
    const rows = flatten(map, new Set(['a', 'a/b']));
    expect(rows.map((r) => (r.kind === 'node' ? r.depth : -1))).toEqual([0, 1, 2]);
  });

  it('shows an expanded folder as open before its listing has arrived', () => {
    // The row must respond to the click immediately; the children fill in when the fetch lands.
    const map = new Map([['', listing('', [dir('docs')])]]);
    expect(flatten(map, new Set(['docs']))).toEqual([
      { kind: 'node', node: dir('docs'), depth: 0, expanded: true },
    ]);
  });

  it('marks a file in the expanded set as neither open nor expandable', () => {
    // Selecting a file must never make the tree try to nest under it.
    const map = new Map([['', listing('', [file('a.md')])]]);
    expect(flatten(map, new Set(['a.md']))[0]).toMatchObject({ expanded: false });
  });

  it('adds the truncation row at the end of the folder it belongs to', () => {
    const map = new Map([
      ['', listing('', [dir('big'), file('z.md')])],
      ['big', listing('big', [file('big/a.md')], 499)],
    ]);
    const rows = flatten(map, new Set(['big']));
    expect(rows[2]).toEqual({ kind: 'more', parent: 'big', depth: 1, count: 499 });
    expect(rows[3]).toMatchObject({ kind: 'node', node: file('z.md') }); // the parent list continues
  });
});

afterEach(cleanup);
beforeEach(() => {
  api.listDir.mockReset();
});

// A rejecting mock must be `...Once`. On vitest 2.1.9, a standing rejection — mockRejectedValue, or
// a mockImplementation that rejects or throws — reports an unhandled rejection however carefully the
// caller handles it, while the assertions themselves pass. Verified against all four forms; every
// other rejecting mock in this suite happens to use Once, which is why none of them tripped over it.

describe('useTree', () => {
  it('lists the root on mount', async () => {
    api.listDir.mockResolvedValue(listing('', [file('a.md')]));
    const { result } = renderHook(() => useTree(0));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(api.listDir.mock.calls).toEqual([['']]);
    expect(result.current.busy).toBe(false);
  });

  it('lists a folder the first time it is opened, and not again on reopen', async () => {
    api.listDir.mockImplementation((path: string) =>
      Promise.resolve(path === '' ? listing('', [dir('docs')]) : listing('docs', [file('docs/a.md')])),
    );
    const { result } = renderHook(() => useTree(0));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    act(() => result.current.toggle(dir('docs')));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    act(() => result.current.toggle(dir('docs'))); // collapse
    expect(result.current.rows).toHaveLength(1);
    act(() => result.current.toggle(dir('docs'))); // and open again
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    // Two calls, not three: the second open is served from the cache.
    expect(api.listDir.mock.calls).toEqual([[''], ['docs']]);
  });

  it('does not try to list a file, or a link out of the project', async () => {
    api.listDir.mockResolvedValue(listing('', [file('a.md')]));
    const { result } = renderHook(() => useTree(0));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    act(() => result.current.toggle(file('a.md')));
    act(() =>
      result.current.toggle({ path: 'escape', name: 'escape', kind: 'dir', escapes: true, symlink: true }),
    );
    expect(api.listDir.mock.calls).toEqual([['']]);
  });

  it('re-lists every open folder when the project changes on disk', async () => {
    api.listDir.mockImplementation((path: string) =>
      Promise.resolve(path === '' ? listing('', [dir('docs')]) : listing('docs', [file('docs/a.md')])),
    );
    const { result, rerender } = renderHook(({ t }) => useTree(t), { initialProps: { t: 0 } });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    act(() => result.current.toggle(dir('docs')));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    api.listDir.mockClear();
    rerender({ t: 1 });
    // Both, not just the root: a folder left open must not go stale.
    await waitFor(() => expect(api.listDir.mock.calls.map(([p]) => p).sort()).toEqual(['', 'docs']));
  });

  it('reports a failure to read the root, where nothing else could explain an empty tree', async () => {
    api.listDir.mockRejectedValueOnce(new Error('No project open'));
    const { result } = renderHook(() => useTree(0));
    await waitFor(() => expect(result.current.error).toBe('No project open'));
    expect(result.current.busy).toBe(false);
  });

  it('drops a folder that has gone without raising a banner, and collapses it', async () => {
    // An agent deleting a folder is routine. The row disappearing says it; a red error would not.
    // In call order: the root lists, then the folder being opened has already gone.
    api.listDir.mockResolvedValueOnce(listing('', [dir('gone')])).mockRejectedValueOnce(new Error('nope'));
    const { result } = renderHook(() => useTree(0));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    act(() => result.current.toggle(dir('gone')));
    // Waiting on the ROWS, not on `error`. `error` is already null before the toggle, so a waitFor on
    // it is satisfied on the first tick and the assertions below then race the collapse — which is
    // exactly how this flaked once under full-suite load. Toggling sets `expanded: true` immediately
    // and the failed listing collapses it back, so the row is the only thing that changes twice.
    await waitFor(() =>
      expect(result.current.rows).toEqual([{ kind: 'node', node: dir('gone'), depth: 0, expanded: false }]),
    );
    expect(result.current.error).toBeNull();
  });

  it('re-lists one folder on request, for after a write', async () => {
    let size = 1;
    api.listDir.mockImplementation(() => Promise.resolve(listing('', [file('a.md', size)])));
    const { result } = renderHook(() => useTree(0));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    size = 42; // as a save would change it
    await act(() => result.current.reload(''));
    expect(result.current.rows[0]).toMatchObject({ node: { size: 42 } });
  });
});
