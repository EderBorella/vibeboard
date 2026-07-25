import { describe, it, expect } from 'vitest';
import { mkdir, writeFile, symlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers.js';
import {
  resolveControlPath,
  listControlFiles,
  readControlFile,
  writeControlFile,
  deleteControlFile,
  createControlFile,
  renameControlFile,
  readResources,
  writeResources,
} from '../src/server/control-files.js';

describe('control-files path sandbox', () => {
  it('rejects traversal, absolute paths, and non-control paths', async () => {
    const root = await tempDir();
    for (const bad of [
      '../etc/passwd',
      '/etc/passwd',
      '.vibeboard/config.yaml',
      '.vibeboard/chat/x.json',
      'features/todo/F-001.md', // a card
      'secret.txt',             // root, not markdown
      'docs/nested/pic.png',    // docs but not markdown
      '',
    ]) {
      expect(await resolveControlPath(root, bad), bad).toBeNull();
    }
  });

  it('accepts the allow-listed control paths', async () => {
    const root = await tempDir();
    for (const ok of [
      'INSTRUCTIONS.md',
      'CLAUDE.md',
      'VIBEBOARD.md',
      'README.md',
      'docs/design.md',
      '.claude/skills/foo/SKILL.md',
      'resources/api-notes.md',
      '.vibeboard/resources.yaml',
    ]) {
      const r = await resolveControlPath(root, ok);
      expect(r, ok).not.toBeNull();
      expect(r!.file.path).toBe(ok);
    }
  });

  it('flags managed + non-deletable for the three managed files only', async () => {
    const root = await tempDir();
    const claude = await resolveControlPath(root, 'CLAUDE.md');
    expect(claude!.file).toMatchObject({ managed: true, deletable: false });
    const ins = await resolveControlPath(root, 'INSTRUCTIONS.md');
    expect(ins!.file).toMatchObject({ managed: false, deletable: false }); // instruction files never deletable
    const doc = await resolveControlPath(root, 'docs/x.md');
    expect(doc!.file).toMatchObject({ managed: false, deletable: true });
  });

  it('rejects a symlink that escapes the project root', async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await writeFile(join(outside, 'target.md'), 'secret', 'utf8');
    await mkdir(join(root, 'resources'), { recursive: true });
    await symlink(join(outside, 'target.md'), join(root, 'resources', 'evil.md'));
    expect(await resolveControlPath(root, 'resources/evil.md')).toBeNull();
  });
});

describe('control-files CRUD', () => {
  it('creates, lists, reads, and deletes a doc', async () => {
    const root = await tempDir();
    expect(await writeControlFile(root, 'docs/design.md', '# Design\n')).toBe(true);

    const groups = await listControlFiles(root);
    const docs = groups.find((g) => g.key === 'docs')!;
    expect(docs.files.map((f) => f.path)).toContain('docs/design.md');

    const read = await readControlFile(root, 'docs/design.md');
    expect(read!.content).toBe('# Design\n');

    expect(await deleteControlFile(root, 'docs/design.md')).toBe('ok');
    const after = await listControlFiles(root);
    expect(after.find((g) => g.key === 'docs')!.files.map((f) => f.path)).not.toContain('docs/design.md');
  });

  it('creates skills nested and refuses to delete an instruction file', async () => {
    const root = await tempDir();
    await writeControlFile(root, '.claude/skills/greet/SKILL.md', 'skill');
    const skills = (await listControlFiles(root)).find((g) => g.key === 'skills')!;
    expect(skills.files.map((f) => f.path)).toContain('.claude/skills/greet/SKILL.md');

    await writeControlFile(root, 'CLAUDE.md', 'managed');
    expect(await deleteControlFile(root, 'CLAUDE.md')).toBe('not-allowed');
    expect((await readFile(join(root, 'CLAUDE.md'), 'utf8'))).toBe('managed'); // untouched
  });

  it('write/read/delete reject non-control paths', async () => {
    const root = await tempDir();
    expect(await writeControlFile(root, '../escape.md', 'x')).toBe(false);
    expect(await readControlFile(root, '.vibeboard/config.yaml')).toBeNull();
    expect(await deleteControlFile(root, '../escape.md')).toBe('invalid');
  });
});

