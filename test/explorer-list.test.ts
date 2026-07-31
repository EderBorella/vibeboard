import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listDir, MAX_EDIT_BYTES, MAX_ENTRIES, readFileNode } from '../src/server/explorer-list.js';
import { tempDir } from './helpers.js';

async function tree(spec: Record<string, string | null>): Promise<string> {
  const root = await tempDir();
  for (const [rel, content] of Object.entries(spec)) {
    const abs = join(root, rel);
    if (content === null) await mkdir(abs, { recursive: true });
    else {
      await mkdir(join(abs, '..'), { recursive: true });
      await writeFile(abs, content, 'utf8');
    }
  }
  return root;
}

const names = (listing: Awaited<ReturnType<typeof listDir>>): string[] =>
  (listing?.entries ?? []).map((e) => e.name);

describe('listDir', () => {
  it('lists the root, directories first and then files', async () => {
    const root = await tree({ 'zeta.md': 'z', alpha: null, 'beta.md': 'b', omega: null });
    const listing = await listDir(root, '');
    expect(names(listing)).toEqual(['alpha', 'omega', 'beta.md', 'zeta.md']);
    expect(listing?.path).toBe('');
    expect(listing?.parent).toBeNull();
  });

  it('hides nothing — .git, node_modules and .vibeboard are all listed', async () => {
    // The ruling this tab exists for: the tree shows what is on disk. An entry the app hides is an
    // entry the user cannot delete, which is exactly the empty-skill-folder bug in another costume.
    // A future "helpful" filter has to fail here.
    const root = await tree({
      '.git/HEAD': 'ref: refs/heads/main\n',
      'node_modules/left-pad/index.js': 'module.exports = 1\n',
      '.vibeboard/config.yaml': 'name: T\n',
      '.vibeboard/runs/live.json': '{}',
      'features/todo/card.md': '---\n---\n',
      'README.md': '# hi\n',
    });
    expect(names(await listDir(root, ''))).toEqual([
      '.git',
      '.vibeboard',
      'features',
      'node_modules',
      'README.md',
    ]);
    expect(names(await listDir(root, '.vibeboard'))).toEqual(['runs', 'config.yaml']);
  });

  it('sorts a shuffled directory the same way on every filesystem', async () => {
    // Twelve entries created in a shuffled order: readdir returns hash order on ext4, so a
    // two-entry fixture can come back already sorted by chance and witness nothing.
    const shuffled = ['m3', 'a9', 'z1', 'q7', 'b2', 'y8', 'c5', 'x4', 'd6', 'w0', 'e1', 'v2'];
    const root = await tree(Object.fromEntries(shuffled.map((n) => [`${n}.md`, n])));
    expect(names(await listDir(root, ''))).toEqual(shuffled.map((n) => `${n}.md`).sort());
  });

  it('sorts case-insensitively, so Zebra does not come before apple', async () => {
    const root = await tree({ 'Zebra.md': 'z', 'apple.md': 'a', 'Banana.md': 'b' });
    expect(names(await listDir(root, ''))).toEqual(['apple.md', 'Banana.md', 'Zebra.md']);
  });

  it('lists a subdirectory and names its parent', async () => {
    const root = await tree({ 'docs/deep/a.md': 'a', 'docs/b.md': 'b' });
    const listing = await listDir(root, 'docs');
    expect(names(listing)).toEqual(['deep', 'b.md']);
    expect(listing?.parent).toBe('');
    expect((await listDir(root, 'docs/deep'))?.parent).toBe('docs');
  });

  it('reports a file size, and no size for a directory', async () => {
    const root = await tree({ 'a.md': 'hello', sub: null });
    const entries = (await listDir(root, ''))?.entries ?? [];
    expect(entries.find((e) => e.name === 'a.md')).toMatchObject({ kind: 'file', size: 5 });
    expect(entries.find((e) => e.name === 'sub')?.size).toBeUndefined();
  });

  it('caps a large directory and says how many it left out', async () => {
    // The number goes on screen, so it is the number the test asserts. A cap read as a total is the
    // classic way a truncated report becomes a wrong claim.
    const spec: Record<string, string> = {};
    for (let i = 0; i < MAX_ENTRIES + 7; i++) spec[`f${String(i).padStart(4, '0')}.md`] = 'x';
    const root = await tree(spec);
    const listing = await listDir(root, '');
    expect(listing?.entries).toHaveLength(MAX_ENTRIES);
    expect(listing?.truncated).toBe(7);
    // The kept ones are the first in sort order, not an arbitrary 500.
    expect(listing?.entries[0].name).toBe('f0000.md');
  });

  it('leaves `truncated` off when nothing was left out', async () => {
    const root = await tree({ 'a.md': 'a' });
    expect(await listDir(root, '')).not.toHaveProperty('truncated');
  });

  it('shows a symlink to a directory inside the root as a directory', async () => {
    const root = await tree({ 'real/a.md': 'a' });
    await symlink(join(root, 'real'), join(root, 'link'));
    const entry = (await listDir(root, ''))?.entries.find((e) => e.name === 'link');
    expect(entry).toMatchObject({ kind: 'dir', symlink: true, target: join(root, 'real') });
    expect(entry?.escapes).toBeUndefined();
    expect(names(await listDir(root, 'link'))).toEqual(['a.md']);
  });

  it('lists a symlink that leaves the root, flagged, without following it', async () => {
    // Listed so it can be deleted; flagged so the client does not offer to open it; never stat'ed,
    // because that would reach outside the project.
    const root = await tempDir();
    const outside = await tempDir();
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8');
    await symlink(outside, join(root, 'escape'));

    const entry = (await listDir(root, ''))?.entries.find((e) => e.name === 'escape');
    expect(entry).toMatchObject({ kind: 'other', symlink: true, escapes: true });
    expect(await listDir(root, 'escape')).toBeNull();
  });

  it('lists a dangling symlink as neither file nor directory', async () => {
    const root = await tempDir();
    await symlink(join(root, 'gone'), join(root, 'dangling'));
    const entry = (await listDir(root, ''))?.entries.find((e) => e.name === 'dangling');
    expect(entry).toMatchObject({ kind: 'other', symlink: true });
  });

  it('refuses a path outside the root, a missing directory, and a file', async () => {
    const root = await tree({ 'a.md': 'a' });
    expect(await listDir(root, '../..')).toBeNull();
    expect(await listDir(root, 'nope')).toBeNull();
    expect(await listDir(root, 'a.md')).toBeNull(); // a file is not a listing
  });
});

