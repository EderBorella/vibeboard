import { describe, expect, it } from 'vitest';
import type { FsNode } from '../web/src/api.js';
import { canDropInto, nameOf, parentOf } from '../web/src/explorer/paths.js';

const node = (path: string, kind: FsNode['kind'] = 'file'): FsNode => ({
  path,
  name: nameOf(path),
  kind,
});

describe('parentOf and nameOf', () => {
  it('splits a nested path', () => {
    expect(parentOf('a/b/c.md')).toBe('a/b');
    expect(nameOf('a/b/c.md')).toBe('c.md');
  });

  it('treats a root-level entry as living in the project root', () => {
    expect(parentOf('a.md')).toBe('');
    expect(nameOf('a.md')).toBe('a.md');
  });
});

describe('canDropInto', () => {
  it('allows a move into an unrelated folder, and back out to the root', () => {
    expect(canDropInto(node('a.md'), 'docs')).toBe(true);
    expect(canDropInto(node('docs/a.md'), '')).toBe(true);
    expect(canDropInto(node('docs/a.md'), 'attic')).toBe(true);
  });

  it('refuses a drop where the entry already is', () => {
    // A drag that lands where it started is a no-op; offering it as a target invites a pointless call.
    expect(canDropInto(node('docs/a.md'), 'docs')).toBe(false);
    expect(canDropInto(node('a.md'), '')).toBe(false);
  });

  it('refuses a folder into itself or into its own descendant', () => {
    // The move that would detach the subtree. Checked here so the row never lights up as a target.
    const folder = node('a', 'dir');
    expect(canDropInto(folder, 'a')).toBe(false);
    expect(canDropInto(folder, 'a/b')).toBe(false);
    expect(canDropInto(folder, 'a/b/c')).toBe(false);
  });

  it('does not mistake a sibling with a shared prefix for a descendant', () => {
    // `docs-old` starts with `docs` but is not inside it — a prefix test without the separator would
    // refuse a legitimate move, and this is the same bug the server had a test for.
    expect(canDropInto(node('docs', 'dir'), 'docs-old')).toBe(true);
  });

  it('refuses everything when nothing is being dragged', () => {
    expect(canDropInto(null, 'docs')).toBe(false);
    expect(canDropInto(null, '')).toBe(false);
  });
});