describe('create with default names', () => {
  it('names the first one "New doc" and numbers the rest to avoid collisions', async () => {
    const root = await tempDir();
    const a = await createControlFile(root, 'docs');
    const b = await createControlFile(root, 'docs');
    const c = await createControlFile(root, 'docs');
    expect([a!.path, b!.path, c!.path]).toEqual(['docs/new-doc.md', 'docs/new-doc-2.md', 'docs/new-doc-3.md']);
    // and they really exist on disk, independently
    for (const f of [a, b, c]) expect((await readControlFile(root, f!.path))!.content).toContain('#');
  });

  it('creates a skill as a folder holding SKILL.md, with discoverable frontmatter', async () => {
    const root = await tempDir();
    const s = await createControlFile(root, 'skills');
    expect(s!.path).toBe('.claude/skills/new-skill/SKILL.md');
    expect(s!.name).toBe('new-skill'); // the folder, not "SKILL.md"
    const { content } = (await readControlFile(root, s!.path))!;
    expect(content).toMatch(/^---\nname: new-skill\ndescription:/);
  });

  it('numbers skills too, since the folder is what collides', async () => {
    const root = await tempDir();
    await createControlFile(root, 'skills');
    const second = await createControlFile(root, 'skills');
    expect(second!.path).toBe('.claude/skills/new-skill-2/SKILL.md');
  });

  it('refuses categories that cannot be created into', async () => {
    const root = await tempDir();
    expect(await createControlFile(root, 'instructions')).toBeNull();
    expect(await createControlFile(root, 'nonsense')).toBeNull();
  });
});

describe('rename', () => {
  it('renames a doc by display name, slugging the filename', async () => {
    const root = await tempDir();
    const doc = await createControlFile(root, 'docs');
    const renamed = await renameControlFile(root, doc!.path, 'Design Notes');
    expect((renamed as { path: string }).path).toBe('docs/design-notes.md');
    expect(await readControlFile(root, doc!.path)).toMatchObject({ content: '' }); // old path gone
    const files = (await listControlFiles(root)).find((g) => g.key === 'docs')!.files;
    expect(files.map((f) => f.path)).toEqual(['docs/design-notes.md']);
  });

  it('renames a skill by moving its folder and syncing the frontmatter name', async () => {
    const root = await tempDir();
    const skill = await createControlFile(root, 'skills');
    const renamed = await renameControlFile(root, skill!.path, 'Greet the user');
    expect((renamed as { path: string }).path).toBe('.claude/skills/greet-the-user/SKILL.md');
    const { content } = (await readControlFile(root, '.claude/skills/greet-the-user/SKILL.md'))!;
    expect(content).toContain('name: greet-the-user'); // frontmatter followed the folder
    expect(content).not.toContain('name: new-skill');
  });

  it('leaves a hand-picked frontmatter name alone', async () => {
    const root = await tempDir();
    const skill = await createControlFile(root, 'skills');
    await writeControlFile(root, skill!.path, '---\nname: my-own-choice\n---\nbody\n');
    await renameControlFile(root, skill!.path, 'Renamed');
    const { content } = (await readControlFile(root, '.claude/skills/renamed/SKILL.md'))!;
    expect(content).toContain('name: my-own-choice');
  });

  it('tolerates a typed .md extension instead of slugging it into the name', async () => {
    const root = await tempDir();
    const doc = await createControlFile(root, 'docs');
    const renamed = await renameControlFile(root, doc!.path, 'Design Notes.md');
    expect((renamed as { path: string }).path).toBe('docs/design-notes.md'); // not design-notes-md.md
  });

  it('reports a collision instead of clobbering', async () => {
    const root = await tempDir();
    const a = await createControlFile(root, 'docs');
    await renameControlFile(root, a!.path, 'Taken');
    const b = await createControlFile(root, 'docs');
    expect(await renameControlFile(root, b!.path, 'Taken')).toBe('taken');
    // both still present
    const files = (await listControlFiles(root)).find((g) => g.key === 'docs')!.files;
    expect(files.map((f) => f.path).sort()).toEqual(['docs/new-doc.md', 'docs/taken.md']);
  });

  it('rejects instruction files, empty names, and paths outside the sandbox', async () => {
    const root = await tempDir();
    await writeControlFile(root, 'INSTRUCTIONS.md', 'x');
    expect(await renameControlFile(root, 'INSTRUCTIONS.md', 'Nope')).toBeNull();
    const doc = await createControlFile(root, 'docs');
    expect(await renameControlFile(root, doc!.path, '   ')).toBeNull();
    expect(await renameControlFile(root, '../escape.md', 'Nope')).toBeNull();
  });
});

describe('resources registry', () => {
  it('round-trips links and drops empty/garbage entries', async () => {
    const root = await tempDir();
    await mkdir(join(root, '.vibeboard'), { recursive: true });
    await writeResources(root, [
      { title: 'Docs', url: 'https://example.com', note: 'ref' },
      { title: '', url: '' },            // dropped
      'nonsense',                         // dropped
      { title: 'NoUrl' },                 // kept (title only)
    ]);
    const links = await readResources(root);
    expect(links).toEqual([
      { title: 'Docs', url: 'https://example.com', note: 'ref' },
      { title: 'NoUrl', url: '' },
    ]);
  });

  it('returns [] when the file is missing', async () => {
    const root = await tempDir();
    expect(await readResources(root)).toEqual([]);
  });
});