describe('readFileNode', () => {
  it('reads a text file with its content and size', async () => {
    const root = await tree({ 'docs/a.md': '# hello\n' });
    expect(await readFileNode(root, 'docs/a.md')).toEqual({
      kind: 'text',
      path: 'docs/a.md',
      name: 'a.md',
      size: 8,
      content: '# hello\n',
    });
  });

  it('reports a binary file instead of loading it into an editor', async () => {
    // A NUL byte is the test. Round-tripping this through a textarea would corrupt it on save.
    const root = await tempDir();
    await writeFile(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]));
    const read = await readFileNode(root, 'logo.png');
    expect(read).toEqual({ kind: 'binary', path: 'logo.png', name: 'logo.png', size: 6 });
  });

  it('treats a NUL beyond the sniffed block as text, and does not choke on it', async () => {
    // Documents where the line is: the sniff reads a block, not the whole file.
    const root = await tempDir();
    await writeFile(join(root, 'late.txt'), Buffer.concat([Buffer.alloc(9000, 0x61), Buffer.from([0])]));
    expect(await readFileNode(root, 'late.txt')).toMatchObject({ kind: 'text', size: 9001 });
  });

  it('reports a file too large to edit rather than sending a megabyte of it', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'big.log'), Buffer.alloc(MAX_EDIT_BYTES + 1, 0x61));
    expect(await readFileNode(root, 'big.log')).toEqual({
      kind: 'too-large',
      path: 'big.log',
      name: 'big.log',
      size: MAX_EDIT_BYTES + 1,
    });
  });

  it('reads a file exactly at the limit', async () => {
    // The boundary itself, because `>` and `>=` are the same test result on every other size.
    const root = await tempDir();
    await writeFile(join(root, 'edge.txt'), Buffer.alloc(MAX_EDIT_BYTES, 0x61));
    expect(await readFileNode(root, 'edge.txt')).toMatchObject({ kind: 'text', size: MAX_EDIT_BYTES });
  });

  it('reads an empty file as empty text, not as a failure', async () => {
    const root = await tree({ 'empty.md': '' });
    expect(await readFileNode(root, 'empty.md')).toMatchObject({ kind: 'text', content: '', size: 0 });
  });

  it('says a directory is not a file, which is different from refusing the path', async () => {
    const root = await tree({ 'docs/a.md': 'a' });
    expect(await readFileNode(root, 'docs')).toBe('not-a-file');
  });

  it('refuses the root, a missing file, traversal, and a symlink out of the project', async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8');
    await symlink(join(outside, 'secret.txt'), join(root, 'escape.txt'));

    expect(await readFileNode(root, '')).toBeNull();
    expect(await readFileNode(root, 'gone.md')).toBeNull();
    expect(await readFileNode(root, '../../etc/passwd')).toBeNull();
    expect(await readFileNode(root, 'escape.txt')).toBeNull();
  });
});
