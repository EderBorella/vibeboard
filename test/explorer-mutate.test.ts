import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_EDIT_BYTES } from '../src/server/explorer-list.js';
import { writeFileNode } from '../src/server/explorer-mutate.js';
import { tempDir } from './helpers.js';

const read = (root: string, rel: string): Promise<string> => readFile(join(root, rel), 'utf8');

describe('writeFileNode', () => {
  it('overwrites a text file', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs', 'a.md'), 'old', 'utf8');
    expect(await writeFileNode(root, 'docs/a.md', 'new')).toBe('ok');
    expect(await read(root, 'docs/a.md')).toBe('new');
  });

  it('writes the bytes exactly, with no trailing newline of its own', async () => {
    // A save must round-trip: an editor that quietly appends a newline changes every file it touches.
    const root = await tempDir();
    await writeFile(join(root, 'a.md'), 'x', 'utf8');
    await writeFileNode(root, 'a.md', '# one\n\n\ntwo');
    expect(await read(root, 'a.md')).toBe('# one\n\n\ntwo');
  });

  it('empties a file when that is what the buffer says', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'a.md'), 'something', 'utf8');
    expect(await writeFileNode(root, 'a.md', '')).toBe('ok');
    expect(await read(root, 'a.md')).toBe('');
  });

  it('creates a file whose parent exists — a save after the file was deleted underneath you', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'docs'));
    expect(await writeFileNode(root, 'docs/new.md', 'hi')).toBe('ok');
    expect(await read(root, 'docs/new.md')).toBe('hi');
  });

  it('will not invent a parent directory', async () => {
    // Saving a file is not permission to build a path. A missing parent means the client's tree is
    // stale, and creating it would hide that.
    const root = await tempDir();
    expect(await writeFileNode(root, 'nope/deep/a.md', 'hi')).toBe('invalid');
  });

  it('refuses to overwrite a file it could not have shown as text', async () => {
    // The buffer cannot be a version of a file the editor never opened. Without this, selecting a
    // PNG and hitting Save would replace it with an empty string.
    const root = await tempDir();
    await writeFile(join(root, 'logo.png'), Buffer.from([0x89, 0x00, 0x4e]));
    expect(await writeFileNode(root, 'logo.png', 'clobbered')).toBe('not-text');
    expect(await readFile(join(root, 'logo.png'))).toEqual(Buffer.from([0x89, 0x00, 0x4e]));
  });

  it('refuses to overwrite a file too large to have been opened', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'big.log'), Buffer.alloc(MAX_EDIT_BYTES + 1, 0x61));
    expect(await writeFileNode(root, 'big.log', 'x')).toBe('not-text');
  });

  it('refuses a directory, the root, traversal, and a symlink out of the project', async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8');
    await mkdir(join(root, 'docs'));
    await symlink(join(outside, 'secret.txt'), join(root, 'escape.txt'));

    expect(await writeFileNode(root, 'docs', 'x')).toBe('invalid');
    expect(await writeFileNode(root, '', 'x')).toBe('invalid');
    expect(await writeFileNode(root, '../escape.md', 'x')).toBe('invalid');
    expect(await writeFileNode(root, 'escape.txt', 'x')).toBe('invalid');
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('secret');
  });

  it('refuses content that is not a string, rather than writing "undefined"', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'a.md'), 'keep', 'utf8');
    for (const bad of [undefined, null, 42, { content: 'x' }]) {
      expect(await writeFileNode(root, 'a.md', bad)).toBe('invalid');
    }
    expect(await read(root, 'a.md')).toBe('keep');
  });
});
