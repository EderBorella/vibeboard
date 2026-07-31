import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normaliseRel, resolveInRoot, withinRootRealpath } from '../src/server/fs-sandbox.js';
import { tempDir } from './helpers.js';

describe('normaliseRel', () => {
  it('rejects anything that is not a string', () => {
    for (const bad of [undefined, null, 42, {}, ['docs']]) expect(normaliseRel(bad)).toBeNull();
  });

  it('rejects an absolute path — that is not ours to interpret', () => {
    expect(normaliseRel('/etc/passwd')).toBeNull();
    expect(normaliseRel('/')).toBeNull();
  });

  it('rejects traversal however it is spelled', () => {
    // Each of these reaches outside the root by a different route, and one filtered form of `..`
    // (say, only a leading one) would let the rest through.
    expect(normaliseRel('..')).toBeNull();
    expect(normaliseRel('../etc/passwd')).toBeNull();
    expect(normaliseRel('docs/../../etc/passwd')).toBeNull();
    expect(normaliseRel('docs/..')).toBeNull();
    expect(normaliseRel('a/b/../../..')).toBeNull();
  });

  it('keeps a plain relative path as it is', () => {
    expect(normaliseRel('docs/design.md')).toBe('docs/design.md');
    expect(normaliseRel('.claude/skills/review/SKILL.md')).toBe('.claude/skills/review/SKILL.md');
  });

  it('tidies redundant segments so one file has one path', () => {
    // Two spellings of the same file would otherwise be two cache keys in the tree and two
    // different `path` values coming back from the same read.
    expect(normaliseRel('docs/./design.md')).toBe('docs/design.md');
    expect(normaliseRel('docs//design.md')).toBe('docs/design.md');
    expect(normaliseRel('docs/')).toBe('docs');
  });

  it('treats the empty path and "." as the project root', () => {
    expect(normaliseRel('')).toBe('');
    expect(normaliseRel('.')).toBe('');
    expect(normaliseRel('./')).toBe('');
  });

  it('does not mistake a filename containing dots for traversal', () => {
    expect(normaliseRel('..hidden')).toBe('..hidden');
    expect(normaliseRel('docs/...md')).toBe('docs/...md');
  });
});

describe('resolveInRoot', () => {
  it('resolves a path inside the root to its absolute form', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs', 'a.md'), 'hi', 'utf8');
    expect(await resolveInRoot(root, 'docs/a.md')).toEqual({
      abs: join(root, 'docs', 'a.md'),
      rel: 'docs/a.md',
    });
  });

  it('resolves a path that does not exist yet, for creating one', async () => {
    const root = await tempDir();
    const r = await resolveInRoot(root, 'docs/deep/new.md');
    expect(r?.rel).toBe('docs/deep/new.md');
  });

  it('refuses the root unless the caller asks for it', async () => {
    const root = await tempDir();
    expect(await resolveInRoot(root, '')).toBeNull();
    expect(await resolveInRoot(root, '.')).toBeNull();
    expect(await resolveInRoot(root, '', { allowRoot: true })).toEqual({ abs: root, rel: '' });
  });

  it('refuses traversal even when the target exists', async () => {
    const root = await tempDir();
    const outside = join(root, '..', 'vibeboard-outside-probe');
    await writeFile(outside, 'secret', 'utf8');
    expect(await resolveInRoot(root, '../vibeboard-outside-probe')).toBeNull();
  });

  it('refuses to read through a symlink that leaves the root', async () => {
    // The check that matters most: the server is reachable on the LAN with no auth, so a symlink
    // followed out of the project would expose the whole filesystem.
    const root = await tempDir();
    const outside = await tempDir();
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8');
    await symlink(outside, join(root, 'escape'));

    expect(await resolveInRoot(root, 'escape')).toBeNull();
    expect(await resolveInRoot(root, 'escape/secret.txt')).toBeNull();
  });

  it('allows a symlink that stays inside the root', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'real'));
    await writeFile(join(root, 'real', 'a.md'), 'hi', 'utf8');
    await symlink(join(root, 'real'), join(root, 'link'));
    expect((await resolveInRoot(root, 'link/a.md'))?.rel).toBe('link/a.md');
  });

  it('reaches an escaping symlink itself when the caller does not follow it', async () => {
    // Deleting or renaming a symlink acts on the link, not on what it points at — so the parent is
    // what has to be inside the root. Without this, a symlink out of the project would be listed
    // (which the Explorer does deliberately) and then be impossible to remove.
    const root = await tempDir();
    const outside = await tempDir();
    await symlink(outside, join(root, 'escape'));

    expect((await resolveInRoot(root, 'escape', { follow: false }))?.rel).toBe('escape');
    // Its parent is still checked: a path THROUGH the escaping link is refused either way.
    expect(await resolveInRoot(root, 'escape/secret.txt', { follow: false })).toBeNull();
  });

  it('refuses everything when the root itself does not exist', async () => {
    const root = join(await tempDir(), 'never-created');
    expect(await resolveInRoot(root, 'docs/a.md')).toBeNull();
  });
});

describe('withinRootRealpath', () => {
  it('accepts the root and paths under it', async () => {
    const root = await tempDir();
    expect(await withinRootRealpath(root, root)).toBe(true);
    expect(await withinRootRealpath(root, join(root, 'a', 'b', 'c.md'))).toBe(true);
  });

  it('rejects a sibling directory whose name merely starts with the root', async () => {
    // `${root}-other` starts with the root string but is not inside it: a prefix test without the
    // separator would accept it.
    const root = await tempDir();
    expect(await withinRootRealpath(root, `${root}-other`)).toBe(false);
  });

  it('rejects a path outside the root', async () => {
    const root = await tempDir();
    expect(await withinRootRealpath(root, resolve(root, '..'))).toBe(false);
  });
});
