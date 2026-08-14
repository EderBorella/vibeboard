import { lstat, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SKILLS_DIR, skillRel } from '../src/core/layout.js';
import { listDir, MAX_EDIT_BYTES } from '../src/server/explorer/explorer-list.js';
import {
  createNode,
  deleteNode,
  deleteTree,
  moveIntoDir,
  renameNode,
  validName,
  writeFileNode,
} from '../src/server/explorer/explorer-mutate.js';
import { tempDir } from './helpers.js';

const read = (root: string, rel: string): Promise<string> => readFile(join(root, rel), 'utf8');
const names = async (root: string, dir = ''): Promise<string[]> =>
  ((await listDir(root, dir))?.entries ?? []).map((e) => e.name);
const gone = async (abs: string): Promise<boolean> => {
  try {
    await lstat(abs);
    return false;
  } catch {
    return true;
  }
};

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

describe('validName', () => {
  it('takes a literal filename, spaces, case and extension intact', () => {
    // Deliberately NOT slugged, unlike Project Control: in a file explorer the name IS the filename,
    // and turning "Q3 Notes.md" into "q3-notes.md" would be the tab lying about what it wrote.
    expect(validName('Q3 Notes.md')).toBe('Q3 Notes.md');
    expect(validName('  padded.md  ')).toBe('padded.md');
    expect(validName('café ☕.md')).toBe('café ☕.md');
    expect(validName('.hidden')).toBe('.hidden');
    expect(validName('back\\slash.md')).toBe('back\\slash.md'); // legal here; not ours to forbid
  });

  it('refuses what the filesystem cannot hold, or what means something else', () => {
    for (const bad of ['', '   ', '.', '..', 'a/b', '/abs', 'nul\0byte', undefined, null, 7]) {
      expect(validName(bad)).toBeNull();
    }
  });

  it('measures the length limit in bytes, not characters', () => {
    // 64 of these is 256 bytes but only 128 UTF-16 units, so a `.length` check would wave it through
    // and the write would then fail with ENAMETOOLONG.
    expect(validName('a'.repeat(255))).toHaveLength(255);
    expect(validName('a'.repeat(256))).toBeNull();
    expect(validName('\u{1F600}'.repeat(64))).toBeNull();
    expect(validName('\u{1F600}'.repeat(63))).not.toBeNull(); // 252 bytes: still fine
  });
});

describe('createNode', () => {
  it('creates an empty file in the project root', async () => {
    const root = await tempDir();
    expect(await createNode(root, '', 'file')).toEqual({
      path: 'Untitled.md',
      name: 'Untitled.md',
      kind: 'file',
      size: 0,
    });
    expect(await read(root, 'Untitled.md')).toBe('');
  });

  it('creates a folder, with no size', async () => {
    const root = await tempDir();
    expect(await createNode(root, '', 'dir')).toEqual({
      path: 'New folder',
      name: 'New folder',
      kind: 'dir',
    });
    expect(await names(root)).toEqual(['New folder']);
  });

  it('creates inside a subfolder, pathed from the root', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'docs', 'deep'), { recursive: true });
    expect(await createNode(root, 'docs/deep', 'file')).toMatchObject({
      path: 'docs/deep/Untitled.md',
      name: 'Untitled.md',
    });
  });

  it('numbers a repeated file BEFORE the extension, so it stays markdown', async () => {
    // "Untitled.md 2" would not be a markdown file, and the editor's preview would be wrong about it.
    const root = await tempDir();
    await createNode(root, '', 'file');
    await createNode(root, '', 'file');
    await createNode(root, '', 'file');
    expect(await names(root)).toEqual(['Untitled 2.md', 'Untitled 3.md', 'Untitled.md']);
  });

  it('numbers a repeated folder after the name, since it has no extension', async () => {
    const root = await tempDir();
    await createNode(root, '', 'dir');
    await createNode(root, '', 'dir');
    expect(await names(root)).toEqual(['New folder', 'New folder 2']);
  });

  it('steps over a name taken by something the user made', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'Untitled.md'), 'mine', 'utf8');
    expect(await createNode(root, '', 'file')).toMatchObject({ name: 'Untitled 2.md' });
    expect(await read(root, 'Untitled.md')).toBe('mine'); // untouched
  });

  it('refuses a bad kind, a file as the parent, and a parent outside the project', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'a.md'), 'x', 'utf8');
    expect(await createNode(root, '', 'symlink')).toBe('invalid');
    expect(await createNode(root, '', undefined)).toBe('invalid');
    expect(await createNode(root, 'a.md', 'file')).toBe('invalid'); // not a folder
    expect(await createNode(root, 'nope', 'file')).toBe('invalid');
    expect(await createNode(root, '../..', 'file')).toBe('invalid');
  });
});

describe('renameNode', () => {
  it('renames a file in place, keeping its contents', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs', 'old.md'), 'body', 'utf8');
    expect(await renameNode(root, 'docs/old.md', 'new name.md')).toEqual({
      path: 'docs/new name.md',
      name: 'new name.md',
      kind: 'file',
      size: 4,
    });
    expect(await read(root, 'docs/new name.md')).toBe('body');
    expect(await gone(join(root, 'docs', 'old.md'))).toBe(true);
  });

  it('renames a folder and everything under it', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'a', 'b'), { recursive: true });
    await writeFile(join(root, 'a', 'b', 'deep.md'), 'deep', 'utf8');
    expect(await renameNode(root, 'a', 'z')).toMatchObject({ path: 'z', kind: 'dir' });
    expect(await read(root, 'z/b/deep.md')).toBe('deep');
  });

  it('renames the link, not what it points at — even one leaving the project', async () => {
    // follow:false is the whole reason: following would rename the target, or refuse outright.
    const root = await tempDir();
    const outside = await tempDir();
    await writeFile(join(outside, 'real.txt'), 'theirs', 'utf8');
    await symlink(join(outside, 'real.txt'), join(root, 'link'));

    expect(await renameNode(root, 'link', 'renamed')).toMatchObject({ name: 'renamed', symlink: true });
    expect(await readlink(join(root, 'renamed'))).toBe(join(outside, 'real.txt'));
    expect(await read(outside, 'real.txt')).toBe('theirs');
  });

  it('reports a collision instead of overwriting', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'a.md'), 'a', 'utf8');
    await writeFile(join(root, 'b.md'), 'b', 'utf8');
    expect(await renameNode(root, 'a.md', 'b.md')).toBe('taken');
    expect(await read(root, 'b.md')).toBe('b'); // and really did not overwrite
  });

  it('accepts the name it already has, as a no-op', async () => {
    // Committing an unedited rename box must not read as a collision with itself.
    const root = await tempDir();
    await writeFile(join(root, 'a.md'), 'a', 'utf8');
    expect(await renameNode(root, 'a.md', 'a.md')).toMatchObject({ path: 'a.md' });
    expect(await read(root, 'a.md')).toBe('a');
  });

  it('refuses a name that would move the file, and refuses the root', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'a.md'), 'a', 'utf8');
    // A rename is a new NAME. Typing a path into the box must not silently relocate the file.
    expect(await renameNode(root, 'a.md', 'docs/a.md')).toBe('invalid');
    expect(await renameNode(root, 'a.md', '../a.md')).toBe('invalid');
    expect(await renameNode(root, '', 'anything')).toBe('invalid');
    expect(await read(root, 'a.md')).toBe('a');
  });
});

describe('moveIntoDir', () => {
  it('moves a file into another folder, keeping its name', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'a.md'), 'body', 'utf8');
    expect(await moveIntoDir(root, 'a.md', 'docs')).toEqual({
      path: 'docs/a.md',
      name: 'a.md',
      kind: 'file',
      size: 4,
    });
    expect(await gone(join(root, 'a.md'))).toBe(true);
  });

  it('moves a file back out to the project root', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs', 'a.md'), 'body', 'utf8');
    expect(await moveIntoDir(root, 'docs/a.md', '')).toMatchObject({ path: 'a.md' });
  });

  it('moves a whole folder', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'src', 'lib'), { recursive: true });
    await mkdir(join(root, 'attic'));
    await writeFile(join(root, 'src', 'lib', 'x.md'), 'x', 'utf8');
    expect(await moveIntoDir(root, 'src', 'attic')).toMatchObject({ path: 'attic/src', kind: 'dir' });
    expect(await read(root, 'attic/src/lib/x.md')).toBe('x');
  });

  it('refuses to move a folder into itself or into its own descendant', async () => {
    // The classic: rename() would either fail obscurely or, with a deeper target, detach the subtree.
    const root = await tempDir();
    await mkdir(join(root, 'a', 'b', 'c'), { recursive: true });
    expect(await moveIntoDir(root, 'a', 'a')).toBe('into-self');
    expect(await moveIntoDir(root, 'a', 'a/b')).toBe('into-self');
    expect(await moveIntoDir(root, 'a', 'a/b/c')).toBe('into-self');
    expect(await names(root, 'a')).toEqual(['b']); // still intact
  });

  it('does not mistake a sibling with a shared prefix for a descendant', async () => {
    // `docs-old` starts with `docs`, but is not inside it. A prefix test without the separator
    // would refuse this legitimate move.
    const root = await tempDir();
    await mkdir(join(root, 'docs'));
    await mkdir(join(root, 'docs-old'));
    expect(await moveIntoDir(root, 'docs', 'docs-old')).toMatchObject({ path: 'docs-old/docs' });
  });

  it('reports a collision at the destination', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'a.md'), 'new', 'utf8');
    await writeFile(join(root, 'docs', 'a.md'), 'existing', 'utf8');
    expect(await moveIntoDir(root, 'a.md', 'docs')).toBe('taken');
    expect(await read(root, 'docs/a.md')).toBe('existing');
  });

  it('treats a move into its current folder as a no-op, not a collision', async () => {
    // What a drag that lands where it started must do.
    const root = await tempDir();
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs', 'a.md'), 'a', 'utf8');
    expect(await moveIntoDir(root, 'docs/a.md', 'docs')).toMatchObject({ path: 'docs/a.md' });
    expect(await read(root, 'docs/a.md')).toBe('a');
  });

  it('refuses a destination that is a file, missing, or outside the project', async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await symlink(outside, join(root, 'escape'));
    await writeFile(join(root, 'a.md'), 'a', 'utf8');
    await writeFile(join(root, 'f.md'), 'f', 'utf8');

    expect(await moveIntoDir(root, 'a.md', 'f.md')).toBe('invalid');
    expect(await moveIntoDir(root, 'a.md', 'nope')).toBe('invalid');
    expect(await moveIntoDir(root, 'a.md', '../..')).toBe('invalid');
    expect(await moveIntoDir(root, 'a.md', 'escape')).toBe('invalid'); // out of the project
    expect(await names(outside)).toEqual([]);
  });

  it('refuses to move the project root itself', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'docs'));
    expect(await moveIntoDir(root, '', 'docs')).toBe('invalid');
  });
});

describe('deleteNode', () => {
  it('deletes a file', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'a.md'), 'a', 'utf8');
    expect(await deleteNode(root, 'a.md')).toBe('ok');
    expect(await gone(join(root, 'a.md'))).toBe(true);
  });

  it('deletes an empty folder — the case this whole tab was built for', async () => {
    // A skill folder left behind with no SKILL.md was invisible in Project Control and therefore
    // unremovable. This is the line that clears it.
    const root = await tempDir();
    await mkdir(join(root, skillRel('new-skill')), { recursive: true });
    expect(await deleteNode(root, skillRel('new-skill'))).toBe('ok');
    expect(await names(root, SKILLS_DIR)).toEqual([]);
  });

  it('refuses a folder with contents rather than emptying it', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs', 'keep.md'), 'keep', 'utf8');
    expect(await deleteNode(root, 'docs')).toBe('not-empty');
    expect(await read(root, 'docs/keep.md')).toBe('keep');
  });

  it('deletes a symlink and leaves its target alone, even outside the project', async () => {
    // follow:false again: unlinking the link is the whole point. Following it would delete somebody
    // else's file, or refuse and leave the row unremovable.
    const root = await tempDir();
    const outside = await tempDir();
    await writeFile(join(outside, 'real.txt'), 'theirs', 'utf8');
    await symlink(outside, join(root, 'escape'));
    await symlink(join(outside, 'real.txt'), join(root, 'escape.txt'));

    expect(await deleteNode(root, 'escape')).toBe('ok');
    expect(await deleteNode(root, 'escape.txt')).toBe('ok');
    expect(await read(outside, 'real.txt')).toBe('theirs');
    expect(await names(outside)).toEqual(['real.txt']);
  });

  it('treats something already gone as done', async () => {
    // The client's tree is a snapshot. Reporting a race as a failure would leave a row that nothing
    // could clear — the exact shape of the bug this tab exists to fix.
    const root = await tempDir();
    expect(await deleteNode(root, 'never-existed.md')).toBe('ok');
  });

  it('refuses the project root and anything outside it', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'a.md'), 'a', 'utf8');
    expect(await deleteNode(root, '')).toBe('invalid');
    expect(await deleteNode(root, '.')).toBe('invalid');
    expect(await deleteNode(root, '../..')).toBe('invalid');
    expect(await read(root, 'a.md')).toBe('a');
  });
});

describe('deleteTree', () => {
  it('deletes a folder and everything under it when the name is typed correctly', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'attic', 'deep', 'deeper'), { recursive: true });
    await writeFile(join(root, 'attic', 'deep', 'x.md'), 'x', 'utf8');
    expect(await deleteTree(root, 'attic', 'attic')).toBe('ok');
    expect(await gone(join(root, 'attic'))).toBe(true);
  });

  it('refuses the wrong name, and keeps everything', async () => {
    // The server checks it too. A guard that lives only in the dialog is a guard the server does not
    // have — and this route is reachable without the dialog.
    const root = await tempDir();
    await mkdir(join(root, 'attic'));
    await writeFile(join(root, 'attic', 'x.md'), 'x', 'utf8');
    for (const wrong of ['Attic', 'attic/', 'atti', '', 'x.md', undefined, null, 42]) {
      expect(await deleteTree(root, 'attic', wrong)).toBe('wrong-name');
    }
    expect(await read(root, 'attic/x.md')).toBe('x');
  });

  it('accepts the name with stray whitespace around it', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'attic'));
    expect(await deleteTree(root, 'attic', '  attic  ')).toBe('ok');
  });

  it('checks the name of the folder itself, not of its parent', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'a', 'b'), { recursive: true });
    expect(await deleteTree(root, 'a/b', 'a')).toBe('wrong-name');
    expect(await deleteTree(root, 'a/b', 'b')).toBe('ok');
    expect(await names(root, 'a')).toEqual([]);
  });

  it('refuses a symlink, so recursion can never leave the project', async () => {
    // rm -r through a link to a directory would delete the target's contents. A link is one entry
    // whatever it points at, and belongs to deleteNode.
    const root = await tempDir();
    const outside = await tempDir();
    await writeFile(join(outside, 'real.txt'), 'theirs', 'utf8');
    await symlink(outside, join(root, 'escape'));

    expect(await deleteTree(root, 'escape', 'escape')).toBe('invalid');
    expect(await read(outside, 'real.txt')).toBe('theirs');
  });

  it('refuses a file, the project root, and anything outside it', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'a.md'), 'a', 'utf8');
    expect(await deleteTree(root, 'a.md', 'a.md')).toBe('invalid');
    expect(await deleteTree(root, '', '')).toBe('invalid');
    expect(await deleteTree(root, '..', '..')).toBe('invalid');
    expect(await read(root, 'a.md')).toBe('a');
  });

  it('treats a folder already gone as done', async () => {
    const root = await tempDir();
    expect(await deleteTree(root, 'never', 'never')).toBe('ok');
  });
});
